// ═══════════════════════════════════════════════════════════════
// AllMyF — Render Module
// Builds all tab HTML from computed data
// ═══════════════════════════════════════════════════════════════

const Render = (() => {
  const { fmtInr, fmtUsd, fmt, pctStr, pnlClass } = Data;
  let _donutChart = null;
  let _pnlChart   = null;

  // ── UTILITIES ─────────────────────────────────────────────
  function chip(val, prefix = '') {
    const n = parseFloat(val);
    if (isNaN(n)) return `<span class="chip neu">—</span>`;
    const cls = n >= 0 ? 'pos' : 'neg';
    return `<span class="chip ${cls}">${prefix}${pctStr(n)}</span>`;
  }

  function sectionHeader(title, count, badge) {
    return `
      <div class="section-header">
        <span class="section-title">${title}</span>
        ${count !== undefined ? `<span class="section-count">${count}</span>` : ''}
        ${badge ? `<span class="section-badge">${badge}</span>` : ''}
        <span class="section-line"></span>
      </div>`;
  }

  function tableControls(id, totalInr, totalUsd) {
    let stat = '';
    if (totalInr !== undefined) stat += `<span>₹ <span>${fmtInr(totalInr).replace('₹','')}</span></span>`;
    if (totalUsd !== undefined) stat += `<span style="margin-left:12px">$ <span>${fmt(totalUsd, 2)}</span></span>`;
    return `
      <div class="table-controls">
        <input class="search-input" type="text" placeholder="Search…" id="search-${id}" oninput="Render.filterTable('${id}', this.value)">
        <div class="table-stat">${stat}</div>
      </div>`;
  }

  function filterTable(tableId, query) {
    const tbl = document.getElementById(tableId);
    if (!tbl) return;
    const q = query.toLowerCase();
    tbl.querySelectorAll('tbody tr').forEach(row => {
      if (row.classList.contains('subsec-row')) { row.style.display = ''; return; }
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  }

  // ── SUMMARY TAB ───────────────────────────────────────────
  function renderSummary(d) {
    const totalPnl = d.totalCurrent - d.totalInvested;

    const cards = [
      { label: 'Total Portfolio Value', value: fmtInr(d.totalCurrent, true), cls: 'gold big', sub: `vs ₹${fmtInr(d.totalInvested,true).replace('₹','')} invested` },
      { label: 'Total P&L (Open)',   value: fmtInr(totalPnl, true), cls: pnlClass(totalPnl), sub: chip(totalPnl / d.totalInvested * 100) + ' overall return' },
      { label: 'India Equity (Current)', value: fmtInr(d.zEquityTotal.current, true), cls: '', sub: `Invested: ${fmtInr(d.zEquityTotal.invested, true)}` },
      { label: 'India MFs (Current)', value: fmtInr(d.mfTotal.current, true), cls: '', sub: `Invested: ${fmtInr(d.mfTotal.invested, true)}` },
      { label: 'US/Global (Vested)', value: fmtUsd(d.vTotal.current_usd, true), cls: '', sub: `≈ ${fmtInr(d.vTotal.current_inr, true)} · ${fmtUsd(d.vTotal.invested_usd, true)} invested` },
      { label: 'Commodities', value: fmtInr(d.commodityVal, true), cls: '', sub: 'Gold · Silver · SGB' },
      { label: 'Fixed Income', value: fmtInr(d.fiVal, true), cls: '', sub: 'Bonds · FDs · RD' },
      { label: 'Retirement', value: fmtInr(d.retirementVal, true), cls: '', sub: 'eNPS · APY · EPFO' },
      { label: 'USD/INR Rate', value: `₹${fmt(d.usdinr, 2)}`, cls: 'muted', sub: 'Live via Google Finance' },
      { label: 'Apr 2026 Realized', value: fmtInr(parseFloat(d.latestPnl.zerodha_realized_pnl_inr || 0) + parseFloat(d.latestPnl.vested_realized_pnl_inr || 0), true), cls: pnlClass(parseFloat(d.latestPnl.zerodha_realized_pnl_inr || 0)), sub: `Zerodha + Vested` },
      { label: 'Exited Positions', value: fmt(d.soldStocks.length), cls: 'muted', sub: `Total realized: ${fmtInr(d.soldTotal, true)}` },
    ];

    const cardsHtml = `
      <div class="summary-grid">
        ${cards.map((c, i) => `
          <div class="summary-card ${i === 0 ? 'gold' : ''}">
            <div class="card-label">${c.label}</div>
            <div class="card-value ${c.cls}">${c.value}</div>
            <div class="card-sub">${c.sub}</div>
          </div>`).join('')}
      </div>`;

    // Allocation bars
    const barsHtml = d.alloc.map(a => `
      <div class="alloc-row">
        <div class="alloc-row-header">
          <span class="alloc-name">${a.name}</span>
          <span class="alloc-pct">${a.pct.toFixed(1)}% · ${fmtInr(a.value, true)}</span>
        </div>
        <div class="alloc-track">
          <div class="alloc-fill" style="width:${a.pct}%;background:${a.color}"></div>
        </div>
      </div>`).join('');

    // Donut chart data
    const donutLabels = d.alloc.map(a => a.name);
    const donutValues = d.alloc.map(a => a.value);
    const donutColors = d.alloc.map(a => a.color);

    const legendHtml = d.alloc.map(a => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${a.color}"></div>
        <span>${a.name}</span>
        <span class="legend-val">${a.pct.toFixed(1)}%</span>
      </div>`).join('');

    const html = `
      ${sectionHeader('Portfolio Overview')}
      ${cardsHtml}
      ${sectionHeader('Allocation Breakdown')}
      <div class="overview-grid">
        <div class="alloc-card">
          <div class="alloc-title">By Asset Class — current value</div>
          <div class="alloc-bars">${barsHtml}</div>
        </div>
        <div class="chart-card">
          <div class="alloc-title">Allocation Donut</div>
          <canvas id="donut-chart"></canvas>
          <div class="chart-legend">${legendHtml}</div>
        </div>
      </div>`;

    document.getElementById('summary-content').innerHTML = html;

    // Draw donut
    const ctx = document.getElementById('donut-chart')?.getContext('2d');
    if (ctx) {
      if (_donutChart) _donutChart.destroy();
      _donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: donutLabels, datasets: [{ data: donutValues, backgroundColor: donutColors, borderWidth: 0, hoverOffset: 6 }] },
        options: {
          cutout: '68%', responsive: true, plugins: { legend: { display: false }, tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtInr(ctx.parsed, true)}` }
          }},
        }
      });
    }
  }

  // ── INDIA TAB ─────────────────────────────────────────────
  function renderIndia(d) {
    const equityInvested = d.zEquityStocks.reduce((s, h) => s + parseFloat(h.invested_inr || 0), 0);
    const equityCurrent  = d.zEquityStocks.reduce((s, h) => s + parseFloat(h.current_value_inr || 0), 0);

    // Equity table rows (stocks)
    const stockRows = d.zEquityStocks.map(h => `
      <tr>
        <td class="symbol">${h.symbol}</td>
        <td class="right">${fmt(h.quantity)}</td>
        <td class="right">₹${fmt(parseFloat(h.avg_cost_inr), 2)}</td>
        <td class="right">₹${fmt(parseFloat(h.ltp_inr), 2)}</td>
        <td class="right gold">₹${fmt(parseFloat(h.invested_inr), 0)}</td>
        <td class="right">₹${fmt(parseFloat(h.current_value_inr), 0)}</td>
        <td class="right ${pnlClass(h.pnl_inr)}">₹${fmt(parseFloat(h.pnl_inr), 0)}</td>
        <td class="right ${pnlClass(h.net_change_pct)}">${pctStr(h.net_change_pct)}</td>
      </tr>`).join('');

    // REIT rows
    const reitRows = d.zReits.map(h => `
      <tr>
        <td class="symbol">${h.symbol} <span class="tag tag-reit">REIT</span></td>
        <td class="right">${fmt(h.quantity)}</td>
        <td class="right">₹${fmt(parseFloat(h.avg_cost_inr), 2)}</td>
        <td class="right">₹${fmt(parseFloat(h.ltp_inr), 2)}</td>
        <td class="right gold">₹${fmt(parseFloat(h.invested_inr), 0)}</td>
        <td class="right">₹${fmt(parseFloat(h.current_value_inr), 0)}</td>
        <td class="right ${pnlClass(h.pnl_inr)}">₹${fmt(parseFloat(h.pnl_inr), 0)}</td>
        <td class="right ${pnlClass(h.net_change_pct)}">${pctStr(h.net_change_pct)}</td>
      </tr>`).join('');

    // ETF rows
    const etfRows = d.zEtfs.map(h => `
      <tr>
        <td class="symbol">${h.symbol} <span class="tag tag-etf">ETF</span></td>
        <td class="right">${fmt(h.quantity)}</td>
        <td class="right">₹${fmt(parseFloat(h.avg_cost_inr), 2)}</td>
        <td class="right">₹${fmt(parseFloat(h.ltp_inr), 2)}</td>
        <td class="right gold">₹${fmt(parseFloat(h.invested_inr), 0)}</td>
        <td class="right">₹${fmt(parseFloat(h.current_value_inr), 0)}</td>
        <td class="right ${pnlClass(h.pnl_inr)}">₹${fmt(parseFloat(h.pnl_inr), 0)}</td>
        <td class="right ${pnlClass(h.net_change_pct)}">${pctStr(h.net_change_pct)}</td>
      </tr>`).join('');

    // MF rows
    const mfRows = d.mfRows.map(h => `
      <tr>
        <td class="company" style="max-width:300px" title="${h.symbol}">${h.symbol}</td>
        <td class="right">${fmt(parseFloat(h.quantity), 3)}</td>
        <td class="right">₹${fmt(parseFloat(h.avg_cost_inr), 4)}</td>
        <td class="right">₹${fmt(parseFloat(h.ltp_inr), 4)}</td>
        <td class="right gold">₹${fmt(parseFloat(h.invested_inr), 0)}</td>
        <td class="right">₹${fmt(parseFloat(h.current_value_inr), 0)}</td>
        <td class="right ${pnlClass(h.pnl_inr)}">₹${fmt(parseFloat(h.pnl_inr), 0)}</td>
        <td class="right ${pnlClass(h.net_change_pct)}">${pctStr(h.net_change_pct)}</td>
      </tr>`).join('');

    const thRow = `
      <tr>
        <th onclick="Render.sortTable('india-tbl',0)">Symbol<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTable('india-tbl',1)">Qty<span class="sort-icon">⇅</span></th>
        <th class="right">Avg Cost</th>
        <th class="right">LTP</th>
        <th class="right" onclick="Render.sortTable('india-tbl',4)">Invested<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTable('india-tbl',5)">Current<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTable('india-tbl',6)">P&amp;L<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTable('india-tbl',7)">Day %<span class="sort-icon">⇅</span></th>
      </tr>`;

    const html = `
      ${sectionHeader('India Equity & ETFs', d.zEquityRows?.length || d.zEquityStocks.length + d.zReits.length + d.zEtfs.length)}
      <div class="table-wrap">
        ${tableControls('india-tbl', equityCurrent)}
        <div class="table-inner">
          <table id="india-tbl">
            <thead>${thRow}</thead>
            <tbody>
              ${stockRows ? `<tr class="subsec-row"><td colspan="8">STOCKS (${d.zEquityStocks.length})</td></tr>${stockRows}` : ''}
              ${reitRows ? `<tr class="subsec-row"><td colspan="8">REITs (${d.zReits.length})</td></tr>${reitRows}` : ''}
              ${etfRows  ? `<tr class="subsec-row"><td colspan="8">ETFs (${d.zEtfs.length})</td></tr>${etfRows}` : ''}
            </tbody>
          </table>
        </div>
      </div>
      ${sectionHeader('Mutual Funds', d.mfRows.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Fund Name</th>
              <th class="right">Units</th>
              <th class="right">Avg NAV</th>
              <th class="right">Current NAV</th>
              <th class="right">Invested</th>
              <th class="right">Current</th>
              <th class="right">P&amp;L</th>
              <th class="right">Change %</th>
            </tr></thead>
            <tbody>${mfRows}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('india-content').innerHTML = html;
  }

  // ── GLOBAL TAB (VESTED) ────────────────────────────────────
  function renderGlobal(d) {
    const vHold = d.vHold;

    // Group by ticker type
    const stocks  = vHold.filter(h => !['AAPL','AMZN','GOOGL','MSFT','NVDA','META','PLTR','TSLA','MU','TSM'].some(s=>h.symbol===s) && parseFloat(h.quantity||0) < 5 && parseFloat(h.current_value_usd||0) > 10);
    const etfs    = vHold.filter(h => ['VOO','ACES','XAR','MSOS','BOTZ','BOTT'].includes(h.symbol));
    const baskets = vHold.filter(h => !stocks.includes(h) && !etfs.includes(h));

    const rowHtml = (h) => `
      <tr>
        <td class="symbol">${h.symbol}</td>
        <td class="company" title="${h.company_name}">${h.company_name}</td>
        <td class="right">${fmt(parseFloat(h.quantity), 4)}</td>
        <td class="right">$${fmt(parseFloat(h.avg_cost_usd), 2)}</td>
        <td class="right">$${fmt(parseFloat(h.ltp_usd), 2)}</td>
        <td class="right gold">$${fmt(parseFloat(h.invested_usd), 2)}</td>
        <td class="right">$${fmt(parseFloat(h.current_value_usd), 2)}</td>
        <td class="right ${pnlClass(h.pnl_usd)}">$${fmt(parseFloat(h.pnl_usd), 2)}</td>
        <td class="right ${pnlClass(h.pnl_pct)}">${pctStr(h.pnl_pct)}</td>
      </tr>`;

    const th = `<tr>
      <th onclick="Render.sortTable('vested-tbl',0)">Ticker<span class="sort-icon">⇅</span></th>
      <th>Company</th>
      <th class="right">Qty</th>
      <th class="right">Avg Cost</th>
      <th class="right">Price</th>
      <th class="right" onclick="Render.sortTable('vested-tbl',5)">Invested<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',6)">Current<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',7)">P&amp;L $<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',8)">Return %<span class="sort-icon">⇅</span></th>
    </tr>`;

    const html = `
      ${sectionHeader('Vested Holdings', vHold.length, `$${fmt(d.vTotal.current_usd, 0)} current`)}
      <div class="table-wrap">
        ${tableControls('vested-tbl', undefined, d.vTotal.current_usd)}
        <div class="table-inner">
          <table id="vested-tbl">
            <thead>${th}</thead>
            <tbody>
              ${vHold.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('global-content').innerHTML = html;
  }

  // ── FIXED INCOME TAB ──────────────────────────────────────
  function renderFI(d) {
    // Get manual assets for FI
    const bonds = d.manList.filter(m => m.asset_id?.includes('BOND'));
    const fds   = d.manList.filter(m => m.asset_id?.includes('FD'));
    const rds   = d.manList.filter(m => m.asset_id?.includes('RD'));

    const fiRow = (m) => `
      <tr>
        <td>${m.asset_name || m.asset_id}</td>
        <td class="right gold">₹${fmt(parseFloat(m.invested_amount || m.total_invested || 0), 0)}</td>
        <td class="right">${m.interest_rate_pa ? m.interest_rate_pa + '' : '—'}</td>
        <td class="right">${m.maturity_date || '—'}</td>
        <td class="right">${m.currency || 'INR'}</td>
        <td>${m.notes || '—'}</td>
      </tr>`;

    const blankRow = `<tr><td colspan="6" class="empty-state">No data — check manual_assets tab</td></tr>`;

    const html = `
      ${sectionHeader('Bonds', bonds.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Name</th><th class="right">Invested</th><th class="right">Rate % p.a.</th>
              <th class="right">Maturity</th><th class="right">Currency</th><th>Notes</th>
            </tr></thead>
            <tbody>${bonds.length ? bonds.map(fiRow).join('') : blankRow}</tbody>
          </table>
        </div>
      </div>
      ${sectionHeader('Fixed Deposits', fds.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Name</th><th class="right">Amount</th><th class="right">Rate</th>
              <th class="right">Maturity</th><th class="right">Currency</th><th>Notes</th>
            </tr></thead>
            <tbody>${fds.length ? fds.map(fiRow).join('') : blankRow}</tbody>
          </table>
        </div>
      </div>
      ${sectionHeader('Recurring Deposits', rds.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Name</th><th class="right">Balance</th><th class="right">Monthly</th>
              <th class="right">Maturity</th><th class="right">Currency</th><th>Notes</th>
            </tr></thead>
            <tbody>${rds.length ? rds.map(fiRow).join('') : blankRow}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('fi-content').innerHTML = html;
  }

  // ── RETIREMENT TAB ────────────────────────────────────────
  function renderRetirement(d) {
    const retList = d.manList.filter(m => m.asset_id?.includes('PENSION') || m.asset_id?.includes('EPFO'));

    const retRow = (m) => `
      <tr>
        <td>${m.asset_name || m.asset_id}</td>
        <td class="right">₹${fmt(parseFloat(m.invested_amount || m.total_invested || 0), 0)}</td>
        <td class="right gold">₹${fmt(parseFloat(m.current_value || m.current_value_inr || 0), 0)}</td>
        <td class="right ${pnlClass((parseFloat(m.current_value||0))-(parseFloat(m.invested_amount||0)))}">₹${fmt((parseFloat(m.current_value||0))-(parseFloat(m.invested_amount||0)), 0)}</td>
        <td>${m.notes || '—'}</td>
      </tr>`;

    const html = `
      ${sectionHeader('Retirement Accounts', retList.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Account</th><th class="right">Invested</th>
              <th class="right">Current Value</th><th class="right">Growth</th><th>Notes</th>
            </tr></thead>
            <tbody>${retList.length ? retList.map(retRow).join('') : `<tr><td colspan="5" class="empty-state">No retirement data — populate manual_assets tab</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('retirement-content').innerHTML = html;
  }

  // ── HISTORY TAB ───────────────────────────────────────────
  function renderHistory(d) {
    const sold = d.soldStocks;

    // Sold stocks table
    const soldRows = sold.map(s => {
      const pnl = parseFloat(s.realized_pnl_inr || 0);
      return `
        <tr>
          <td class="symbol">${s.symbol}</td>
          <td class="muted">${s.first_buy_date || '—'}</td>
          <td class="muted">${s.last_sell_date || '—'}</td>
          <td class="right">₹${fmt(parseFloat(s.avg_buy_price_inr || 0), 2)}</td>
          <td class="right">₹${fmt(parseFloat(s.avg_sell_price_inr || 0), 2)}</td>
          <td class="right gold">₹${fmt(parseFloat(s.total_cost_inr || 0), 0)}</td>
          <td class="right">₹${fmt(parseFloat(s.total_proceeds_inr || 0), 0)}</td>
          <td class="right ${pnlClass(pnl)}">₹${fmt(pnl, 0)}</td>
          <td class="muted" style="font-size:0.7rem;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${s.data_note}">${s.data_note}</td>
        </tr>`;
    }).join('');

    // Monthly P&L chart (from monthly_pnl array)
    const pnlData = d.monthlyPnl;

    const html = `
      ${sectionHeader('Monthly P&L Record', pnlData.length ? pnlData.length + ' months' : undefined)}
      <div class="history-card">
        <canvas id="pnl-chart" height="80"></canvas>
      </div>
      ${sectionHeader('Exited Positions — Zerodha', sold.length, `Total realized: ${fmtInr(d.soldTotal, true)}`)}
      <div class="table-wrap">
        ${tableControls('sold-tbl', d.soldTotal)}
        <div class="table-inner">
          <table id="sold-tbl">
            <thead><tr>
              <th>Symbol</th><th>First Buy</th><th>Last Sell</th>
              <th class="right">Avg Buy</th><th class="right">Avg Sell</th>
              <th class="right">Cost</th><th class="right">Proceeds</th>
              <th class="right" onclick="Render.sortTable('sold-tbl',7)">Realized P&amp;L<span class="sort-icon">⇅</span></th>
              <th>Note</th>
            </tr></thead>
            <tbody>${sold.length ? soldRows : `<tr><td colspan="9" class="empty-state">No sold positions</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('history-content').innerHTML = html;

    // Draw monthly P&L chart
    if (pnlData.length > 0) {
      const ctx = document.getElementById('pnl-chart')?.getContext('2d');
      if (ctx) {
        if (_pnlChart) _pnlChart.destroy();
        const labels = pnlData.map(p => p.month || '');
        const zRealized = pnlData.map(p => parseFloat(p.zerodha_realized_pnl_inr || 0));
        const vRealized = pnlData.map(p => parseFloat(p.vested_realized_pnl_inr || 0));
        _pnlChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Zerodha Realized (₹)', data: zRealized, backgroundColor: 'rgba(201,168,76,0.7)', borderRadius: 3 },
              { label: 'Vested Realized (₹)', data: vRealized, backgroundColor: 'rgba(61,214,140,0.6)', borderRadius: 3 },
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: '#8A90A0', font: { family: 'JetBrains Mono', size: 11 } } },
              tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ₹${fmt(c.parsed.y, 0)}` } }
            },
            scales: {
              x: { ticks: { color: '#555D70', font: { family: 'JetBrains Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
              y: { ticks: { color: '#555D70', font: { family: 'JetBrains Mono', size: 11 }, callback: v => '₹' + fmt(v, 0) }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
          }
        });
      }
    } else {
      const el = document.getElementById('pnl-chart');
      if (el) el.parentElement.innerHTML = '<div class="empty-state">Monthly P&L data will appear after first month closes</div>';
    }
  }

  // ── SORT TABLE ────────────────────────────────────────────
  let _sortState = {};
  function sortTable(tableId, colIdx) {
    const tbl = document.getElementById(tableId);
    if (!tbl) return;
    const key = `${tableId}-${colIdx}`;
    const asc = _sortState[key] !== true;
    _sortState[key] = asc;

    // Update header styles
    tbl.querySelectorAll('th').forEach((th, i) => {
      th.classList.toggle('sorted', i === colIdx);
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = i === colIdx ? (asc ? '↑' : '↓') : '⇅';
    });

    const tbody = tbl.querySelector('tbody');
    const rows = [...tbody.querySelectorAll('tr:not(.subsec-row)')];
    rows.sort((a, b) => {
      const av = a.cells[colIdx]?.textContent.replace(/[₹$,+%]/g, '').trim() || '';
      const bv = b.cells[colIdx]?.textContent.replace(/[₹$,+%]/g, '').trim() || '';
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  return { renderSummary, renderIndia, renderGlobal, renderFI, renderRetirement, renderHistory, filterTable, sortTable };
})();
