// PharmaSEE — audits.js
// Stock Audits: Physical count entry, discrepancy rate, audit history

(() => {
  'use strict';

  //Dom Ref
  const $btnNewAudit      = document.getElementById('btnNewAudit');
  const $auditTableBody   = document.getElementById('auditTableBody');
  const $auditStatTotal   = document.getElementById('auditStatTotal');
  const $auditStatAvgDisc = document.getElementById('auditStatAvgDisc');
  const $auditStatGhost   = document.getElementById('auditStatGhost');

  // Modal
  const $auditModal       = document.getElementById('auditModal');
  const $auditModalClose  = document.getElementById('auditModalClose');
  const $auditModalCancel = document.getElementById('auditModalCancel');
  const $auditForm        = document.getElementById('auditForm');
  const $auditFormError   = document.getElementById('auditFormError');
  const $auditPreview     = document.getElementById('auditPreview');
  const $af_product       = document.getElementById('af_product');
  const $af_system        = document.getElementById('af_system');
  const $af_physical      = document.getElementById('af_physical');
  const $af_variance      = document.getElementById('af_variance');
  const $af_discRate      = document.getElementById('af_discRate');

  // State
  let allProducts = [];
  let allAudits   = [];


  // Load Data
  async function loadAudits() {
    try {
      allAudits   = await window.api.getAudits();
      allProducts = await window.api.getProducts();
    } catch (err) {
      console.error('[Audits] Load error:', err);
      allAudits   = [];
      allProducts = [];
    }
    renderTable();
    updateStats();
  }

  // Stats
  function updateStats() {
    const total = allAudits.length;
    $auditStatTotal.textContent = total;

    if (total > 0) {
      const avgDisc = allAudits.reduce((s, a) => s + a.discrepancy_rate, 0) / total;
      $auditStatAvgDisc.textContent = avgDisc.toFixed(1) + '%';

      // Ghost inventory: items where system count > physical count (phantom stock)
      const ghostItems = allAudits.filter(a => a.system_count > a.physical_count).length;
      $auditStatGhost.textContent = ghostItems;
    } else {
      $auditStatAvgDisc.textContent = '0%';
      $auditStatGhost.textContent   = '0';
    }
  }

  // Table Rendering
  function renderTable() {
    if (allAudits.length === 0) {
      $auditTableBody.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm">No audits recorded yet</div>';
      return;
    }

    $auditTableBody.innerHTML = allAudits.map((a, i) => {
      const variance = a.physical_count - a.system_count;
      const varClass = variance === 0 ? 'text-slate-400'
                     : variance > 0   ? 'text-brand-400'
                     : 'text-red-400';
      const varSign  = variance > 0 ? '+' : '';

      const discClass = a.discrepancy_rate === 0 ? 'text-slate-400'
                      : a.discrepancy_rate <= 5  ? 'text-amber-400'
                      : 'text-red-400';

      // Format date
      const dateStr = a.audit_date ? new Date(a.audit_date).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }) : '—';

      return `
        <div class="grid grid-cols-[3rem_1fr_1fr_6rem_6rem_7rem_7rem] gap-2 px-4 py-2 border-b border-slate-700/20
                    hover:bg-slate-800/40 transition items-center text-sm">
          <span class="text-slate-500 text-xs">${i + 1}</span>
          <div class="min-w-0">
            <p class="text-white text-xs font-medium truncate">${a.brand_name || 'Unknown'}</p>
            <p class="text-slate-500 text-[10px] truncate">${a.generic_name || ''}</p>
          </div>
          <span class="text-slate-400 text-xs">${dateStr}</span>
          <span class="text-right text-slate-300 text-xs">${a.system_count}</span>
          <span class="text-right text-white text-xs font-medium">${a.physical_count}</span>
          <span class="text-right text-xs font-medium ${varClass}">${varSign}${variance}</span>
          <span class="text-right text-xs font-medium ${discClass}">${a.discrepancy_rate.toFixed(1)}%</span>
        </div>`;
    }).join('');
  }

  // New Audit Modal
  $btnNewAudit.addEventListener('click', openAuditModal);
  $auditModalClose.addEventListener('click', closeAuditModal);
  $auditModalCancel.addEventListener('click', closeAuditModal);
  $auditModal.addEventListener('click', (e) => {
    if (e.target === $auditModal) closeAuditModal();
  });

  async function openAuditModal() {
    // Populate product dropdown
    allProducts = await window.api.getProducts();

    $af_product.innerHTML = '<option value="">Select a product…</option>';
    for (const p of allProducts) {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = `${p.brand_name} — ${p.generic_name} (Stock: ${p.stock_quantity})`;
      $af_product.appendChild(opt);
    }

    // Reset form
    $af_system.value   = 0;
    $af_physical.value = '';
    $auditPreview.classList.add('hidden');
    $auditFormError.classList.add('hidden');

    $auditModal.classList.remove('hidden');
  }

  function closeAuditModal() {
    $auditModal.classList.add('hidden');
  }

  // Product selection to auto-fill system count
  $af_product.addEventListener('change', () => {
    const productId = parseInt($af_product.value, 10);
    const product   = allProducts.find(p => p.id === productId);
    $af_system.value = product ? product.stock_quantity : 0;
    updatePreview();
  });

  // Physical count change to update preview
  $af_physical.addEventListener('input', updatePreview);

  function updatePreview() {
    const systemCount   = parseInt($af_system.value, 10) || 0;
    const physicalCount = parseInt($af_physical.value, 10);

    if (isNaN(physicalCount) || $af_physical.value === '') {
      $auditPreview.classList.add('hidden');
      return;
    }

    const variance      = physicalCount - systemCount;
    const discRate      = physicalCount === 0 ? 0 : (Math.abs(physicalCount - systemCount) / physicalCount) * 100;
    const varSign       = variance > 0 ? '+' : '';
    const varClass      = variance === 0 ? 'text-slate-400' : variance > 0 ? 'text-brand-400' : 'text-red-400';
    const discClass     = discRate === 0 ? 'text-slate-400' : discRate <= 5 ? 'text-amber-400' : 'text-red-400';

    $af_variance.textContent = `${varSign}${variance}`;
    $af_variance.className   = `font-medium ${varClass}`;
    $af_discRate.textContent = `${discRate.toFixed(1)}%`;
    $af_discRate.className   = `font-medium ${discClass}`;

    $auditPreview.classList.remove('hidden');
  }

  // Form Submit
  $auditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $auditFormError.classList.add('hidden');

    const productId    = parseInt($af_product.value, 10);
    const physicalCount = parseInt($af_physical.value, 10);

    if (!productId || isNaN(physicalCount)) {
      $auditFormError.textContent = 'Please select a product and enter a physical count.';
      $auditFormError.classList.remove('hidden');
      return;
    }

    if (physicalCount < 0) {
      $auditFormError.textContent = 'Physical count cannot be negative.';
      $auditFormError.classList.remove('hidden');
      return;
    }

    try {
      const result = await window.api.submitAudit({
        product_id:     productId,
        physical_count: physicalCount,
      });

      if (result.success) {
        closeAuditModal();
        await loadAudits();
      } else {
        $auditFormError.textContent = result.message || 'Audit submission failed.';
        $auditFormError.classList.remove('hidden');
      }
    } catch (err) {
      $auditFormError.textContent = 'Error: ' + err.message;
      $auditFormError.classList.remove('hidden');
    }
  });

  // Auto-refresh on view switch
  const observer = new MutationObserver(() => {
    const view = document.getElementById('view-audits');
    if (view && view.classList.contains('active')) {
      loadAudits();
    }
  });
  const audView = document.getElementById('view-audits');
  if (audView) observer.observe(audView, { attributes: true, attributeFilter: ['class'] });

  // Initial load
  loadAudits();

})();
