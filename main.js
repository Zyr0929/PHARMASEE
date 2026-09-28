// ============================================================================
// PharmaSEE — main.js
// Electron Main Process: Window, IPC Handlers, Express + Socket.io Server
// ============================================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const os     = require('os');

// Express + Socket.io
const express  = require('express');

// Database layer
const {
  db,
  bcrypt,
  stmtGetUserByUsername,
  stmtGetAllProducts,
  stmtGetProductByBarcode,
  stmtGetProductById,
  stmtInsertProduct,
  stmtUpdateProduct,
  stmtDeleteProduct,
  stmtDeductStock,
  stmtInsertTransaction,
  stmtInsertSaleItem,
  stmtGetSalesInRange,
  stmtDailyDemand,
  stmtInsertAudit,
  stmtGetAudits,
  stmtUpdateABC,
  stmtUpdateSafetyReorder,
  stmtLowStock,
  runTransaction,
} = require('./db');

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let mainWindow    = null;
let currentUser   = null;   // { id, username, role }

// ---------------------------------------------------------------------------
// 1. Electron Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'PharmaSEE POS',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,
      nodeIntegration:    false,
      sandbox:            false,
    },
  });

  mainWindow.loadFile('index.html');
  // Uncomment next line for dev tools on launch:
  // mainWindow.webContents.openDevTools();
}

// ---------------------------------------------------------------------------
// 2. IPC Handlers — Auth
// ---------------------------------------------------------------------------
ipcMain.handle('auth:login', (_event, username, password) => {
  const user = stmtGetUserByUsername.get(username);
  if (!user) return { success: false, message: 'User not found.' };

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return { success: false, message: 'Incorrect password.' };

  currentUser = { id: user.id, username: user.username, role: user.role };
  return { success: true, user: currentUser };
});

ipcMain.handle('auth:logout', () => {
  currentUser = null;
  return { success: true };
});

ipcMain.handle('auth:session', () => {
  return currentUser || null;
});

// ---------------------------------------------------------------------------
// 3. IPC Handlers — Products / Inventory
// ---------------------------------------------------------------------------
ipcMain.handle('products:getAll', () => {
  return stmtGetAllProducts.all();
});

ipcMain.handle('products:getByBarcode', (_event, barcode) => {
  return stmtGetProductByBarcode.get(barcode) || null;
});

