// PharmaSEE — inventory.js
// Inventory Dashboard: CRUD, Search/Filter, ABC, Safety Stock/ROP, Alerts

(() => {
  'use strict';

  // State
  let allProducts     = [];
  let filteredProducts = [];
  let deleteTargetId  = null;

  // DOM References
  const $invSearch       = document.getElementById('invSearch');
  const $invFilterABC    = document.getElementById('invFilterABC');
  const $invFilterStock  = document.getElementById('invFilterStock');
  const $invTableBody    = document.getElementById('invTableBody');
  const $invRowCount     = document.getElementById('invRowCount');
  const $btnRunABC       = document.getElementById('btnRunABC');
  const $btnRecalcROP    = document.getElementById('btnRecalcROP');
  const $btnAddProduct   = document.getElementById('btnAddProduct');

  // Stats
  const $statTotalProducts = document.getElementById('statTotalProducts');
  const $statStockValue    = document.getElementById('statStockValue');
  const $statLowStock      = document.getElementById('statLowStock');
  const $statOutOfStock    = document.getElementById('statOutOfStock');

  // Product Modal
  const $productModal       = document.getElementById('productModal');
  const $productModalTitle  = document.getElementById('productModalTitle');
  const $productModalClose  = document.getElementById('productModalClose');
  const $productModalCancel = document.getElementById('productModalCancel');
  const $productForm        = document.getElementById('productForm');
  const $productFormError   = document.getElementById('productFormError');
  const $pf_id       = document.getElementById('pf_id');
  const $pf_barcode  = document.getElementById('pf_barcode');
  const $pf_brand    = document.getElementById('pf_brand');
  const $pf_generic  = document.getElementById('pf_generic');
  const $pf_cost     = document.getElementById('pf_cost');
  const $pf_price    = document.getElementById('pf_price');
  const $pf_stock    = document.getElementById('pf_stock');
  const $pf_leadtime = document.getElementById('pf_leadtime');

  // Delete Modal
  const $deleteModal        = document.getElementById('deleteModal');
  const $deleteModalText    = document.getElementById('deleteModalText');
  const $deleteModalCancel  = document.getElementById('deleteModalCancel');
  const $deleteModalConfirm = document.getElementById('deleteModalConfirm');

  // Currency formatter
  const peso = (n) => '₱' + Number(n).toFixed(2);
  const pesoShort = (n) => {
    if (n >= 1000000) return '₱' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return '₱' + (n / 1000).toFixed(1) + 'K';
    return '₱' + Number(n).toFixed(2);
  };

  // Data Loading
  async function loadProducts() {
    try {
      allProducts = await window.api.getProducts();
    } catch (err) {
      console.error('[Inventory] Failed to load products:', err);
      allProducts = [];
    }
    applyFilters();
    updateStats();
  }

  // Filtering & Search
  function applyFilters() {
    const query     = ($invSearch.value || '').toLowerCase().trim();
    const abcFilter = $invFilterABC.value;
    const stockFilter = $invFilterStock.value;

    filteredProducts = allProducts.filter(p => {
      // Text search
      if (query) {
        const match = p.barcode.toLowerCase().includes(query) ||
                      p.brand_name.toLowerCase().includes(query) ||
                      p.generic_name.toLowerCase().includes(query);
        if (!match) return false;
      }

      // ABC filter
      if (abcFilter === 'none' && p.abc_tier !== null) return false;
      if (abcFilter && abcFilter !== 'none' && p.abc_tier !== abcFilter) return false;

      // Stock filter
      if (stockFilter === 'out' && p.stock_quantity > 0) return false;
      if (stockFilter === 'low' && !(p.stock_quantity > 0 && p.reorder_point > 0 && p.stock_quantity <= p.reorder_point)) return false;
      if (stockFilter === 'ok'  && (p.stock_quantity <= 0 || (p.reorder_point > 0 && p.stock_quantity <= p.reorder_point))) return false;

      return true;
    });

    renderTable();
  }

  $invSearch.addEventListener('input', applyFilters);
  $invFilterABC.addEventListener('change', applyFilters);
  $invFilterStock.addEventListener('change', applyFilters);

  // Stats Update
  function updateStats() {
    const total = allProducts.length;
    const stockValue = allProducts.reduce((sum, p) => sum + (p.unit_cost * p.stock_quantity), 0);
    const lowStock = allProducts.filter(p => p.reorder_point > 0 && p.stock_quantity > 0 && p.stock_quantity <= p.reorder_point).length;
    const outOfStock = allProducts.filter(p => p.stock_quantity <= 0).length;

    $statTotalProducts.textContent = total;
    $statStockValue.textContent    = pesoShort(stockValue);
    $statLowStock.textContent      = lowStock;
    $statOutOfStock.textContent    = outOfStock;
  }

  // Table Rendering
  function renderTable() {
    if (filteredProducts.length === 0) {
      $invTableBody.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <svg class="w-14 h-14 text-slate-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
          </svg>
          <p class="text-slate-500 text-sm">No products found</p>
          <p class="text-slate-600 text-xs mt-1">${allProducts.length === 0 ? 'Add your first product to get started' : 'Try adjusting your search or filters'}</p>
        </div>`;
      $invRowCount.textContent = 'Showing 0 products';
      return;
    }

    $invTableBody.innerHTML = filteredProducts.map((p, i) => {
      const isLow  = p.reorder_point > 0 && p.stock_quantity > 0 && p.stock_quantity <= p.reorder_point;
      const isOut   = p.stock_quantity <= 0;
      const rowBg   = isOut  ? 'bg-red-900/10 border-l-2 border-red-500/50'
                    : isLow  ? 'bg-amber-900/10 border-l-2 border-amber-500/50'
                    : 'border-l-2 border-transparent';

      return `
        <div class="grid grid-cols-[3rem_8rem_1fr_1fr_5rem_5.5rem_5rem_4.5rem_5rem_5rem_4rem] gap-1.5 px-4 py-2 border-b border-slate-700/20
                    hover:bg-slate-800/40 transition items-center text-sm ${rowBg} group">
          <span class="text-slate-500 text-xs">${i + 1}</span>
          <span class="font-mono text-xs text-slate-400 truncate">${p.barcode}</span>
          <div class="min-w-0">
            <p class="text-white font-medium truncate text-[13px]">${p.brand_name}</p>
          </div>
          <div class="min-w-0">
            <p class="text-slate-400 text-xs truncate">${p.generic_name}</p>
          </div>
          <span class="text-right text-slate-400 text-xs">${peso(p.unit_cost)}</span>
          <span class="text-right text-white text-xs font-medium">${peso(p.selling_price)}</span>

          <!-- Stock with visual indicator -->
          <div class="text-center">
            <span class="inline-block px-1.5 py-0.5 rounded text-xs font-bold
              ${isOut ? 'bg-red-900/40 text-red-400' : isLow ? 'bg-amber-900/40 text-amber-400' : 'text-slate-300'}">
              ${p.stock_quantity}
            </span>
          </div>

          <!-- ABC Tier Badge -->
          <div class="text-center">
            ${abcBadge(p.abc_tier)}
          </div>

          <!-- ROP -->
          <span class="text-right text-xs ${p.reorder_point > 0 ? 'text-teal-400' : 'text-slate-600'}">${p.reorder_point > 0 ? p.reorder_point.toFixed(1) : '—'}</span>

          <!-- Safety Stock -->
          <span class="text-right text-xs ${p.safety_stock > 0 ? 'text-indigo-400' : 'text-slate-600'}">${p.safety_stock > 0 ? p.safety_stock.toFixed(1) : '—'}</span>

          <!-- Actions -->
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
            <button onclick="window._inv.edit(${p.id})" title="Edit"
                    class="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-blue-400 transition">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/>
              </svg>
            </button>
            <button onclick="window._inv.confirmDelete(${p.id}, '${p.brand_name.replace(/'/g, "\\'")}')" title="Delete"
                    class="p-1 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
              </svg>
            </button>
          </div>
        </div>`;
    }).join('');

    $invRowCount.textContent = `Showing ${filteredProducts.length} of ${allProducts.length} products`;
  }

  // ABC Badge Helper
  function abcBadge(tier) {
    if (tier === 'A') return '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-900/50 text-emerald-400 ring-1 ring-emerald-500/30">A</span>';
    if (tier === 'B') return '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-400 ring-1 ring-amber-500/30">B</span>';
    if (tier === 'C') return '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700/50 text-slate-400 ring-1 ring-slate-500/30">C</span>';
    return '<span class="text-slate-600 text-[10px]">—</span>';
  }

  // Add / Edit Product Modal
  $btnAddProduct.addEventListener('click', () => openProductModal());
  $productModalClose.addEventListener('click', closeProductModal);
  $productModalCancel.addEventListener('click', closeProductModal);
  $productModal.addEventListener('click', (e) => {
    if (e.target === $productModal) closeProductModal();
  });

  function openProductModal(product = null) {
    $productFormError.classList.add('hidden');

    if (product) {
      // Edit mode
      $productModalTitle.textContent = 'Edit Product';
      $pf_id.value       = product.id;
      $pf_barcode.value  = product.barcode;
      $pf_brand.value    = product.brand_name;
      $pf_generic.value  = product.generic_name;
      $pf_cost.value     = product.unit_cost;
      $pf_price.value    = product.selling_price;
      $pf_stock.value    = product.stock_quantity;
      $pf_leadtime.value = product.lead_time_days;
    } else {
      // Add mode
      $productModalTitle.textContent = 'Add Product';
      $pf_id.value = '';
      $productForm.reset();
      $pf_leadtime.value = 7;
    }

    $productModal.classList.remove('hidden');
    $pf_barcode.focus();
  }

  function closeProductModal() {
    $productModal.classList.add('hidden');
  }

  // Form Submit
  $productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $productFormError.classList.add('hidden');

    const data = {
      barcode:        $pf_barcode.value.trim(),
      brand_name:     $pf_brand.value.trim(),
      generic_name:   $pf_generic.value.trim(),
      unit_cost:      parseFloat($pf_cost.value) || 0,
      selling_price:  parseFloat($pf_price.value) || 0,
      stock_quantity: parseInt($pf_stock.value, 10) || 0,
      lead_time_days: parseInt($pf_leadtime.value, 10) || 7,
    };

    // Validation
    if (!data.barcode || !data.brand_name || !data.generic_name) {
      showFormError('Please fill in all required fields.');
      return;
    }
    if (data.selling_price <= 0) {
      showFormError('Selling price must be greater than 0.');
      return;
    }

    const editId = $pf_id.value;
    let result;

    if (editId) {
      // Update
      data.id = parseInt(editId, 10);
      result = await window.api.updateProduct(data);
    } else {
      // Add
      result = await window.api.addProduct(data);
    }

    if (result.success) {
      closeProductModal();
      await loadProducts();
    } else {
      showFormError(result.message || 'Failed to save product.');
    }
  });

  function showFormError(msg) {
    $productFormError.textContent = msg;
    $productFormError.classList.remove('hidden');
  }

  // Edit Product (load data into modal)
  function editProduct(id) {
    const product = allProducts.find(p => p.id === id);
    if (product) openProductModal(product);
  }

  // Delete Product
  function confirmDelete(id, name) {
    deleteTargetId = id;
    $deleteModalText.textContent = `Are you sure you want to delete "${name}"? This action cannot be undone.`;
    $deleteModal.classList.remove('hidden');
  }

  $deleteModalCancel.addEventListener('click', () => {
    $deleteModal.classList.add('hidden');
    deleteTargetId = null;
  });

  $deleteModal.addEventListener('click', (e) => {
    if (e.target === $deleteModal) {
      $deleteModal.classList.add('hidden');
      deleteTargetId = null;
    }
  });

  $deleteModalConfirm.addEventListener('click', async () => {
    if (deleteTargetId === null) return;

    const result = await window.api.deleteProduct(deleteTargetId);
    $deleteModal.classList.add('hidden');

    if (result.success) {
      deleteTargetId = null;
      await loadProducts();
    } else {
      alert('Failed to delete: ' + (result.message || 'Unknown error'));
    }
  });

  // Algorithm Buttons
  $btnRunABC.addEventListener('click', async () => {
    $btnRunABC.disabled = true;
    $btnRunABC.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Running…';

    try {
      const result = await window.api.runABCClassification();
      if (result.success) {
        $btnRunABC.innerHTML = `
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
          </svg>
          Done! (${result.count} products)`;
        setTimeout(() => {
          $btnRunABC.innerHTML = `
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"/>
            </svg>
            Run ABC`;
        }, 3000);
        await loadProducts();
      }
    } catch (err) {
      console.error('[Inventory] ABC error:', err);
    } finally {
      $btnRunABC.disabled = false;
    }
  });

  $btnRecalcROP.addEventListener('click', async () => {
    $btnRecalcROP.disabled = true;
    $btnRecalcROP.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Calculating…';

    try {
      const result = await window.api.recalcSafetyReorder();
      if (result.success) {
        $btnRecalcROP.innerHTML = `
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
          </svg>
          Done! (${result.updated} updated)`;
        setTimeout(() => {
          $btnRecalcROP.innerHTML = `
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.98 14.135a8.25 8.25 0 01-13.803 3.7l-3.181-3.182"/>
            </svg>
            Recalc ROP`;
        }, 3000);
        await loadProducts();
      }
    } catch (err) {
      console.error('[Inventory] ROP error:', err);
    } finally {
      $btnRecalcROP.disabled = false;
    }
  });

  // Auto-refresh when Inventory view becomes active
  const observer = new MutationObserver(() => {
    const invView = document.getElementById('view-inventory');
    if (invView && invView.classList.contains('active')) {
      loadProducts();
    }
  });

  // Observe the inventory view's class changes
  const invView = document.getElementById('view-inventory');
  if (invView) {
    observer.observe(invView, { attributes: true, attributeFilter: ['class'] });
  }

  // Expose for inline onclick handlers
  window._inv = {
    edit:          editProduct,
    confirmDelete: confirmDelete,
    reload:        loadProducts,
  };

  // Initial load (deferred — will fire when view becomes active via observer,
  // but also load now in case the user is already on inventory)
  loadProducts();

})();
