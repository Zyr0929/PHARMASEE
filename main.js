// PharmaSEE — main.js
// Electron Main Process: Window, IPC Handlers, Express + Socket.io Server

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path   = require('path');
const os     = require('os');
const xlsx   = require('xlsx');

// Express + Socket.io
const express  = require('express');

// Database layer
const {
  db,
  bcrypt,
  stmtGetUserByUsername,
  verifyAdminPassword,
  stmtGetAllProducts,
  stmtGetProductByBarcode,
  stmtGetProductById,
  stmtInsertProduct,
  stmtUpdateProduct,
  stmtSetProductPromo,
  stmtDeleteProduct,
  stmtDeductStock,
  stmtInsertTransaction,
  stmtInsertSaleItem,
  stmtGetSalesInRange,
  stmtGetTransactionsInRange,
  stmtDailyDemand,
  stmtInsertAudit,
  stmtGetAudits,
  stmtUpdateABC,
  stmtUpdateSafetyReorder,
  stmtLowStock,
  runTransaction,
} = require('./db');

// Global state
let mainWindow    = null;
let currentUser   = null;   // { id, username, role }

// 1. Electron Window
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

// 2. IPC Handlers — Auth
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

ipcMain.handle('auth:verifyAdmin', (_event, password) => {
  return verifyAdminPassword(password);
});

// 3. IPC Handlers — Products / Inventory
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