ipcMain.handle('products:add', (_event, data) => {
  try {
    const info = stmtInsertProduct.run(data);
    return { success: true, id: info.lastInsertRowid };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('products:update', (_event, data) => {
  try {
    stmtUpdateProduct.run(data);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('products:delete', (_event, id) => {
  try {
    stmtDeleteProduct.run(id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('products:lowStock', () => {
  return stmtLowStock.all();
});

// ---------------------------------------------------------------------------
// 4. IPC Handlers — POS Checkout
// ---------------------------------------------------------------------------
ipcMain.handle('pos:checkout', (_event, cartItems, cashierId) => {
  // cartItems = [{ product_id, quantity, unit_price, subtotal }, …]
  try {
    const result = runTransaction(() => {
      const totalAmount = cartItems.reduce((sum, i) => sum + i.subtotal, 0);

      const txInfo = stmtInsertTransaction.run(cashierId, totalAmount);
      const txId   = txInfo.lastInsertRowid;

      for (const item of cartItems) {
        // Deduct stock — fails gracefully if insufficient
        const changes = stmtDeductStock.run(item.quantity, item.product_id, item.quantity);
        if (changes.changes === 0) {
          throw new Error(
            `Insufficient stock for product ID ${item.product_id}`
          );
        }
        stmtInsertSaleItem.run(
          txId,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.subtotal
        );
      }
      return { transactionId: txId, totalAmount };
    });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---------------------------------------------------------------------------
// 5. IPC Handlers — Reports
// ---------------------------------------------------------------------------
ipcMain.handle('reports:sales', (_event, from, to) => {
  return stmtGetSalesInRange.all(from, to);
});

// ---------------------------------------------------------------------------
// 6. IPC Handlers — Predictive Algorithm Engine
// ---------------------------------------------------------------------------

// --- ABC Classification ---
ipcMain.handle('algo:abc', () => {
  const products = stmtGetAllProducts.all();

  // Calculate Annual Consumption Value per product from the last 365 days
  const now   = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const from = yearAgo.toISOString().slice(0, 10);
  const to   = now.toISOString().slice(0, 10) + ' 23:59:59';

  const salesData = stmtGetSalesInRange.all(from, to);

  // Map product_id → total_qty sold
  const qtyMap = {};
  for (const row of salesData) {
    qtyMap[row.product_id] = row.total_qty;
  }

  // ACV = total_qty_sold * unit_cost
  let items = products.map(p => ({
    id:       p.id,
    acv:      (qtyMap[p.id] || 0) * p.unit_cost,
  }));

  // Sort descending by ACV
  items.sort((a, b) => b.acv - a.acv);

  const totalACV = items.reduce((s, i) => s + i.acv, 0);
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.acv;
    const pct = totalACV > 0 ? (cumulative / totalACV) * 100 : 0;

    let tier;
    if (pct <= 80)      tier = 'A';
    else if (pct <= 95) tier = 'B';
    else                tier = 'C';

    stmtUpdateABC.run(tier, item.id);
  }

  return { success: true, count: items.length };
});

// --- Dynamic Safety Stock & Reorder Point ---
ipcMain.handle('algo:safetyReorder', () => {
  const products = stmtGetAllProducts.all();
  const Z_SCORE = 1.65; // ~95 % service level

  let updated = 0;

  for (const p of products) {
    const rows = stmtDailyDemand.all(p.id);

    if (rows.length < 2) {
      // Not enough data — skip
      continue;
    }

    const demands = rows.map(r => r.daily_qty);
    const mean    = demands.reduce((s, d) => s + d, 0) / demands.length;
    const variance = demands.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / demands.length;
    const stdDev   = Math.sqrt(variance);

    // Safety Stock = Z * σ_demand * √lead_time
    const safetyStock  = Z_SCORE * stdDev * Math.sqrt(p.lead_time_days);

    // Reorder Point = (avg_daily_demand * lead_time) + safety_stock
    const reorderPoint = (mean * p.lead_time_days) + safetyStock;

    stmtUpdateSafetyReorder.run(
      Math.round(safetyStock * 100) / 100,
      Math.round(reorderPoint * 100) / 100,
      p.id
    );
    updated++;
  }

  return { success: true, updated };
});

// ---------------------------------------------------------------------------
// 7. IPC Handlers — Audits
// ---------------------------------------------------------------------------
ipcMain.handle('audits:getAll', () => {
  return stmtGetAudits.all();
});

ipcMain.handle('audits:submit', (_event, data) => {
  // data = { product_id, physical_count }
  const product = stmtGetProductById.get(data.product_id);
  if (!product) return { success: false, message: 'Product not found.' };

  const systemCount     = product.stock_quantity;
  const physicalCount   = data.physical_count;
  const discrepancyRate =
    physicalCount === 0
      ? 0
      : (Math.abs(physicalCount - systemCount) / physicalCount) * 100;

  stmtInsertAudit.run(
    data.product_id,
    systemCount,
    physicalCount,
    Math.round(discrepancyRate * 100) / 100
  );

  return { success: true, discrepancyRate: Math.round(discrepancyRate * 100) / 100 };
});

// ---------------------------------------------------------------------------
// 8. IPC Utility — Local IP (for mobile scanner URL)
// ---------------------------------------------------------------------------
function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

ipcMain.handle('util:localIP', () => {
  return getLocalIPv4();
});

// ---------------------------------------------------------------------------
// 9. Express + Socket.io  — Mobile Barcode Scanner Server (port 3000)
// ---------------------------------------------------------------------------
function startScannerServer() {
  const https = require('https');
  const http  = require('http');
  const forge = require('node-forge');

  const localIP = getLocalIPv4();
  let server;

  try {
    // Generate RSA key pair with node-forge
    const keys = forge.pki.rsa.generateKeyPair(2048);

    // Create a self-signed certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter  = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

    const attrs = [{ name: 'commonName', value: 'PharmaSEE Scanner' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    // Add Subject Alternative Names so browser accepts for local IP
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: localIP },
      ]},
    ]);

    // Sign the certificate with the private key
    cert.sign(keys.privateKey, forge.md.sha256.create());

    // Convert to PEM
    const pemKey  = forge.pki.privateKeyToPem(keys.privateKey);
    const pemCert = forge.pki.certificateToPem(cert);

    const expressApp = express();
    server = https.createServer({ key: pemKey, cert: pemCert }, expressApp);

    setupExpressRoutes(expressApp);
    setupSocketIO(server);

    const PORT = 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Scanner] HTTPS server running → https://${localIP}:${PORT}/scanner`);
    });

  } catch (err) {
    // Fallback to HTTP if HTTPS cert generation fails
    console.error('[Scanner] HTTPS setup failed, falling back to HTTP:', err.message);

    const expressApp = express();
    server = http.createServer(expressApp);

    setupExpressRoutes(expressApp);
    setupSocketIO(server);

    const PORT = 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Scanner] HTTP fallback server → http://${localIP}:${PORT}/scanner`);
    });
  }
}

function setupExpressRoutes(expressApp) {
  expressApp.use(express.static(path.join(__dirname, 'public')));
  expressApp.get('/scanner', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
  });
}

function setupSocketIO(server) {
  const { Server: SIO } = require('socket.io');
  const io = new SIO(server, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log('[Scanner] Mobile client connected:', socket.id);

    socket.on('barcode-scanned', (barcode) => {
      console.log('[Scanner] Barcode received:', barcode);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('barcode-scanned', barcode);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Scanner] Mobile client disconnected:', socket.id);
    });
  });
}

// ---------------------------------------------------------------------------
// 10. App Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  startScannerServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
