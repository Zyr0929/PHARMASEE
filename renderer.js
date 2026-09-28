// ============================================================================
// PharmaSEE — renderer.js
// Frontend Logic: Authentication, Navigation, Role-Based Access Control
// ============================================================================

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentUser = null;     // { id, username, role }
let currentView = 'pos';    // active view name

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const $loginScreen  = document.getElementById('loginScreen');
const $appShell     = document.getElementById('appShell');
const $loginForm    = document.getElementById('loginForm');
const $loginError   = document.getElementById('loginError');
const $loginErrorText = document.getElementById('loginErrorText');
const $loginBtn     = document.getElementById('loginBtn');
const $loginBtnText = document.getElementById('loginBtnText');
const $loginSpinner = document.getElementById('loginSpinner');
const $logoutBtn    = document.getElementById('logoutBtn');
const $viewTitle    = document.getElementById('viewTitle');
const $userName     = document.getElementById('userName');
const $userRole     = document.getElementById('userRole');
const $userInitial  = document.getElementById('userInitial');
const $scannerURL   = document.getElementById('scannerURL');
const $scannerIPBadge = document.getElementById('scannerIPBadge');
const $lowStockBadge  = document.getElementById('lowStockBadge');
const $lowStockCount  = document.getElementById('lowStockCount');
const $clock        = document.getElementById('clock');

// View title labels
const VIEW_TITLES = {
  pos:       'Point of Sale',
  inventory: 'Inventory Management',
  reports:   'Reports & Analytics',
  audits:    'Stock Audits',
};

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
$loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) return;

  // UI loading state
  $loginBtn.disabled = true;
  $loginBtnText.textContent = 'Signing in…';
  $loginSpinner.classList.remove('hidden');
  $loginError.classList.add('hidden');

  try {
    const result = await window.api.login(username, password);

    if (result.success) {
      currentUser = result.user;
      enterApp();
    } else {
      showLoginError(result.message);
    }
  } catch (err) {
    showLoginError('An unexpected error occurred.');
    console.error('[Auth] Login error:', err);
  } finally {
    $loginBtn.disabled = false;
    $loginBtnText.textContent = 'Sign In';
    $loginSpinner.classList.add('hidden');
  }
});

function showLoginError(message) {
  $loginErrorText.textContent = message;
  $loginError.classList.remove('hidden');
  // Shake animation
  $loginError.animate([
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(0)' },
  ], { duration: 300 });
}

$logoutBtn.addEventListener('click', async () => {
  await window.api.logout();
  currentUser = null;
  exitApp();
});

// ---------------------------------------------------------------------------
// App Enter / Exit
// ---------------------------------------------------------------------------
function enterApp() {
  // Update user display
  $userName.textContent  = currentUser.username;
  $userRole.textContent  = currentUser.role === 'admin' ? 'Administrator' : 'Cashier';
  $userInitial.textContent = currentUser.username.charAt(0).toUpperCase();

  // Apply role-based visibility
  applyRoleAccess();

  // Show app shell, hide login
  $loginScreen.classList.add('hidden');
  $appShell.classList.remove('hidden');

  // Reset to POS view
  navigateTo('pos');

  // Load scanner IP
  loadScannerIP();

  // Check low-stock alerts (admin only)
  if (currentUser.role === 'admin') {
    checkLowStock();
  }

  // Clear login form
  $loginForm.reset();
  $loginError.classList.add('hidden');
}

function exitApp() {
  $appShell.classList.add('hidden');
  $loginScreen.classList.remove('hidden');
  document.getElementById('loginUsername').focus();
}

// ---------------------------------------------------------------------------
// Role-Based Access Control
// ---------------------------------------------------------------------------
function applyRoleAccess() {
  const role = currentUser.role;
  // Hide/show elements marked with data-role
  document.querySelectorAll('[data-role]').forEach(el => {
    if (el.dataset.role === 'admin' && role !== 'admin') {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function navigateTo(viewName) {
  currentView = viewName;

  // Toggle view panels
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  // Toggle nav item active state
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Update header title
  $viewTitle.textContent = VIEW_TITLES[viewName] || viewName;

  // Show/hide scanner IP badge (only on POS view)
  $scannerIPBadge.classList.toggle('hidden', viewName !== 'pos');
}

// Bind sidebar nav clicks
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.view));
});

// Expose globally for the low-stock badge onclick
window.navigateTo = navigateTo;

// ---------------------------------------------------------------------------
// Scanner IP Display
// ---------------------------------------------------------------------------
async function loadScannerIP() {
  try {
    const ip = await window.api.getLocalIP();
    $scannerURL.textContent = `https://${ip}:3000/scanner`;
  } catch {
    $scannerURL.textContent = 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Low-Stock Alert Check
// ---------------------------------------------------------------------------
async function checkLowStock() {
  try {
    const items = await window.api.getLowStock();
    if (items && items.length > 0) {
      $lowStockCount.textContent = items.length;
      $lowStockBadge.classList.remove('hidden');
    } else {
      $lowStockBadge.classList.add('hidden');
    }
  } catch {
    // Silently fail — non-critical
  }
}

// ---------------------------------------------------------------------------
// Clock (top bar)
// ---------------------------------------------------------------------------
function updateClock() {
  const now = new Date();
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
  $clock.textContent = now.toLocaleTimeString('en-PH', opts);
}
updateClock();
setInterval(updateClock, 1000);

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  // F1 — go to POS
  if (e.key === 'F1' && currentUser) {
    e.preventDefault();
    navigateTo('pos');
  }
  // F2 — go to Inventory (admin only)
  if (e.key === 'F2' && currentUser?.role === 'admin') {
    e.preventDefault();
    navigateTo('inventory');
  }
  // F3 — go to Reports (admin only)
  if (e.key === 'F3' && currentUser?.role === 'admin') {
    e.preventDefault();
    navigateTo('reports');
  }
  // F4 — go to Audits (admin only)
  if (e.key === 'F4' && currentUser?.role === 'admin') {
    e.preventDefault();
    navigateTo('audits');
  }
});

// ---------------------------------------------------------------------------
// Mobile Barcode Scanner Listener (Socket.io → IPC → here)
// ---------------------------------------------------------------------------
window.api.onBarcodeScanned((barcode) => {
  console.log('[Scanner] Barcode received via mobile:', barcode);
  // If not on POS view, switch to it
  if (currentView !== 'pos') navigateTo('pos');
  // The POS module (Step 3) will handle the barcode lookup + cart add.
  // For now, fire a custom event that the POS module can listen to.
  window.dispatchEvent(new CustomEvent('pharmasee:barcode', { detail: barcode }));
});

// ---------------------------------------------------------------------------
// Session Persistence Check (on app load)
// ---------------------------------------------------------------------------
(async () => {
  const session = await window.api.getSession();
  if (session) {
    currentUser = session;
    enterApp();
  }
})();
