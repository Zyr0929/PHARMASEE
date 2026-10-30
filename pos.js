// PharmaSEE — pos.js
// POS Terminal Logic: Barcode scanning, cart management, setable promos (B1T1/discounts), Senior/PWD authorization flow

(() => {
  'use strict';

  // State
  let cart = [];            // [{ product_id, barcode, brand_name, generic_name, selling_price, quantity, subtotal, stock_available, promo_type, promo_value, promo_active, free_quantity, discount_applied, promo_badge }]
  let heldCarts = [];       // saved carts (Hold feature)
  let appliedDiscount = null; // { type: 'SENIOR'|'PWD', label: string, rate: 0.20, idNumber: string, customerName: string, approvedBy: string, amount: number, customerInfo: string }
  let toastTimer = null;

  // DOM References — Core POS
  const $barcodeInput   = document.getElementById('barcodeInput');
  const $cartBody       = document.getElementById('cartBody');
  const $cartRows       = document.getElementById('cartRows');
  const $cartEmpty      = document.getElementById('cartEmpty');
  const $cartItemCount  = document.getElementById('cartItemCount');
  const $cartTotalQty   = document.getElementById('cartTotalQty');
  const $cartSubtotal   = document.getElementById('cartSubtotal');
  const $cartTotal      = document.getElementById('cartTotal');
  const $tenderInput    = document.getElementById('tenderInput');
  const $changeDisplay  = document.getElementById('changeDisplay');
  const $chargeBtn      = document.getElementById('chargeBtn');
  const $chargeBtnText  = document.getElementById('chargeBtnText');
  const $clearCartBtn   = document.getElementById('clearCartBtn');
  const $holdBtn        = document.getElementById('holdBtn');
  const $scanToast      = document.getElementById('scanToast');

  // DOM References — Discounts & Promos
  const $cartPromoSavingsRow     = document.getElementById('cartPromoSavingsRow');
  const $cartPromoSavings        = document.getElementById('cartPromoSavings');
  const $cartSeniorDiscountRow   = document.getElementById('cartSeniorDiscountRow');
  const $cartSeniorDiscountLabel = document.getElementById('cartSeniorDiscountLabel');
  const $cartSeniorDiscountAmount= document.getElementById('cartSeniorDiscountAmount');
  const $btnOpenSeniorPwd        = document.getElementById('btnOpenSeniorPwd');
  const $seniorPwdActiveBanner   = document.getElementById('seniorPwdActiveBanner');
  const $appliedDiscountLabel    = document.getElementById('appliedDiscountLabel');
  const $appliedCustomerInfo     = document.getElementById('appliedCustomerInfo');
  const $btnRemoveDiscount       = document.getElementById('btnRemoveDiscount');

  // DOM References — Senior/PWD Modal
  const $seniorPwdModal  = document.getElementById('seniorPwdModal');
  const $seniorPwdForm   = document.getElementById('seniorPwdForm');
  const $spCloseBtn      = document.getElementById('spCloseBtn');
  const $spCancelBtn     = document.getElementById('spCancelBtn');
  const $spIdNumber      = document.getElementById('spIdNumber');
  const $spCustomerName  = document.getElementById('spCustomerName');
  const $spAdminPassword = document.getElementById('spAdminPassword');
  const $spError         = document.getElementById('spError');
  const $spSubmitBtn     = document.getElementById('spSubmitBtn');

  // DOM References — Checkout Success Modal
  const $checkoutModal        = document.getElementById('checkoutModal');
  const $modalTxId            = document.getElementById('modalTxId');
  const $modalSubtotalRow     = document.getElementById('modalSubtotalRow');
  const $modalSubtotal        = document.getElementById('modalSubtotal');
  const $modalDiscountRow     = document.getElementById('modalDiscountRow');
  const $modalDiscountLabel   = document.getElementById('modalDiscountLabel');
  const $modalDiscountAmount  = document.getElementById('modalDiscountAmount');
  const $modalCustomerRow     = document.getElementById('modalCustomerRow');
  const $modalCustomerInfo    = document.getElementById('modalCustomerInfo');
  const $modalTotal           = document.getElementById('modalTotal');
  const $modalTendered        = document.getElementById('modalTendered');
  const $modalChange          = document.getElementById('modalChange');
  const $modalCloseBtn        = document.getElementById('modalCloseBtn');

  // Currency Formatter
  const peso = (amount) => '₱' + Number(amount || 0).toFixed(2);

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
        p.barcode.toLowerCase().includes(q) ||
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

  // Recalculate Item Pricing based on Admin-Set Promotion Rules
  function recalculateItem(item) {
    const price = Number(item.selling_price) || 0;
    const qty = Number(item.quantity) || 1;
    let freeQty = 0;
    let lineDiscount = 0;
    let promoBadge = '';

    if (item.promo_active && item.promo_type && item.promo_type !== 'NONE') {
      if (item.promo_type === 'B1T1') {
        // Buy 1 Take 1: for every 2 physical units, 1 unit is free
        freeQty = Math.floor(qty / 2);
        const payableQty = qty - freeQty;
        item.subtotal = payableQty * price;
        lineDiscount = freeQty * price;

        if (freeQty > 0) {
          promoBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-ok-100 text-ok-800 border border-ok-200">B1T1: ${freeQty} Free!</span>`;
        } else {
          promoBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">B1T1: Add 1 for FREE</span>`;
        }
      } else if (item.promo_type === 'PERCENT' && item.promo_value > 0) {
        const discountRate = Number(item.promo_value) / 100;
        const discountPerUnit = price * discountRate;
        lineDiscount = discountPerUnit * qty;
        item.subtotal = (price - discountPerUnit) * qty;
        promoBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">${item.promo_value}% OFF</span>`;
      } else if (item.promo_type === 'FLAT' && item.promo_value > 0) {
        const discountPerUnit = Math.min(price, Number(item.promo_value));
        lineDiscount = discountPerUnit * qty;
        item.subtotal = (price - discountPerUnit) * qty;
        promoBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-200">-₱${item.promo_value} OFF</span>`;
      } else {
        item.subtotal = qty * price;
      }
    } else {
      item.subtotal = qty * price;
    }

    item.free_quantity = freeQty;
    item.discount_applied = lineDiscount;
    item.promo_badge = promoBadge;
    return item;
  }

  // Cart Operations
  function addToCart(product) {
    const existing = cart.find(item => item.product_id === product.id);

    if (existing) {
      // Check physical stock limit
      if (existing.quantity >= product.stock_quantity) {
        showToast(`Max stock reached for ${product.brand_name} (${product.stock_quantity} available)`, 'warning');
        return;
      }
      existing.quantity += 1;
      recalculateItem(existing);
    } else {
      if (product.stock_quantity <= 0) {
        showToast(`${product.brand_name} is out of stock`, 'error');
        return;
      }
      const newItem = {
        product_id:      product.id,
        barcode:         product.barcode,
        brand_name:      product.brand_name,
        generic_name:    product.generic_name,
        selling_price:   product.selling_price,
        quantity:        1,
        stock_available: product.stock_quantity,
        promo_type:      product.promo_type || 'NONE',
        promo_value:     product.promo_value || 0,
        promo_active:    Boolean(product.promo_active),
      };
      recalculateItem(newItem);
      cart.push(newItem);
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
    recalculateItem(item);
    renderCart();
  }

  function removeFromCart(index) {
    const removed = cart.splice(index, 1)[0];
    if (removed) showToast(`${removed.brand_name} removed`, 'info');
    renderCart();
    focusBarcodeInput();
  }

  function clearCart() {
    if (cart.length === 0 && !appliedDiscount) return;
    cart = [];
    appliedDiscount = null;
    renderCart();
    $tenderInput.value = '';
    updateChange();
    focusBarcodeInput();
  }

  function holdCart() {
    if (cart.length === 0) return;
    heldCarts.push({
      items: [...cart],
      discount: appliedDiscount ? { ...appliedDiscount } : null
    });
    showToast(`Cart held (${heldCarts.length} saved)`, 'info');
    cart = [];
    appliedDiscount = null;
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
      appliedDiscount = null;
    } else {
      $cartEmpty.classList.add('hidden');

      $cartRows.innerHTML = cart.map((item, i) => {
        const regularLineTotal = item.selling_price * item.quantity;
        const hasDiscount = item.subtotal < regularLineTotal;

        return `
        <div class="grid grid-cols-[3rem_1fr_6rem_7rem_7rem_3rem] gap-2 px-4 py-2.5 border-b border-[#E0E0E0]
                    hover:bg-[#F8F9FA] transition items-center text-sm group">
          <span class="text-slate-400 text-xs">${i + 1}</span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <p class="text-[#000000] font-semibold truncate">${item.brand_name}</p>
              ${item.promo_badge || ''}
            </div>
            <p class="text-slate-500 text-xs truncate">${item.generic_name}</p>
          </div>
          <div class="flex items-center justify-center gap-1">
            <button onclick="window._pos.updateQty(${i}, ${item.quantity - 1})"
                    class="w-6 h-6 rounded bg-[#E0E0E0] hover:bg-slate-300 text-[#353535] text-xs font-bold flex items-center justify-center transition">−</button>
            <input type="number" min="1" max="${item.stock_available}" value="${item.quantity}"
                   onchange="window._pos.updateQty(${i}, this.value)"
                   class="w-10 text-center bg-transparent text-[#000000] text-sm font-semibold border-b border-[#E0E0E0] focus:border-brand-600 focus:outline-none">
            <button onclick="window._pos.updateQty(${i}, ${item.quantity + 1})"
                    class="w-6 h-6 rounded bg-[#E0E0E0] hover:bg-slate-300 text-[#353535] text-xs font-bold flex items-center justify-center transition">+</button>
          </div>
          <div class="text-right">
            <span class="text-slate-600 text-sm font-medium">${peso(item.selling_price)}</span>
          </div>
          <div class="text-right">
            ${hasDiscount ? `<span class="block text-xs line-through text-slate-400 font-normal">${peso(regularLineTotal)}</span>` : ''}
            <span class="text-[#000000] font-bold text-sm ${hasDiscount ? 'text-brand-600' : ''}">${peso(item.subtotal)}</span>
          </div>
          <button onclick="window._pos.remove(${i})"
                  class="w-6 h-6 rounded hover:bg-red-50 text-slate-400 hover:text-brand-600 flex items-center justify-center transition opacity-0 group-hover:opacity-100">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `}).join('');
    }

    // Calculations
    const totalQty     = cart.reduce((s, i) => s + i.quantity, 0);
    const cartSubtotal = cart.reduce((s, i) => s + i.subtotal, 0);
    const promoSavings = cart.reduce((s, i) => s + (i.discount_applied || 0), 0);

    // Senior / PWD Discount (20% on cart payable subtotal)
    let seniorDiscount = 0;
    if (appliedDiscount && cart.length > 0) {
      seniorDiscount = Math.round(cartSubtotal * appliedDiscount.rate * 100) / 100;
      appliedDiscount.amount = seniorDiscount;

      $cartSeniorDiscountRow.classList.remove('hidden');
      $cartSeniorDiscountLabel.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        ${appliedDiscount.label}
      `;
      $cartSeniorDiscountAmount.textContent = `-${peso(seniorDiscount)}`;

      $seniorPwdActiveBanner.classList.remove('hidden');
      $btnOpenSeniorPwd.parentElement.classList.add('hidden');
      $appliedDiscountLabel.textContent = appliedDiscount.label;
      $appliedCustomerInfo.textContent = `${appliedDiscount.customerName} (${appliedDiscount.idNumber}) • Appr: ${appliedDiscount.approvedBy}`;
    } else {
      $cartSeniorDiscountRow.classList.add('hidden');
      $seniorPwdActiveBanner.classList.add('hidden');
      $btnOpenSeniorPwd.parentElement.classList.remove('hidden');
    }

    // Promo Savings breakdown display
    if (promoSavings > 0) {
      $cartPromoSavingsRow.classList.remove('hidden');
      $cartPromoSavings.textContent = `-${peso(promoSavings)}`;
    } else {
      $cartPromoSavingsRow.classList.add('hidden');
    }

    const netPayable = Math.max(0, cartSubtotal - seniorDiscount);

    $cartItemCount.textContent = cart.length;
    $cartTotalQty.textContent  = totalQty;
    $cartSubtotal.textContent  = peso(cartSubtotal + promoSavings);
    $cartTotal.textContent     = peso(netPayable);
    $chargeBtnText.textContent = `Charge ${peso(netPayable)}`;
    $chargeBtn.disabled        = cart.length === 0;

    updateChange();
  }

  // Tender / Change Calculation
  $tenderInput.addEventListener('input', updateChange);

  function updateChange() {
    const cartSubtotal   = cart.reduce((s, i) => s + i.subtotal, 0);
    const discountAmount = appliedDiscount ? (appliedDiscount.amount || 0) : 0;
    const netPayable     = Math.max(0, cartSubtotal - discountAmount);
    const tendered       = parseFloat($tenderInput.value) || 0;
    const change         = tendered - netPayable;

    if (tendered > 0 && change >= 0) {
      $changeDisplay.textContent = peso(change);
      $changeDisplay.classList.remove('text-red-400');
      $changeDisplay.classList.add('text-ok-500');
    } else if (tendered > 0) {
      $changeDisplay.textContent = peso(change);
      $changeDisplay.classList.remove('text-ok-500');
      $changeDisplay.classList.add('text-red-400');
    } else {
      $changeDisplay.textContent = '₱0.00';
      $changeDisplay.classList.remove('text-red-400');
      $changeDisplay.classList.add('text-ok-500');
    }
  }

  // Senior / PWD Modal Handlers
  $btnOpenSeniorPwd.addEventListener('click', openSeniorPwdModal);
  $spCloseBtn.addEventListener('click', closeSeniorPwdModal);
  $spCancelBtn.addEventListener('click', closeSeniorPwdModal);
  $seniorPwdModal.addEventListener('click', (e) => {
    if (e.target === $seniorPwdModal) closeSeniorPwdModal();
  });

  function openSeniorPwdModal() {
    if (cart.length === 0) {
      showToast('Add items to cart first before applying discount', 'warning');
      return;
    }
    $spError.classList.add('hidden');
    $spError.textContent = '';
    $seniorPwdForm.reset();
    $seniorPwdModal.classList.remove('hidden');
    setTimeout(() => $spIdNumber.focus(), 60);
  }

  function closeSeniorPwdModal() {
    $seniorPwdModal.classList.add('hidden');
    focusBarcodeInput();
  }

  $btnRemoveDiscount.addEventListener('click', () => {
    appliedDiscount = null;
    showToast('Senior / PWD discount removed', 'info');
    renderCart();
    focusBarcodeInput();
  });

  // Senior / PWD Authorization Form Submit (Admin Password Verification)
  $seniorPwdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $spError.classList.add('hidden');
    $spError.textContent = '';

    const idNumber      = $spIdNumber.value.trim();
    const customerName  = $spCustomerName.value.trim();
    const adminPassword = $spAdminPassword.value;
    const spType        = document.querySelector('input[name="spType"]:checked')?.value || 'SENIOR';

    if (!idNumber || !customerName) {
      $spError.textContent = 'Customer ID number and name are required.';
      $spError.classList.remove('hidden');
      return;
    }

    if (!adminPassword) {
      $spError.textContent = 'Administrator password is required for authorization.';
      $spError.classList.remove('hidden');
      return;
    }

    $spSubmitBtn.disabled = true;
    $spSubmitBtn.textContent = 'Verifying…';

    try {
      const verifyRes = await window.api.verifyAdminPassword(adminPassword);
      if (!verifyRes || !verifyRes.success) {
        $spError.textContent = verifyRes?.message || 'Incorrect administrator password.';
        $spError.classList.remove('hidden');
        $spAdminPassword.select();
        return;
      }

      appliedDiscount = {
        type:         spType,
        label:        spType === 'SENIOR' ? 'Senior Citizen (20%)' : 'PWD (20%)',
        rate:         0.20,
        idNumber,
        customerName,
        approvedBy:   verifyRes.admin.username,
        amount:       0,
        customerInfo: `${customerName} (${idNumber}) • Authorized by Admin: ${verifyRes.admin.username}`,
      };

      closeSeniorPwdModal();
      showToast(`${appliedDiscount.label} authorized by ${verifyRes.admin.username}`, 'success');
      renderCart();
    } catch (err) {
      $spError.textContent = 'Verification error: ' + err.message;
      $spError.classList.remove('hidden');
    } finally {
      $spSubmitBtn.disabled = false;
      $spSubmitBtn.textContent = 'Authorize & Apply';
    }
  });

  // Checkout Flow
  $chargeBtn.addEventListener('click', processCheckout);

  async function processCheckout() {
    if (cart.length === 0) return;

    const cartSubtotal   = cart.reduce((s, i) => s + i.subtotal, 0);
    const discountAmount = appliedDiscount ? (appliedDiscount.amount || 0) : 0;
    const netTotal       = Math.max(0, cartSubtotal - discountAmount);
    const tendered       = parseFloat($tenderInput.value) || 0;

    // Validate tender amount
    if (tendered < netTotal) {
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

    // Build cart items for IPC (stores billing + physical inventory deductions)
    const cartItems = cart.map(item => ({
      product_id:       item.product_id,
      brand_name:       item.brand_name,
      quantity:         item.quantity,
      unit_price:       item.selling_price,
      subtotal:         item.subtotal,
      free_quantity:    item.free_quantity || 0,
      discount_applied: item.discount_applied || 0,
    }));

    const discountPayload = appliedDiscount ? {
      type:         appliedDiscount.type,
      amount:       discountAmount,
      subtotal:     cartSubtotal,
      customerInfo: appliedDiscount.customerInfo,
    } : null;

    // Disable button during processing
    $chargeBtn.disabled = true;
    $chargeBtnText.textContent = 'Processing…';

    try {
      const result = await window.api.checkout(cartItems, session.id, discountPayload);

      if (result.success) {
        const change = tendered - netTotal;

        // Populate success modal
        $modalTxId.textContent     = `TX #${String(result.transactionId).padStart(4, '0')}`;
        $modalTotal.textContent    = peso(netTotal);
        $modalTendered.textContent = peso(tendered);
        $modalChange.textContent   = peso(change);

        if (appliedDiscount && discountAmount > 0) {
          $modalSubtotalRow.classList.remove('hidden');
          $modalSubtotal.textContent = peso(cartSubtotal);

          $modalDiscountRow.classList.remove('hidden');
          $modalDiscountLabel.textContent = appliedDiscount.label;
          $modalDiscountAmount.textContent = `-${peso(discountAmount)}`;

          $modalCustomerRow.classList.remove('hidden');
          $modalCustomerInfo.textContent = `${appliedDiscount.customerName} (${appliedDiscount.idNumber})`;
        } else {
          $modalSubtotalRow.classList.add('hidden');
          $modalDiscountRow.classList.add('hidden');
          $modalCustomerRow.classList.add('hidden');
        }

        $checkoutModal.classList.remove('hidden');

        // Reset cart and applied discount
        cart = [];
        appliedDiscount = null;
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
      renderCart();
    }
  }

  // Modal Close
  $modalCloseBtn.addEventListener('click', () => {
    $checkoutModal.classList.add('hidden');
    focusBarcodeInput();
  });

  // Close modal on Escape or backdrop click
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
    // Don't interfere with login screen
    if (!document.getElementById('appShell') ||
        document.getElementById('appShell').classList.contains('hidden')) return;

    // F5 — focus barcode input
    if (e.key === 'F5') {
      e.preventDefault();
      focusBarcodeInput();
    }

    // F6 — Senior/PWD Discount Modal
    if (e.key === 'F6') {
      e.preventDefault();
      if (cart.length > 0 && !appliedDiscount) {
        openSeniorPwdModal();
      } else if (appliedDiscount) {
        showToast(`${appliedDiscount.label} is already applied`, 'info');
      } else {
        showToast('Add items to cart first', 'warning');
      }
    }

    // F8 — trigger charge
    if (e.key === 'F8') {
      e.preventDefault();
      if (cart.length > 0) processCheckout();
    }

    // Escape — close modals or clear cart
    if (e.key === 'Escape') {
      if (!$seniorPwdModal.classList.contains('hidden')) {
        closeSeniorPwdModal();
      } else if (!$checkoutModal.classList.contains('hidden')) {
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
      success: 'bg-ok-50 border border-ok-200 text-ok-700',
      error:   'bg-red-50 border border-red-200 text-red-700',
      warning: 'bg-amber-50 border border-amber-200 text-amber-800',
      info:    'bg-white border border-[#E0E0E0] text-[#353535]',
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
