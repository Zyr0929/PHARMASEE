// ============================================================================
// PharmaSEE — reports.js
// Reports & Analytics: Sales reports, Chart.js charts, financial summaries
// ============================================================================

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // DOM References
  // -------------------------------------------------------------------------
  const $dateFrom       = document.getElementById('rptDateFrom');
  const $dateTo         = document.getElementById('rptDateTo');
  const $btnGenerate    = document.getElementById('btnGenerateReport');
  const $rptRevenue     = document.getElementById('rptRevenue');
  const $rptCOGS        = document.getElementById('rptCOGS');
  const $rptProfit      = document.getElementById('rptProfit');
  const $rptMargin      = document.getElementById('rptMargin');
  const $rptProductCount = document.getElementById('rptProductCount');
  const $rptTopTable    = document.getElementById('rptTopTable');

  // ABC counts
  const $abcCountA    = document.getElementById('abcCountA');
  const $abcCountB    = document.getElementById('abcCountB');
  const $abcCountC    = document.getElementById('abcCountC');
  const $abcCountNone = document.getElementById('abcCountNone');

  // -------------------------------------------------------------------------
  // Currency formatter
  // -------------------------------------------------------------------------
  const peso = (n) => '₱' + Number(n).toFixed(2);
  const pesoShort = (n) => {
    if (n >= 1000000) return '₱' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return '₱' + (n / 1000).toFixed(1) + 'K';
    return '₱' + Number(n).toFixed(2);
  };

  // -------------------------------------------------------------------------
  // Chart instances (need to destroy before re-creating)
  // -------------------------------------------------------------------------
  let salesChart = null;
  let abcChart   = null;

  // -------------------------------------------------------------------------
  // Default date range (30 days)
  // -------------------------------------------------------------------------
  function initDates() {
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - 30);
    $dateTo.value   = now.toISOString().slice(0, 10);
    $dateFrom.value = past.toISOString().slice(0, 10);
  }

  // -------------------------------------------------------------------------
  // Quick Range Presets
  // -------------------------------------------------------------------------
  function setRange(preset) {
    const now = new Date();
    const from = new Date(now);

    switch (preset) {
      case 'today':
        // from = today
        break;
      case 'week':
        from.setDate(from.getDate() - 7);
        break;
      case 'month':
        from.setDate(from.getDate() - 30);
        break;
      case 'year':
        from.setFullYear(from.getFullYear() - 1);
        break;
    }

    $dateTo.value   = now.toISOString().slice(0, 10);
    $dateFrom.value = from.toISOString().slice(0, 10);
    generateReport();
  }

  // -------------------------------------------------------------------------
  // Generate Report
  // -------------------------------------------------------------------------
  $btnGenerate.addEventListener('click', generateReport);

  async function generateReport() {
    const from = $dateFrom.value;
    const to   = $dateTo.value + ' 23:59:59';

    if (!from || !$dateTo.value) return;

    // Fetch sales data
    const salesData = await window.api.getSalesReport(from, to);
    // Fetch all products for ABC distribution
    const products  = await window.api.getProducts();

    // ---- Financial Summary ----
    let totalRevenue = 0;
    let totalCOGS    = 0;

    for (const row of salesData) {
      totalRevenue += row.total_revenue;
      totalCOGS    += row.total_qty * row.unit_cost;
    }

    const grossProfit  = totalRevenue - totalCOGS;
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    $rptRevenue.textContent = pesoShort(totalRevenue);
    $rptCOGS.textContent    = pesoShort(totalCOGS);
    $rptProfit.textContent  = pesoShort(grossProfit);
    $rptMargin.textContent  = profitMargin.toFixed(1) + '%';

    // Color profit margin
    if (profitMargin >= 30) {
      $rptMargin.className = 'text-2xl font-bold text-brand-400 mt-0.5';
    } else if (profitMargin >= 15) {
      $rptMargin.className = 'text-2xl font-bold text-amber-400 mt-0.5';
    } else {
      $rptMargin.className = 'text-2xl font-bold text-red-400 mt-0.5';
    }

    $rptProductCount.textContent = `${salesData.length} products sold`;

    // ---- Top Products Bar Chart ----
    renderSalesChart(salesData.slice(0, 10));

    // ---- ABC Distribution Doughnut ----
    renderABCChart(products);

    // ---- Top Products Table ----
    renderTopTable(salesData);
  }

  // -------------------------------------------------------------------------
  // Sales Bar Chart (Chart.js)
  // -------------------------------------------------------------------------
  function renderSalesChart(data) {
    const ctx = document.getElementById('chartSales');
    if (!ctx) return;

    if (salesChart) salesChart.destroy();

    const labels   = data.map(d => d.brand_name);
    const revenues = data.map(d => d.total_revenue);
    const profits  = data.map(d => d.total_revenue - (d.total_qty * d.unit_cost));

    salesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Revenue',
            data: revenues,
            backgroundColor: 'rgba(16, 185, 129, 0.6)',
            borderColor: 'rgba(16, 185, 129, 1)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Profit',
            data: profits,
            backgroundColor: 'rgba(99, 102, 241, 0.5)',
            borderColor: 'rgba(99, 102, 241, 1)',
            borderWidth: 1,
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ₱${ctx.parsed.y.toFixed(2)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 },
            grid:  { color: 'rgba(51, 65, 85, 0.3)' }
          },
          y: {
            ticks: {
              color: '#64748b',
              font: { size: 10 },
              callback: (v) => '₱' + v.toLocaleString()
            },
            grid: { color: 'rgba(51, 65, 85, 0.3)' }
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // ABC Doughnut Chart (Chart.js)
  // -------------------------------------------------------------------------
  function renderABCChart(products) {
    const ctx = document.getElementById('chartABC');
    if (!ctx) return;

    if (abcChart) abcChart.destroy();

    const countA    = products.filter(p => p.abc_tier === 'A').length;
    const countB    = products.filter(p => p.abc_tier === 'B').length;
    const countC    = products.filter(p => p.abc_tier === 'C').length;
    const countNone = products.filter(p => !p.abc_tier).length;

    $abcCountA.textContent    = countA;
    $abcCountB.textContent    = countB;
    $abcCountC.textContent    = countC;
    $abcCountNone.textContent = countNone;

    abcChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Tier A', 'Tier B', 'Tier C', 'Unclassified'],
        datasets: [{
          data: [countA, countB, countC, countNone],
          backgroundColor: [
            'rgba(16, 185, 129, 0.7)',   // emerald
            'rgba(245, 158, 11, 0.7)',   // amber
            'rgba(100, 116, 139, 0.7)',  // slate
            'rgba(51, 65, 85, 0.5)',     // dark slate
          ],
          borderColor: [
            'rgba(16, 185, 129, 1)',
            'rgba(245, 158, 11, 1)',
            'rgba(100, 116, 139, 1)',
            'rgba(51, 65, 85, 1)',
          ],
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} products`
            }
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Top Products Table
  // -------------------------------------------------------------------------
  function renderTopTable(data) {
    if (data.length === 0) {
      $rptTopTable.innerHTML = '<div class="text-center py-6 text-slate-500 text-sm">No sales data for this period</div>';
      return;
    }

    $rptTopTable.innerHTML = data.map((row, i) => {
      const profit = row.total_revenue - (row.total_qty * row.unit_cost);
      const profitClass = profit >= 0 ? 'text-brand-400' : 'text-red-400';

      return `
        <div class="grid grid-cols-[2.5rem_1fr_1fr_6rem_6rem_7rem_7rem] gap-2 px-4 py-2 border-b border-slate-700/20 hover:bg-slate-800/40 transition items-center text-sm">
          <span class="text-slate-500 text-xs">${i + 1}</span>
          <span class="text-white text-xs font-medium truncate">${row.brand_name}</span>
          <span class="text-slate-400 text-xs truncate">${row.generic_name}</span>
          <span class="text-right text-slate-300 text-xs">${row.total_qty}</span>
          <span class="text-right text-slate-400 text-xs">${peso(row.unit_cost)}</span>
          <span class="text-right text-white text-xs font-medium">${peso(row.total_revenue)}</span>
          <span class="text-right text-xs font-medium ${profitClass}">${peso(profit)}</span>
        </div>`;
    }).join('');
  }

  // -------------------------------------------------------------------------
  // Auto-load on view switch
  // -------------------------------------------------------------------------
  const observer = new MutationObserver(() => {
    const view = document.getElementById('view-reports');
    if (view && view.classList.contains('active')) {
      if (!$dateFrom.value) initDates();
      generateReport();
    }
  });
  const rptView = document.getElementById('view-reports');
  if (rptView) observer.observe(rptView, { attributes: true, attributeFilter: ['class'] });

  // -------------------------------------------------------------------------
  // Expose for inline handlers
  // -------------------------------------------------------------------------
  window._rpt = {
    setRange,
    generate: generateReport,
  };

  // Initial date setup
  initDates();

})();