ipcMain.handle('products:setPromo', (_event, data) => {
  try {
    stmtSetProductPromo.run(
      data.promo_type || 'NONE',
      Number(data.promo_value) || 0,
      data.promo_active ? 1 : 0,
      data.id
    );
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 4. IPC Handlers — POS Checkout
ipcMain.handle('pos:checkout', (_event, cartItems, cashierId, discountData) => {
  // cartItems = [{ product_id, quantity, unit_price, subtotal, free_quantity, discount_applied }, …]
  // discountData = { type, amount, subtotal, customerInfo }
  try {
    const result = runTransaction(() => {
      const subtotalAmount = cartItems.reduce((sum, i) => sum + i.subtotal, 0);
      const discountAmount = discountData && discountData.amount ? Number(discountData.amount) : 0;
      const totalAmount    = Math.max(0, subtotalAmount - discountAmount);
      const discountType   = discountData && discountData.type ? discountData.type : 'NONE';
      const customerInfo   = discountData && discountData.customerInfo ? discountData.customerInfo : null;

      const txInfo = stmtInsertTransaction.run(
        cashierId,
        totalAmount,
        subtotalAmount,
        discountType,
        discountAmount,
        customerInfo
      );
      const txId   = txInfo.lastInsertRowid;

      for (const item of cartItems) {
        // Physical inventory units to deduct: item.quantity
        const physicalUnits = item.quantity;
        const changes = stmtDeductStock.run(physicalUnits, item.product_id, physicalUnits);
        if (changes.changes === 0) {
          throw new Error(
            `Insufficient stock for product ID ${item.product_id}`
          );
        }
        stmtInsertSaleItem.run(
          txId,
          item.product_id,
          item.quantity,
          item.unit_price || item.selling_price,
          item.subtotal,
          item.free_quantity || 0,
          item.discount_applied || 0
        );
      }
      return {
        transactionId: txId,
        totalAmount,
        subtotalAmount,
        discountAmount,
        discountType,
        customerInfo
      };
    });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Helper: Escape HTML for receipt
function escapeReceiptHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Generate thermal receipt HTML
function generateReceiptHTML(data) {
  const items = data.items || [];
  const dateStr = data.date || new Date().toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  const txId = data.txId || 'TX #0000';
  const cashier = data.cashier || 'Cashier';
  const subtotal = Number(data.subtotalAmount || 0).toFixed(2);
  const discountAmount = Number(data.discountAmount || 0).toFixed(2);
  const total = Number(data.totalAmount || 0).toFixed(2);
  const tendered = Number(data.tenderedAmount || 0).toFixed(2);
  const change = Number(data.changeAmount || 0).toFixed(2);
  const discountType = data.discountType || 'NONE';
  const customerInfo = data.customerInfo || null;

  let totalQty = 0;
  let itemsRows = '';
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    totalQty += qty;
    const itemTotal = Number(item.subtotal || 0).toFixed(2);
    const unitPrice = Number(item.unit_price || item.selling_price || 0).toFixed(2);
    const promoNote = item.free_quantity > 0
      ? `<div style="font-size:10px;color:#c51017;font-weight:600;">+ ${item.free_quantity} Free Item (B1T1)</div>`
      : '';
    const discountNote = item.discount_applied > 0
      ? `<div style="font-size:10px;color:#c51017;">-₱${Number(item.discount_applied).toFixed(2)} Promo Disc.</div>`
      : '';

    itemsRows += `
      <tr>
        <td style="padding:4px 0;vertical-align:top;">
          <div style="font-weight:700;">${escapeReceiptHtml(item.brand_name || 'Item')}</div>
          ${item.generic_name ? `<div style="font-size:10px;color:#555;">${escapeReceiptHtml(item.generic_name)}</div>` : ''}
          ${promoNote}
          ${discountNote}
        </td>
        <td style="padding:4px 0;text-align:center;vertical-align:top;">${qty}</td>
        <td style="padding:4px 0;text-align:right;vertical-align:top;">₱${unitPrice}</td>
        <td style="padding:4px 0;text-align:right;font-weight:700;vertical-align:top;">₱${itemTotal}</td>
      </tr>
    `;
  }

  let discountBlock = '';
  if (Number(discountAmount) > 0) {
    const discLabel = discountType === 'SENIOR' ? 'Senior Citizen (20%)'
                    : discountType === 'PWD' ? 'PWD (20%)'
                    : `Discount (${discountType})`;
    discountBlock = `
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#156B1F;font-weight:700;">
        <span>${escapeReceiptHtml(discLabel)}:</span>
        <span>-₱${discountAmount}</span>
      </div>
    `;
  }

  let customerBlock = '';
  if (customerInfo) {
    customerBlock = `
      <div style="border-top:1px dashed #bbb;border-bottom:1px dashed #bbb;padding:5px 0;margin:6px 0;font-size:11px;">
        <div><strong>Customer:</strong> ${escapeReceiptHtml(customerInfo)}</div>
        ${discountType !== 'NONE' ? `<div><strong>Category:</strong> ${escapeReceiptHtml(discountType)} (20% Statutory)</div>` : ''}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${escapeReceiptHtml(txId)}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 4mm;
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.35;
      margin: 0;
      padding: 10px 12px;
      color: #000;
      background: #fff;
      width: 80mm;
      box-sizing: border-box;
    }
    .header { text-align: center; margin-bottom: 8px; }
    .store-name { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; }
    .store-sub { font-size: 11px; color: #333; margin-top: 1px; }
    .store-info { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.3; }
    .dashed-line { border-top: 1px dashed #888; margin: 7px 0; }
    .solid-line { border-top: 2px solid #000; margin: 8px 0; }
    .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
    th { border-bottom: 1px dashed #888; padding-bottom: 4px; font-weight: 700; text-align: left; }
    .totals-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px; }
    .grand-total {
      display: flex; justify-content: space-between;
      font-size: 15px; font-weight: 800;
      margin: 6px 0; padding-top: 4px;
      border-top: 1px dashed #444;
    }
    .footer { text-align: center; margin-top: 12px; font-size: 10px; color: #444; }
  </style>
</head>
<body>
  <div class="header">
    <div class="store-name">PharmaSEE</div>
    <div class="store-sub">Pharmacy Inventory & POS</div>
    <div class="store-info">
      123 Healthcare Ave, Manila, Philippines<br>
      TIN: 123-456-789-000 VAT Reg.<br>
      Contact: (02) 8123-4567
    </div>
  </div>

  <div class="dashed-line"></div>

  <div class="meta-row">
    <span><strong>Invoice:</strong> ${escapeReceiptHtml(txId)}</span>
    <span><strong>Cashier:</strong> ${escapeReceiptHtml(cashier)}</span>
  </div>
  <div class="meta-row">
    <span><strong>Date:</strong> ${escapeReceiptHtml(dateStr)}</span>
  </div>

  ${customerBlock}

  <div class="dashed-line"></div>

  <table>
    <thead>
      <tr>
        <th style="width:46%;">Item</th>
        <th style="width:14%;text-align:center;">Qty</th>
        <th style="width:20%;text-align:right;">Price</th>
        <th style="width:20%;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div class="dashed-line"></div>

  <div class="totals-row">
    <span>Subtotal:</span>
    <span>₱${subtotal}</span>
  </div>

  ${discountBlock}

  <div class="grand-total">
    <span>TOTAL PAYABLE:</span>
    <span>₱${total}</span>
  </div>

  <div class="totals-row">
    <span>Amount Tendered:</span>
    <span>₱${tendered}</span>
  </div>
  <div class="totals-row" style="font-weight:700;">
    <span>Change:</span>
    <span>₱${change}</span>
  </div>

  <div class="solid-line"></div>

  <div class="footer">
    <div><strong>TOTAL ITEMS: ${totalQty}</strong></div>
    <div style="margin-top:4px;font-weight:700;">THANK YOU FOR YOUR PURCHASE!</div>
    <div style="margin-top:2px;">Please keep this receipt for returns/warranty.</div>
    <div style="margin-top:2px;font-style:italic;">This serves as an Official Receipt.</div>
    <div style="margin-top:6px;letter-spacing:1px;font-size:9px;">* * * PHARMASEE POS * * *</div>
  </div>
</body>
</html>`;
}

// 4b. IPC Handler — POS Print Receipt
ipcMain.handle('pos:printReceipt', async (_event, data) => {
  return new Promise((resolve) => {
    try {
      const printWin = new BrowserWindow({
        show: false,
        width: 380,
        height: 600,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        }
      });

      const html = generateReceiptHTML(data);
      printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      printWin.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          printWin.webContents.print({
            silent: false,
            printBackground: true,
          }, (success, failureReason) => {
            if (!printWin.isDestroyed()) printWin.close();
            resolve({ success, message: failureReason || null });
          });
        }, 300);
      });

      printWin.webContents.on('did-fail-load', (_e, code, desc) => {
        if (!printWin.isDestroyed()) printWin.close();
        resolve({ success: false, message: desc });
      });
    } catch (err) {
      resolve({ success: false, message: err.message });
    }
  });
});

// 4c. IPC Handlers — Excel Export & Import for Inventory
ipcMain.handle('export:inventory', async () => {
  try {
    const products = stmtGetAllProducts.all();
    if (!products || products.length === 0) {
      return { success: false, message: 'No products in inventory to export.' };
    }

    const rows = products.map((p, idx) => ({
      'No.': idx + 1,
      'Barcode': p.barcode,
      'Brand Name': p.brand_name,
      'Generic Name': p.generic_name || '',
      'Unit Cost (PHP)': Number(p.unit_cost || 0),
      'Selling Price (PHP)': Number(p.selling_price || 0),
      'Stock Quantity': Number(p.stock_quantity || 0),
      'Lead Time (Days)': Number(p.lead_time_days || 7),
      'ABC Tier': p.abc_tier || 'Unclassified',
      'Safety Stock': Number(p.safety_stock || 0),
      'Reorder Point': Number(p.reorder_point || 0),
      'Promo Type': p.promo_type || 'NONE',
      'Promo Value': Number(p.promo_value || 0),
      'Promo Active': p.promo_active ? 'YES' : 'NO'
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);

    ws['!cols'] = [
      { wch: 6 },  { wch: 18 }, { wch: 22 }, { wch: 30 },
      { wch: 16 }, { wch: 18 }, { wch: 15 }, { wch: 16 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Inventory');

    const nowStr = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Inventory to Excel',
      defaultPath: `PharmaSEE-Inventory-${nowStr}.xlsx`,
      filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    xlsx.writeFile(wb, filePath);
    return { success: true, count: rows.length, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('import:inventory', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Inventory from Excel',
      properties: ['openFile'],
      filters: [
        { name: 'Excel Spreadsheets (*.xlsx, *.xls, *.csv)', extensions: ['xlsx', 'xls', 'csv'] }
      ]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = filePaths[0];
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return { success: false, message: 'Excel workbook contains no sheets.' };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return { success: false, message: 'The selected Excel sheet contains no rows.' };
    }

    let inserted = 0;
    let updated = 0;
    const errors = [];

    function findVal(row, candidates) {
      const keys = Object.keys(row);
      for (const cand of candidates) {
        const foundKey = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== '') {
          return row[foundKey];
        }
      }
      return null;
    }

    runTransaction(() => {
      rawRows.forEach((row, idx) => {
        const rowNum = idx + 2;
        const rawBarcode = findVal(row, ['Barcode', 'barcode', 'Item Code', 'item_code', 'UPC', 'Code']);
        const brandName  = findVal(row, ['Brand Name', 'brand_name', 'Brand', 'brand', 'Product Name', 'product_name', 'Name']);
        const genericName = findVal(row, ['Generic Name', 'generic_name', 'Generic', 'generic']) || '';
        const unitCost   = parseFloat(findVal(row, ['Unit Cost (PHP)', 'Unit Cost', 'unit_cost', 'Cost', 'cost']) || 0);
        const sellingPrice = parseFloat(findVal(row, ['Selling Price (PHP)', 'Selling Price', 'selling_price', 'Price', 'price']) || 0);
        const stockQty   = parseInt(findVal(row, ['Stock Quantity', 'stock_quantity', 'Stock', 'stock', 'Qty', 'qty', 'Quantity']) || 0, 10);
        const leadTime   = parseInt(findVal(row, ['Lead Time (Days)', 'Lead Time', 'lead_time_days', 'lead_time', 'Lead Days']) || 7, 10);
        const rawPromoType = (findVal(row, ['Promo Type', 'promo_type']) || 'NONE').toString().trim().toUpperCase();
        const promoType  = ['B1T1', 'PERCENT', 'FLAT'].includes(rawPromoType) ? rawPromoType : 'NONE';
        const promoVal   = parseFloat(findVal(row, ['Promo Value', 'promo_value']) || 0);
        const rawPromoAct = findVal(row, ['Promo Active', 'promo_active']);
        const promoActive = (rawPromoAct === 'YES' || rawPromoAct === '1' || rawPromoAct === 1 || rawPromoAct === true) ? 1 : 0;

        if (!rawBarcode || String(rawBarcode).trim() === '') {
          errors.push(`Row ${rowNum}: Missing barcode. Skipped.`);
          return;
        }
        if (!brandName || String(brandName).trim() === '') {
          errors.push(`Row ${rowNum}: Missing brand name for barcode "${rawBarcode}". Skipped.`);
          return;
        }

        const barcode = String(rawBarcode).trim();
        const existing = stmtGetProductByBarcode.get(barcode);

        if (existing) {
          stmtUpdateProduct.run({
            id:             existing.id,
            barcode:        barcode,
            brand_name:     String(brandName).trim(),
            generic_name:   String(genericName).trim(),
            unit_cost:      isNaN(unitCost) ? existing.unit_cost : Math.max(0, unitCost),
            selling_price:  isNaN(sellingPrice) ? existing.selling_price : Math.max(0, sellingPrice),
            stock_quantity: isNaN(stockQty) ? existing.stock_quantity : Math.max(0, stockQty),
            lead_time_days: isNaN(leadTime) || leadTime < 1 ? existing.lead_time_days : leadTime,
            promo_type:     promoType,
            promo_value:    isNaN(promoVal) ? 0 : promoVal,
            promo_active:   promoActive
          });
          updated++;
        } else {
          stmtInsertProduct.run({
            barcode:        barcode,
            brand_name:     String(brandName).trim(),
            generic_name:   String(genericName).trim(),
            unit_cost:      isNaN(unitCost) ? 0 : Math.max(0, unitCost),
            selling_price:  isNaN(sellingPrice) ? 0 : Math.max(0, sellingPrice),
            stock_quantity: isNaN(stockQty) ? 0 : Math.max(0, stockQty),
            lead_time_days: isNaN(leadTime) || leadTime < 1 ? 7 : leadTime,
            promo_type:     promoType,
            promo_value:    isNaN(promoVal) ? 0 : promoVal,
            promo_active:   promoActive
          });
          inserted++;
        }
      });
    });

    return {
      success: true,
      total: rawRows.length,
      inserted,
      updated,
      errors
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('inventory:downloadTemplate', async () => {
  try {
    const sampleRows = [
      {
        'Barcode': '4800888100012',
        'Brand Name': 'Biogesic',
        'Generic Name': 'Paracetamol 500mg',
        'Unit Cost (PHP)': 1.50,
        'Selling Price (PHP)': 3.00,
        'Stock Quantity': 500,
        'Lead Time (Days)': 5,
        'Promo Type': 'B1T1',
        'Promo Value': 0,
        'Promo Active': 'YES'
      },
      {
        'Barcode': '4800888200019',
        'Brand Name': 'Neozep Forte',
        'Generic Name': 'Phenylephrine + Chlorphenamine + Paracetamol',
        'Unit Cost (PHP)': 3.00,
        'Selling Price (PHP)': 7.50,
        'Stock Quantity': 300,
        'Lead Time (Days)': 5,
        'Promo Type': 'PERCENT',
        'Promo Value': 10,
        'Promo Active': 'NO'
      },
      {
        'Barcode': '4800888400013',
        'Brand Name': 'Alaxan FR',
        'Generic Name': 'Ibuprofen 200mg + Paracetamol 325mg',
        'Unit Cost (PHP)': 3.50,
        'Selling Price (PHP)': 8.50,
        'Stock Quantity': 400,
        'Lead Time (Days)': 5,
        'Promo Type': 'FLAT',
        'Promo Value': 1.00,
        'Promo Active': 'NO'
      }
    ];

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [
      { wch: 18 }, { wch: 20 }, { wch: 35 }, { wch: 16 }, { wch: 18 },
      { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
    ];
    xlsx.utils.book_append_sheet(wb, ws, 'Product_Template');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Sample Excel Template',
      defaultPath: 'PharmaSEE-Product-Template.xlsx',
      filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    xlsx.writeFile(wb, filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 5. IPC Handlers — Reports
ipcMain.handle('reports:sales', (_event, from, to) => {
  return stmtGetSalesInRange.all(from, to);
});

ipcMain.handle('export:sales', async (_event, from, to) => {
  try {
    const salesProducts = stmtGetSalesInRange.all(from, to);
    const transactions  = stmtGetTransactionsInRange.all(from, to);

    const wb = xlsx.utils.book_new();

    // Sheet 1: Product Sales
    const prodRows = (salesProducts || []).map((p, idx) => {
      const qty = Number(p.total_qty || 0);
      const cost = Number(p.unit_cost || 0);
      const rev = Number(p.total_revenue || 0);
      const cogs = qty * cost;
      const profit = rev - cogs;
      return {
        'Rank': idx + 1,
        'Brand Name': p.brand_name,
        'Generic Name': p.generic_name || '',
        'Unit Cost (PHP)': cost,
        'Qty Sold': qty,
        'Total Revenue (PHP)': rev,
        'Total COGS (PHP)': cogs,
        'Gross Profit (PHP)': profit,
      };
    });
    const wsProds = xlsx.utils.json_to_sheet(prodRows.length ? prodRows : [{ 'Message': 'No sales items recorded in date range' }]);
    wsProds['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
    ];
    xlsx.utils.book_append_sheet(wb, wsProds, 'Product Sales');

    // Sheet 2: Transactions
    const txRows = (transactions || []).map((t) => ({
      'Transaction ID': `TX #${String(t.id).padStart(4, '0')}`,
      'Date & Time': t.transaction_date,
      'Cashier': t.cashier || 'N/A',
      'Subtotal (PHP)': Number(t.subtotal_amount || 0),
      'Discount Type': t.discount_type || 'NONE',
      'Discount (PHP)': Number(t.discount_amount || 0),
      'Total Paid (PHP)': Number(t.total_amount || 0),
      'Customer Info': t.customer_info || 'N/A'
    }));
    const wsTx = xlsx.utils.json_to_sheet(txRows.length ? txRows : [{ 'Message': 'No transactions in date range' }]);
    wsTx['!cols'] = [
      { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 30 }
    ];
    xlsx.utils.book_append_sheet(wb, wsTx, 'Transactions');

    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Sales Report to Excel',
      defaultPath: `PharmaSEE-Sales-${fromDate}-to-${toDate}.xlsx`,
      filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    xlsx.writeFile(wb, filePath);
    return { success: true, filePath, count: transactions.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 6. IPC Handlers — Predictive Algorithm Engine

// ABC Classification
ipcMain.handle('algo:abc', () => {
  const products = stmtGetAllProducts.all();

  // Calculate Annual Consumption Value per product from the last 365 days
  const now   = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const from = yearAgo.toISOString().slice(0, 10);
  const to   = now.toISOString().slice(0, 10) + ' 23:59:59';

  const salesData = stmtGetSalesInRange.all(from, to);

  // Map product_id to total_qty sold
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

// Dynamic Safety Stock & Reorder Point
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

// 7. IPC Handlers — Audits
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

ipcMain.handle('export:audits', async () => {
  try {
    const audits = stmtGetAudits.all();
    if (!audits || audits.length === 0) {
      return { success: false, message: 'No audit records to export.' };
    }

    const rows = audits.map((a, idx) => ({
      'Audit #': idx + 1,
      'Audit Date': a.audit_date,
      'Brand Name': a.brand_name || 'N/A',
      'Generic Name': a.generic_name || 'N/A',
      'System Count': Number(a.system_count || 0),
      'Physical Count': Number(a.physical_count || 0),
      'Variance': Number(a.physical_count - a.system_count),
      'Discrepancy Rate (%)': Number(a.discrepancy_rate || 0),
      'Status': a.system_count > a.physical_count
        ? 'Phantom / Deficit'
        : (a.physical_count > a.system_count ? 'Surplus' : 'Matched')
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 8 },  { wch: 22 }, { wch: 22 }, { wch: 30 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 },
      { wch: 18 }
    ];
    xlsx.utils.book_append_sheet(wb, ws, 'Audits');

    const nowStr = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Audits to Excel',
      defaultPath: `PharmaSEE-Audits-${nowStr}.xlsx`,
      filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    xlsx.writeFile(wb, filePath);
    return { success: true, count: rows.length, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// 8. IPC Utility — Local IP (for mobile scanner URL)
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

// 9. Express + Socket.io  — Mobile Barcode Scanner Server (port 3000)
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

// 10. App Lifecycle
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
