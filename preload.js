// PharmaSEE — preload.js
// Secure bridge between Electron main process and renderer (contextBridge)

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // Auth
  login:        (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout:       ()                   => ipcRenderer.invoke('auth:logout'),
  getSession:   ()                   => ipcRenderer.invoke('auth:session'),

  // Products / Inventory
  getProducts:        ()     => ipcRenderer.invoke('products:getAll'),
  getProductByBarcode:(code) => ipcRenderer.invoke('products:getByBarcode', code),
  addProduct:         (data) => ipcRenderer.invoke('products:add', data),
  updateProduct:      (data) => ipcRenderer.invoke('products:update', data),
  deleteProduct:      (id)   => ipcRenderer.invoke('products:delete', id),
  getLowStock:        ()     => ipcRenderer.invoke('products:lowStock'),

  // POS / Sales
  checkout:  (cartItems, cashierId) => ipcRenderer.invoke('pos:checkout', cartItems, cashierId),

  // Reports & Analytics
  getSalesReport: (from, to) => ipcRenderer.invoke('reports:sales', from, to),

  // Predictive Algorithm
  runABCClassification:  ()   => ipcRenderer.invoke('algo:abc'),
  recalcSafetyReorder:   ()   => ipcRenderer.invoke('algo:safetyReorder'),

  // Audits
  getAudits:    ()     => ipcRenderer.invoke('audits:getAll'),
  submitAudit:  (data) => ipcRenderer.invoke('audits:submit', data),

  // Barcode scanner (Socket.io to IPC push from main)
  onBarcodeScanned: (callback) => {
    ipcRenderer.on('barcode-scanned', (_event, barcode) => callback(barcode));
  },

  // Utility
  getLocalIP: () => ipcRenderer.invoke('util:localIP'),
});
