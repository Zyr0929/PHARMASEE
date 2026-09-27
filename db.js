// ============================================================================
// PharmaSEE — db.js
// Database Initialization & Helper Functions (better-sqlite3 + bcryptjs)
// ============================================================================

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------------------
// 1. Database Location — stored next to the executable / project root
// ---------------------------------------------------------------------------
const DB_PATH = path.join(__dirname, 'pharmasee.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
// Enforce foreign-key constraints
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// 2. Schema Creation (idempotent — safe to call on every launch)
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK(role IN ('admin', 'cashier')),
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode         TEXT    NOT NULL UNIQUE,
    brand_name      TEXT    NOT NULL,
    generic_name    TEXT    NOT NULL,
    unit_cost       REAL    NOT NULL DEFAULT 0,
    selling_price   REAL    NOT NULL DEFAULT 0,
    stock_quantity  INTEGER NOT NULL DEFAULT 0,
    lead_time_days  INTEGER NOT NULL DEFAULT 7,
    abc_tier        TEXT    DEFAULT NULL CHECK(abc_tier IN ('A', 'B', 'C')),
    safety_stock    REAL    DEFAULT 0,
    reorder_point   REAL    DEFAULT 0,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sales_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT    DEFAULT (datetime('now','localtime')),
    cashier_id       INTEGER NOT NULL,
    total_amount     REAL    NOT NULL DEFAULT 0,
    FOREIGN KEY (cashier_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sales_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id  INTEGER NOT NULL,
    product_id      INTEGER NOT NULL,
    quantity_sold   INTEGER NOT NULL,
    unit_price      REAL    NOT NULL,
    subtotal        REAL    NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES sales_transactions(id),
    FOREIGN KEY (product_id)     REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS inventory_audits (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_date       TEXT    DEFAULT (datetime('now','localtime')),
    product_id       INTEGER NOT NULL,
    system_count     INTEGER NOT NULL,
    physical_count   INTEGER NOT NULL,
    discrepancy_rate REAL    NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// ---------------------------------------------------------------------------
// 3. Seed Default Admin Account (only if no users exist yet)
//    Default credentials:  admin / pharmasee2024
// ---------------------------------------------------------------------------
const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
if (userCount === 0) {
  const hash = bcrypt.hashSync('pharmasee2024', 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  ).run('admin', hash, 'admin');
  console.log('[DB] Default admin account created  (admin / pharmasee2024)');

  // Also seed a cashier account for testing
  const cashierHash = bcrypt.hashSync('cashier123', 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  ).run('cashier', cashierHash, 'cashier');
  console.log('[DB] Default cashier account created (cashier / cashier123)');
}

// ---------------------------------------------------------------------------
// 3b. Seed Sample Products (only if products table is empty)
//     Common Philippine OTC medicines with realistic pricing
// ---------------------------------------------------------------------------
const productCount = db.prepare('SELECT COUNT(*) AS cnt FROM products').get().cnt;
if (productCount === 0) {
  const sampleProducts = [
    { barcode: '4800888100012', brand_name: 'Biogesic',          generic_name: 'Paracetamol 500mg',                          unit_cost: 1.50,  selling_price: 3.00,  stock_quantity: 500, lead_time_days: 5  },
    { barcode: '4800888200019', brand_name: 'Neozep Forte',      generic_name: 'Phenylephrine + Chlorphenamine + Paracetamol',unit_cost: 3.00,  selling_price: 7.50,  stock_quantity: 300, lead_time_days: 5  },
    { barcode: '4800888300016', brand_name: 'Bioflu',            generic_name: 'Phenylephrine + Chlorphenamine + Paracetamol',unit_cost: 4.00,  selling_price: 9.75,  stock_quantity: 250, lead_time_days: 7  },
    { barcode: '4800888400013', brand_name: 'Alaxan FR',         generic_name: 'Ibuprofen 200mg + Paracetamol 325mg',        unit_cost: 3.50,  selling_price: 8.50,  stock_quantity: 400, lead_time_days: 5  },
    { barcode: '4800888500010', brand_name: 'Kremil-S',          generic_name: 'Al Hydroxide + Mg Hydroxide + Simethicone',  unit_cost: 3.00,  selling_price: 7.00,  stock_quantity: 200, lead_time_days: 7  },
    { barcode: '4800888600017', brand_name: 'Diatabs',           generic_name: 'Loperamide 2mg',                             unit_cost: 2.50,  selling_price: 5.50,  stock_quantity: 150, lead_time_days: 7  },
    { barcode: '4800888700014', brand_name: 'Solmux',            generic_name: 'Carbocisteine 500mg',                        unit_cost: 5.00,  selling_price: 11.00, stock_quantity: 350, lead_time_days: 5  },
    { barcode: '4800888800011', brand_name: 'Decolgen No-Drowse',generic_name: 'Phenylpropanolamine + Paracetamol',          unit_cost: 2.80,  selling_price: 6.75,  stock_quantity: 280, lead_time_days: 7  },
    { barcode: '4800888900018', brand_name: 'Medicol Advance',   generic_name: 'Ibuprofen 400mg',                            unit_cost: 4.50,  selling_price: 10.00, stock_quantity: 320, lead_time_days: 5  },
    { barcode: '4800889000014', brand_name: 'Tuseran Forte',     generic_name: 'Dextromethorphan + Phenylpropanolamine',     unit_cost: 5.50,  selling_price: 12.50, stock_quantity: 180, lead_time_days: 7  },
    { barcode: '4800889100011', brand_name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin Trihydrate 500mg',               unit_cost: 3.00,  selling_price: 8.00,  stock_quantity: 10,  lead_time_days: 10 },
    { barcode: '4800889200018', brand_name: 'Losartan 50mg',     generic_name: 'Losartan Potassium 50mg',                    unit_cost: 2.50,  selling_price: 6.50,  stock_quantity: 5,   lead_time_days: 10 },
  ];

  const insertProduct = db.prepare(`
    INSERT INTO products (barcode, brand_name, generic_name, unit_cost, selling_price, stock_quantity, lead_time_days)
    VALUES (@barcode, @brand_name, @generic_name, @unit_cost, @selling_price, @stock_quantity, @lead_time_days)
  `);

  const seedProducts = db.transaction(() => {
    for (const p of sampleProducts) insertProduct.run(p);
  });
  seedProducts();

  console.log(`[DB] Seeded ${sampleProducts.length} sample products`);
}

// ---------------------------------------------------------------------------
// 4. Prepared-statement helpers (exported for use in IPC handlers)
// ---------------------------------------------------------------------------

// ---- Auth ----
const stmtGetUserByUsername = db.prepare(
  'SELECT * FROM users WHERE username = ?'
);

// ---- Products ----
const stmtGetAllProducts = db.prepare(
  'SELECT * FROM products ORDER BY brand_name ASC'
);
const stmtGetProductByBarcode = db.prepare(
  'SELECT * FROM products WHERE barcode = ?'
);
const stmtGetProductById = db.prepare(
  'SELECT * FROM products WHERE id = ?'
);
const stmtInsertProduct = db.prepare(`
  INSERT INTO products (barcode, brand_name, generic_name, unit_cost, selling_price, stock_quantity, lead_time_days)
  VALUES (@barcode, @brand_name, @generic_name, @unit_cost, @selling_price, @stock_quantity, @lead_time_days)
`);
const stmtUpdateProduct = db.prepare(`
  UPDATE products
  SET barcode        = @barcode,
      brand_name     = @brand_name,
      generic_name   = @generic_name,
      unit_cost      = @unit_cost,
      selling_price  = @selling_price,
      stock_quantity = @stock_quantity,
      lead_time_days = @lead_time_days
  WHERE id = @id
`);
const stmtDeleteProduct = db.prepare('DELETE FROM products WHERE id = ?');
const stmtDeductStock = db.prepare(
  'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?'
);

// ---- Sales ----
const stmtInsertTransaction = db.prepare(`
  INSERT INTO sales_transactions (cashier_id, total_amount)
  VALUES (?, ?)
`);
const stmtInsertSaleItem = db.prepare(`
  INSERT INTO sales_items (transaction_id, product_id, quantity_sold, unit_price, subtotal)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtGetSalesInRange = db.prepare(`
  SELECT si.product_id,
         p.brand_name,
         p.generic_name,
         p.unit_cost,
         SUM(si.quantity_sold) AS total_qty,
         SUM(si.subtotal)     AS total_revenue
  FROM sales_items si
  JOIN products p ON p.id = si.product_id
  JOIN sales_transactions st ON st.id = si.transaction_id
  WHERE st.transaction_date BETWEEN ? AND ?
  GROUP BY si.product_id
  ORDER BY total_revenue DESC
`);

// ---- Daily demand (for predictive engine) ----
const stmtDailyDemand = db.prepare(`
  SELECT DATE(st.transaction_date) AS sale_date,
         SUM(si.quantity_sold)      AS daily_qty
  FROM sales_items si
  JOIN sales_transactions st ON st.id = si.transaction_id
  WHERE si.product_id = ?
  GROUP BY DATE(st.transaction_date)
  ORDER BY sale_date
`);

// ---- Audits ----
const stmtInsertAudit = db.prepare(`
  INSERT INTO inventory_audits (product_id, system_count, physical_count, discrepancy_rate)
  VALUES (?, ?, ?, ?)
`);
const stmtGetAudits = db.prepare(`
  SELECT ia.*, p.brand_name, p.generic_name
  FROM inventory_audits ia
  JOIN products p ON p.id = ia.product_id
  ORDER BY ia.audit_date DESC
`);

// ---- Algorithm update helpers ----
const stmtUpdateABC = db.prepare(
  'UPDATE products SET abc_tier = ? WHERE id = ?'
);
const stmtUpdateSafetyReorder = db.prepare(
  'UPDATE products SET safety_stock = ?, reorder_point = ? WHERE id = ?'
);

// ---- Low-stock alert ----
const stmtLowStock = db.prepare(`
  SELECT * FROM products
  WHERE reorder_point > 0 AND stock_quantity <= reorder_point
  ORDER BY stock_quantity ASC
`);

// ---------------------------------------------------------------------------
// 5. Transaction wrapper (for multi-statement POS checkout)
// ---------------------------------------------------------------------------
function runTransaction(fn) {
  const transaction = db.transaction(fn);
  return transaction();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  db,
  bcrypt,
  // Auth
  stmtGetUserByUsername,
  // Products
  stmtGetAllProducts,
  stmtGetProductByBarcode,
  stmtGetProductById,
  stmtInsertProduct,
  stmtUpdateProduct,
  stmtDeleteProduct,
  stmtDeductStock,
  // Sales
  stmtInsertTransaction,
  stmtInsertSaleItem,
  stmtGetSalesInRange,
  stmtDailyDemand,
  // Audits
  stmtInsertAudit,
  stmtGetAudits,
  // Algorithm
  stmtUpdateABC,
  stmtUpdateSafetyReorder,
  stmtLowStock,
  // Utility
  runTransaction,
};
