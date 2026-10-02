// PharmaSEE — pos.js
// POS Terminal Logic: Barcode scanning, cart management, checkout flow

(() => {
  'use strict';

  // State
  let cart = [];        // [{ product_id, barcode, brand_name, generic_name, selling_price, quantity, subtotal, stock_available }]
  let heldCarts = [];   // saved carts (Hold feature)
  let toastTimer = null;

  // DOM References
  const $barcodeInput   = document.getElementById('barcodeInput');
  const $cartBody       = document.getElementById('cartBody');
  const $cartRows       = document.getElementById('cartRows');
  const $cartEmpty      = document.getElementById('cartEmpty');
  const $cartItemCount  = document.getElementById('cartItemCount');
  const $cartTotalQty   = document.getElementById('cartTotalQty');
  const $cartTotal      = document.getElementById('cartTotal');
  const $tenderInput    = document.getElementById('tenderInput');
  const $changeDisplay  = document.getElementById('changeDisplay');
  const $chargeBtn      = document.getElementById('chargeBtn');
  const $chargeBtnText  = document.getElementById('chargeBtnText');
  const $clearCartBtn   = document.getElementById('clearCartBtn');
  const $holdBtn        = document.getElementById('holdBtn');
  const $scanToast      = document.getElementById('scanToast');

  // Modal
  const $checkoutModal  = document.getElementById('checkoutModal');
  const $modalTxId      = document.getElementById('modalTxId');
  const $modalTotal     = document.getElementById('modalTotal');
  const $modalTendered  = document.getElementById('modalTendered');
  const $modalChange    = document.getElementById('modalChange');
  const $modalCloseBtn  = document.getElementById('modalCloseBtn');

  // Currency Formatter
  const peso = (amount) => '₱' + Number(amount).toFixed(2);

  // Barcode Input Handler
  $barcodeInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const raw = $barcodeInput.value.trim();
    if (!raw) return;

    $barcodeInput.value = '';
    await lookupAndAdd(raw);
  });

  // Mobile scanner barcode event
  window.addEventListener('pharmasee:barcode', (e) => {
    lookupAndAdd(e.detail);
  });

  // Product Lookup + Add to Cart
  async function lookupAndAdd(query) {
    // Try exact barcode match first
    let product = await window.api.getProductByBarcode(query);

    // If no barcode match, search by name across all products
    if (!product) {
      const all = await window.api.getProducts();
      const q = query.toLowerCase();
      product = all.find(p =>
        p.brand_name.toLowerCase().includes(q) ||
        p.generic_name.toLowerCase().includes(q)
      );
    }

    if (!product) {
      showToast('Product not found: ' + query, 'error');
      return;
    }

    addToCart(product);
  }

  // Cart Operations
  function addToCart(product) {
    const existing = cart.find(item => item.product_id === product.id);

    if (existing) {
      // Check stock limit
      if (existing.quantity >= product.stock_quantity) {
        showToast(`Max stock reached for ${product.brand_name} (${product.stock_quantity} available)`, 'warning');
        return;
      }
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.selling_price;
    } else {
      if (product.stock_quantity <= 0) {
        showToast(`${product.brand_name} is out of stock`, 'error');
        return;
      }
      cart.push({
        product_id:      product.id,
        barcode:         product.barcode,
        brand_name:      product.brand_name,
        generic_name:    product.generic_name,
        selling_price:   product.selling_price,
        quantity:        1,
        subtotal:        product.selling_price,
        stock_available: product.stock_quantity,
      });
    }

    showToast(`${product.brand_name} added`, 'success');
    renderCart();
    focusBarcodeInput();
  }

  function updateQuantity(index, newQty) {
    const item = cart[index];
    if (!item) return;

    newQty = parseInt(newQty, 10);
    if (isNaN(newQty) || newQty < 1) {
      removeFromCart(index);
      return;
    }

    if (newQty > item.stock_available) {
      showToast(`Only ${item.stock_available} units available for ${item.brand_name}`, 'warning');
      newQty = item.stock_available;
    }

    item.quantity = newQty;
    item.subtotal = item.quantity * item.selling_price;
    renderCart();
  }

  function removeFromCart(index) {
    const removed = cart.splice(index, 1)[0];
    if (removed) showToast(`${removed.brand_name} removed`, 'info');
    renderCart();
    focusBarcodeInput();
  }

  function clearCart() {
    if (cart.length === 0) return;
    cart = [];
    renderCart();
    $tenderInput.value = '';
    updateChange();
    focusBarcodeInput();
  }

  function holdCart() {
    if (cart.length === 0) return;
    heldCarts.push([...cart]);
    showToast(`Cart held (${heldCarts.length} saved)`, 'info');
    cart = [];
    renderCart();
    $tenderInput.value = '';
    updateChange();
    focusBarcodeInput();
  }

  // Cart Rendering
  function renderCart() {
    if (cart.length === 0) {
      $cartEmpty.classList.remove('hidden');
      $cartRows.innerHTML = '';
    } else {
      $cartEmpty.classList.add('hidden');

      $cartRows.innerHTML = cart.map((item, i) => `
        <div class="grid grid-cols-[3rem_1fr_6rem_7rem_7rem_3rem] gap-2 px-4 py-2.5 border-b border-slate-700/30
                    hover:bg-slate-800/50 transition items-center text-sm group">
          <span class="text-slate-500 text-xs">${i + 1}</span>
          <div class="min-w-0">
            <p class="text-white font-medium truncate">${item.brand_name}</p>
            <p class="text-slate-500 text-xs truncate">${item.generic_name}</p>
          </div>
          <div class="flex items-center justify-center gap-1">
            <button onclick="window._pos.updateQty(${i}, ${item.quantity - 1})"
                    class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold flex items-center justify-center transition">−</button>
            <input type="number" min="1" max="${item.stock_available}" value="${item.quantity}"
                   onchange="window._pos.updateQty(${i}, this.value)"
                   class="w-10 text-center bg-transparent text-white text-sm font-semibold border-b border-slate-600 focus:border-brand-500 focus:outline-none">
            <button onclick="window._pos.updateQty(${i}, ${item.quantity + 1})"
                    class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold flex items-center justify-center transition">+</button>
          </div>
          <span class="text-right text-slate-300">${peso(item.selling_price)}</span>
          <span class="text-right text-white font-semibold">${peso(item.subtotal)}</span>
          <button onclick="window._pos.remove(${i})"
                  class="w-6 h-6 rounded hover:bg-red-900/40 text-slate-600 hover:text-red-400 flex items-center justify-center transition opacity-0 group-hover:opacity-100">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `).join('');
    }

    // Update summary
    const totalQty    = cart.reduce((s, i) => s + i.quantity, 0);
    const totalAmount = cart.reduce((s, i) => s + i.subtotal, 0);

    $cartItemCount.textContent = cart.length;
    $cartTotalQty.textContent  = totalQty;
    $cartTotal.textContent     = peso(totalAmount);
    $chargeBtnText.textContent = `Charge ${peso(totalAmount)}`;
    $chargeBtn.disabled        = cart.length === 0;

    updateChange();
  }

  // Tender / Change Calculation
  $tenderInput.addEventListener('input', updateChange);

  function updateChange() {
    const totalAmount = cart.reduce((s, i) => s + i.subtotal, 0);
    const tendered    = parseFloat($tenderInput.value) || 0;
    const change      = tendered - totalAmount;

    if (tendered > 0 && change >= 0) {
      $changeDisplay.textContent = peso(change);
      $changeDisplay.classList.remove('text-red-400');
      $changeDisplay.classList.add('text-brand-400');
    } else if (tendered > 0) {
      $changeDisplay.textContent = peso(change);
      $changeDisplay.classList.remove('text-brand-400');
      $changeDisplay.classList.add('text-red-400');
    } else {
      $changeDisplay.textContent = '₱0.00';
      $changeDisplay.classList.remove('text-red-400');
      $changeDisplay.classList.add('text-brand-400');
    }
  }

  // Checkout Flow
  $chargeBtn.addEventListener('click', processCheckout);

  async function processCheckout() {
    if (cart.length === 0) return;

    const totalAmount = cart.reduce((s, i) => s + i.subtotal, 0);
    const tendered    = parseFloat($tenderInput.value) || 0;

    // Validate tender amount
    if (tendered < totalAmount) {
      showToast('Insufficient amount tendered', 'error');
      $tenderInput.focus();
      return;
    }

    // Get current session
    const session = await window.api.getSession();
    if (!session) {
      showToast('Session expired. Please log in again.', 'error');
      return;
    }

    // Build cart items for IPC
    const cartItems = cart.map(item => ({
      product_id: item.product_id,
      quantity:   item.quantity,
      unit_price: item.selling_price,
      subtotal:   item.subtotal,
    }));

    // Disable button during processing
    $chargeBtn.disabled = true;
    $chargeBtnText.textContent = 'Processing…';

    try {
      const result = await window.api.checkout(cartItems, session.id);

      if (result.success) {
        const change = tendered - totalAmount;

        // Show success modal
        $modalTxId.textContent      = `TX #${String(result.transactionId).padStart(4, '0')}`;
        $modalTotal.textContent     = peso(totalAmount);
        $modalTendered.textContent  = peso(tendered);
        $modalChange.textContent    = peso(change);
        $checkoutModal.classList.remove('hidden');

        // Reset cart
        cart = [];
        renderCart();
        $tenderInput.value = '';
        updateChange();
      } else {
        showToast('Checkout failed: ' + result.message, 'error');
      }
    } catch (err) {
      showToast('Checkout error: ' + err.message, 'error');
      console.error('[POS] Checkout error:', err);
    } finally {
      $chargeBtn.disabled = false;
      renderCart(); // re-render to update button text
    }
  }

  // Modal Close
  $modalCloseBtn.addEventListener('click', () => {
    $checkoutModal.classList.add('hidden');
    focusBarcodeInput();
  });

  // Close modal on Escape
  $checkoutModal.addEventListener('click', (e) => {
    if (e.target === $checkoutModal) {
      $checkoutModal.classList.add('hidden');
      focusBarcodeInput();
    }
  });

  // Button Handlers
  $clearCartBtn.addEventListener('click', clearCart);
  $holdBtn.addEventListener('click', holdCart);

  // Keyboard Shortcuts (POS-specific)
  document.addEventListener('keydown', (e) => {
    // Don't interfere with modals or login
    if (!document.getElementById('appShell') ||
        document.getElementById('appShell').classList.contains('hidden')) return;

    // F5 — focus barcode input
    if (e.key === 'F5') {
      e.preventDefault();
      focusBarcodeInput();
    }

    // F8 — trigger charge
    if (e.key === 'F8') {
      e.preventDefault();
      if (cart.length > 0) processCheckout();
    }

    // Escape — close modal or clear cart
    if (e.key === 'Escape') {
      if (!$checkoutModal.classList.contains('hidden')) {
        $checkoutModal.classList.add('hidden');
        focusBarcodeInput();
      } else {
        clearCart();
      }
    }

    // Delete — remove last item from cart
    if (e.key === 'Delete' && document.activeElement === $barcodeInput && $barcodeInput.value === '') {
      if (cart.length > 0) removeFromCart(cart.length - 1);
    }
  });

  // Toast Notifications
  function showToast(message, type = 'info') {
    const colors = {
      success: 'bg-brand-900/50 border border-brand-500/30 text-brand-300',
      error:   'bg-red-900/50 border border-red-500/30 text-red-300',
      warning: 'bg-amber-900/50 border border-amber-500/30 text-amber-300',
      info:    'bg-slate-800 border border-slate-600/30 text-slate-300',
    };

    const icons = {
      success: '✓',
      error:   '✕',
      warning: '⚠',
      info:    'ℹ',
    };

    $scanToast.className = `mt-3 rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-all ${colors[type] || colors.info}`;
    $scanToast.innerHTML = `<span class="text-base">${icons[type] || icons.info}</span> ${message}`;
    $scanToast.classList.remove('hidden');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $scanToast.classList.add('hidden');
    }, 2500);
  }

  // Focus Helper
  function focusBarcodeInput() {
    setTimeout(() => $barcodeInput.focus(), 50);
  }

  // Expose methods for inline onclick handlers
  window._pos = {
    updateQty: updateQuantity,
    remove:    removeFromCart,
  };

})();
