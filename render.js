// ═══════════════════════════════════════════════════════════════
// AllMyF — Render Module
// Phase 5: live NAV rows, gold/silver USD fix, month label fix
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

  // Format ISO date string (YYYY-MM-DD or any parseable) to dd.mm.yyyy
  function fmtDate(raw) {
    if (!raw || raw === '—') return '—';
    const s = String(raw).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '.' + m[2] + '.' + m[1];
    return s;
  }

  // ── MONTH LABEL HELPERS ───────────────────────────────────
  // Root cause of "showing March instead of April":
  // When a cell is date-typed in Google Sheets and Apps Script serialises it
  // via JSON.stringify(), it becomes an ISO UTC string e.g. "2026-03-31T18:30:00.000Z"
  // (April 1 IST = March 31 UTC at 18:30 in India's UTC+5:30 timezone).
  // Splitting on "-" gives month "03" → March.  Fix: add IST offset before extracting month.
  //
  // Both helpers gracefully handle plain "YYYY-MM" strings (text-typed cells).

  const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Returns "Apr '26" format (used in chart labels)
  function fmtMonthShort(raw) {
    const { y, m } = _parseMonth(raw);
    if (y === null) return String(raw || '');
    return MON_SHORT[m] + ' \'' + String(y).slice(2);
  }

  // Returns "Apr 2026" format (used in card labels)
  function fmtMonthLong(raw) {
    const { y, m } = _parseMonth(raw);
    if (y === null) return String(raw || '');
    return MON_SHORT[m] + ' ' + y;
  }

  // Internal: parses raw month value, returns { y: number, m: 0-indexed } or { y: null, m: null }
  function _parseMonth(raw) {
    const s = String(raw || '').trim();
    if (!s) return { y: null, m: null };

    if (s.includes('T')) {
      // ISO datetime from Sheets date cell — convert to IST (+5:30) before reading month
      const utcMs = new Date(s).getTime();
      if (isNaN(utcMs)) return { y: null, m: null };
      const istMs = utcMs + 5.5 * 60 * 60 * 1000;
      const d = new Date(istMs);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };   // getUTCMonth is 0-indexed
    }

    // Plain "YYYY-MM" string
    const parts = s.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;   // convert to 0-indexed
    if (isNaN(y) || isNaN(m)) return { y: null, m: null };
    return { y, m };
  }

  // ── SUMMARY TAB ───────────────────────────────────────────
  function renderSummary(d) {
    const totalPnl = d.totalCurrent - d.totalInvested;
    // Dynamic label: derives month from latest P&L row (handles date-cell timezone bug)
    const pnlLabel = d.latestPnl.month ? fmtMonthLong(d.latestPnl.month) + ' Realized' : 'Realized P&L';

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
      { label: pnlLabel, value: fmtInr(parseFloat(d.latestPnl.zerodha_realized_pnl_inr || 0) + parseFloat(d.latestPnl.vested_realized_pnl_inr || 0), true), cls: pnlClass(parseFloat(d.latestPnl.zerodha_realized_pnl_inr || 0)), sub: `Zerodha + Vested · ${fmtInr(d.soldTotal, true)} lifetime realized` },
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
          cutout: '68%',
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#fff',
              titleColor: '#1e1912',
              bodyColor: '#6b5e50',
              borderColor: 'rgba(42,33,24,0.14)',
              borderWidth: 1,
              padding: 10,
              callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtInr(ctx.parsed, true)}` }
            }
          },
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

    // ── ZERODHA MF ROWS — live NAV from mfapi when available ──
    // h._liveNAV / h._liveCurrent are set by compute() if mfapi matched the fund name.
    // Falls back to ltp_inr / current_value_inr from the monthly snapshot.
    const mfRows = d.mfRows.map(h => {
      const avgNAV    = parseFloat(h.avg_cost_inr);
      const liveNAV   = h._liveNAV !== undefined ? h._liveNAV : parseFloat(h.ltp_inr);
      const liveCurr  = h._liveCurrent !== undefined ? h._liveCurrent : parseFloat(h.current_value_inr);
      const invested  = parseFloat(h.invested_inr || 0);
      const livePnl   = liveCurr - invested;
      const livePct   = invested > 0 ? (livePnl / invested) * 100 : null;
      const navSrc    = h._liveNAV !== undefined ? '' : '';  // no badge; data speaks for itself
      return `
        <tr>
          <td class="company" style="max-width:300px" title="${h.symbol}">${h.symbol}</td>
          <td class="right">${fmt(parseFloat(h.quantity), 3)}</td>
          <td class="right">₹${fmt(avgNAV, 4)}</td>
          <td class="right">₹${fmt(liveNAV, 4)}</td>
          <td class="right gold">₹${fmt(invested, 0)}</td>
          <td class="right">₹${fmt(liveCurr, 0)}</td>
          <td class="right ${pnlClass(livePnl)}">₹${fmt(livePnl, 0)}</td>
          <td class="right ${livePct !== null ? pnlClass(livePct) : ''}">${livePct !== null ? pctStr(livePct) : '—'}</td>
        </tr>`;
    }).join('');

    // India equity headers — use sortTableGrouped to keep Stocks/REITs/ETFs separate
    const thRow = `
      <tr>
        <th onclick="Render.sortTableGrouped('india-tbl',0)">Symbol<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTableGrouped('india-tbl',1)">Qty<span class="sort-icon">⇅</span></th>
        <th class="right">Avg Cost</th>
        <th class="right">LTP</th>
        <th class="right" onclick="Render.sortTableGrouped('india-tbl',4)">Invested<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTableGrouped('india-tbl',5)">Current<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTableGrouped('india-tbl',6)">P&amp;L<span class="sort-icon">⇅</span></th>
        <th class="right" onclick="Render.sortTableGrouped('india-tbl',7)">Day %<span class="sort-icon">⇅</span></th>
      </tr>`;

    // ── NON-ZERODHA MF ROWS — live NAV from mfapi ─────────────
    // m._liveNAV / m._liveCurrent set by compute() via mfCodeMap + mfNavs.
    // Shows "—" in live columns if mfapi was offline or scheme code not found.
    const manMFs = d.manList.filter(m => m.asset_id?.startsWith('MF_'));
    const manMFRows = manMFs.map(m => {
      const units    = parseFloat(m.quantity || 0);
      const invested = parseFloat(m.invested_amount || 0);
      const avgNAV   = units > 0 ? invested / units : 0;
      const liveNAV  = m._liveNAV || 0;
      const liveCurr = m._liveCurrent || 0;
      const livePnl  = liveCurr > 0 ? liveCurr - invested : 0;
      const livePct  = invested > 0 && liveCurr > 0 ? (livePnl / invested) * 100 : null;
      const hasLive  = liveNAV > 0;
      return `
        <tr>
          <td class="company" style="max-width:280px" title="${m.asset_name}">${m.asset_name}</td>
          <td class="right">${fmt(units, 3)}</td>
          <td class="right">₹${fmt(avgNAV, 4)}</td>
          <td class="right">${hasLive ? '₹' + fmt(liveNAV, 4) : '<span class="muted">—</span>'}</td>
          <td class="right gold">₹${fmt(invested, 0)}</td>
          <td class="right">${hasLive ? '₹' + fmt(liveCurr, 0) : '<span class="muted">—</span>'}</td>
          <td class="right ${hasLive ? pnlClass(livePnl) : ''}">${hasLive ? '₹' + fmt(livePnl, 0) : '<span class="muted">—</span>'}</td>
          <td class="right ${hasLive && livePct !== null ? pnlClass(livePct) : ''}">${hasLive && livePct !== null ? pctStr(livePct) : '<span class="muted">—</span>'}</td>
        </tr>`;
    }).join('');

    // Badge shows live NAV count (or falls back to "mfapi.in" label)
    const liveMFCount = manMFs.filter(m => m._liveNAV).length;
    const manMFBadge  = liveMFCount > 0 ? `${liveMFCount}/${manMFs.length} live NAVs` : 'mfapi.in';

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
      ${sectionHeader('Mutual Funds — Zerodha', d.mfRows.length)}
      <div class="table-wrap">
        <div class="table-inner">
          <table id="mf-tbl">
            <thead><tr>
              <th onclick="Render.sortTable('mf-tbl',0)">Fund Name<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('mf-tbl',1)">Units<span class="sort-icon">⇅</span></th>
              <th class="right">Avg NAV</th>
              <th class="right">Current NAV</th>
              <th class="right" onclick="Render.sortTable('mf-tbl',4)">Invested<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('mf-tbl',5)">Current<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('mf-tbl',6)">P&amp;L<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('mf-tbl',7)">Return %<span class="sort-icon">⇅</span></th>
            </tr></thead>
            <tbody>${mfRows}</tbody>
          </table>
        </div>
      </div>
      ${sectionHeader('Mutual Funds — Other Platforms', manMFs.length, manMFBadge)}
      <div class="table-wrap">
        <div class="table-inner">
          <table id="manmf-tbl">
            <thead><tr>
              <th onclick="Render.sortTable('manmf-tbl',0)">Fund Name<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('manmf-tbl',1)">Units<span class="sort-icon">⇅</span></th>
              <th class="right">Avg NAV</th>
              <th class="right">Live NAV</th>
              <th class="right" onclick="Render.sortTable('manmf-tbl',4)">Invested<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('manmf-tbl',5)">Current<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('manmf-tbl',6)">P&amp;L<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('manmf-tbl',7)">Return %<span class="sort-icon">⇅</span></th>
            </tr></thead>
            <tbody>${manMFRows || `<tr><td colspan="8" class="empty-state">No non-Zerodha MF data</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('india-content').innerHTML = html;
  }

  // ── GLOBAL TAB (VESTED) ────────────────────────────────────
  function renderGlobal(d) {
    const vHold = d.vHold;

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
      <th onclick="Render.sortTable('vested-tbl',1)">Company<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',2)">Qty<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',3)">Avg Cost<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',4)">Price<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',5)">Invested<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',6)">Current<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',7)">P&amp;L $<span class="sort-icon">⇅</span></th>
      <th class="right" onclick="Render.sortTable('vested-tbl',8)">Return %<span class="sort-icon">⇅</span></th>
    </tr>`;

    // European funds from manual_assets
    const euFunds = d.manList.filter(m => m.asset_id?.startsWith('EU_'));
    const euRows = euFunds.map(m => {
      const investedUsd = parseFloat(m.invested_amount || 0);
      const currentUsd  = parseFloat(m.current_value || 0);
      const currentInr  = parseFloat(m.current_value_inr || currentUsd * d.usdinr);
      const pnlUsd = currentUsd - investedUsd;
      return `
        <tr>
          <td class="company">${m.asset_name}</td>
          <td class="right gold">$${fmt(investedUsd, 2)}</td>
          <td class="right">$${fmt(currentUsd, 2)}</td>
          <td class="right">₹${fmt(currentInr, 0)}</td>
          <td class="right ${pnlClass(pnlUsd)}">$${fmt(pnlUsd, 2)}</td>
          <td class="right muted">${m.usd_inr_at_snapshot ? '@ ₹' + fmt(parseFloat(m.usd_inr_at_snapshot), 2) : '—'}</td>
        </tr>`;
    }).join('');

    const html = `
      ${sectionHeader('Vested Holdings', vHold.length, `$${fmt(d.vTotal.current_usd, 0)} current`)}
      <div class="table-wrap">
        ${tableControls('vested-tbl', undefined, d.vTotal.current_usd)}
        <div class="table-inner">
          <table id="vested-tbl">
            <thead>${th}</thead>
            <tbody>${vHold.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </div>
      ${sectionHeader('European Funds', euFunds.length, 'Manual · Vested')}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Fund</th>
              <th class="right">Invested $</th>
              <th class="right">Current $</th>
              <th class="right">Current ₹</th>
              <th class="right">P&amp;L $</th>
              <th class="right">FX Used</th>
            </tr></thead>
            <tbody>${euRows || `<tr><td colspan="6" class="empty-state">No European fund data</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('global-content').innerHTML = html;
  }

  // ── FIXED INCOME TAB ──────────────────────────────────────
  function renderFI(d) {
    const bonds = d.manList.filter(m => m.asset_id?.includes('BOND'));
    const fds   = d.manList.filter(m => m.asset_id?.includes('FD'));
    const rds   = d.manList.filter(m => m.asset_id?.includes('RD'));
    const comms = d.manList.filter(m => m.asset_id?.includes('COMMODITY'));

    // ── GOLD / SILVER LIVE PRICE ───────────────────────────────
    // Business Insider formulas return price in USD per troy oz.
    // FX_XAUINR / FX_XAGINR asset_ids hold USD prices (legacy naming; actual value is USD).
    // Conversion: (USD/troy oz) × (INR/USD) / 31.1035 = INR per gram
    const xauUSD = d.lp?.FX_XAUINR?.price || 0;
    const xagUSD = d.lp?.FX_XAGINR?.price || 0;
    const usdinr = d.usdinr || 84.5;
    // xauUSD is ~3200 (reasonable range for gold USD/oz)
    const goldPerGram   = (xauUSD > 100)  ? (xauUSD * usdinr) / 31.1035 : 0;
    // xagUSD is ~30 (reasonable range for silver USD/oz)
    const silverPerGram = (xagUSD > 1)    ? (xagUSD * usdinr) / 31.1035 : 0;

    // Commodity rows
    const commRow = (m) => {
      const qty = parseFloat(m.quantity || 0);
      let currentVal = '—';
      if (m.asset_id.includes('SILVER') && silverPerGram > 0) {
        currentVal = '₹' + fmt(silverPerGram * qty, 0);
      } else if ((m.asset_id.includes('GOLD') || m.asset_id.includes('SGB')) && goldPerGram > 0) {
        currentVal = '₹' + fmt(goldPerGram * qty, 0);
      }
      const investedStr = parseFloat(m.invested_amount || 0) > 0
        ? '₹' + fmt(parseFloat(m.invested_amount), 0) : '—';
      const sipStr = parseFloat(m.monthly_contribution || 0) > 0
        ? '₹' + fmt(parseFloat(m.monthly_contribution), 0) + '/mo' : '—';
      return `
        <tr>
          <td style="min-width:200px">${m.asset_name || m.asset_id}</td>
          <td class="right">${fmt(qty, 3)} ${m.unit || 'g'}</td>
          <td class="right">${sipStr}</td>
          <td class="right gold">${investedStr}</td>
          <td class="right">${currentVal}</td>
        </tr>`;
    };

    // Bond/FD rows — currency-aware amount display
    const fiRow = (m) => {
      const amount = parseFloat(m.invested_amount || m.total_invested || 0);
      const amtStr = m.currency === 'USD' ? `$${fmt(amount, 2)}` : `₹${fmt(amount, 0)}`;
      return `
        <tr>
          <td style="min-width:180px">${m.asset_name || m.asset_id}</td>
          <td class="right gold" style="min-width:100px">${amtStr}</td>
          <td class="right" style="min-width:80px">${m.interest_rate_pa ? m.interest_rate_pa + '%' : '—'}</td>
          <td class="right" style="min-width:100px">${fmtDate(m.maturity_date)}</td>
          <td class="right" style="min-width:70px">${m.currency || 'INR'}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.notes || ''}">${m.notes || '—'}</td>
        </tr>`;
    };

    // RD rows
    const rdRow = (m) => `
      <tr>
        <td style="min-width:180px">${m.asset_name || m.asset_id}</td>
        <td class="right gold" style="min-width:100px">₹${fmt(parseFloat(m.current_value || 0), 0)}</td>
        <td class="right" style="min-width:80px">₹${fmt(parseFloat(m.monthly_contribution || 0), 0)}/mo</td>
        <td class="right" style="min-width:100px">${fmtDate(m.maturity_date)}</td>
        <td class="right" style="min-width:70px">${m.currency || 'INR'}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.notes || ''}">${m.notes || '—'}</td>
      </tr>`;

    const blankRow = `<tr><td colspan="6" class="empty-state">No data — check manual_assets tab</td></tr>`;

    // Live price note: shows computed INR/gram values so user can verify the USD→INR conversion
    const liveNote = goldPerGram > 0
      ? `Live gold ₹${fmt(goldPerGram, 0)}/g · silver ₹${fmt(silverPerGram, 0)}/g`
      : 'Prices not loaded — check FX_XAUINR / FX_XAGINR in live_prices sheet';

    const html = `
      ${sectionHeader('Commodities', comms.length, liveNote)}
      <div class="table-wrap">
        <div class="table-inner">
          <table>
            <thead><tr>
              <th>Asset</th><th class="right">Holding</th><th class="right">Monthly SIP</th>
              <th class="right">Invested</th><th class="right">Current Value</th>
            </tr></thead>
            <tbody>${comms.length ? comms.map(commRow).join('') : blankRow}</tbody>
          </table>
        </div>
      </div>
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
              <th>Name</th><th class="right">Balance</th><th class="right">Monthly SIP</th>
              <th class="right">Maturity</th><th class="right">Currency</th><th>Notes</th>
            </tr></thead>
            <tbody>${rds.length ? rds.map(rdRow).join('') : blankRow}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('fi-content').innerHTML = html;
  }

  // ── RETIREMENT TAB ────────────────────────────────────────
  function renderRetirement(d) {
    const retList = d.manList.filter(m => m.asset_id?.includes('PENSION') || m.asset_id?.includes('EPFO'));

    const retRow = (m) => {
      const invested = parseFloat(m.invested_amount || m.total_invested || 0);
      const current  = parseFloat(m.current_value || m.current_value_inr || 0);
      const growth   = current - invested;
      return `
        <tr>
          <td>${m.asset_name || m.asset_id}</td>
          <td class="right">${invested > 0 ? '₹' + fmt(invested, 0) : '—'}</td>
          <td class="right gold">₹${fmt(current, 0)}</td>
          <td class="right ${invested > 0 ? pnlClass(growth) : ''}">${invested > 0 ? '₹' + fmt(growth, 0) : '—'}</td>
          <td>${m.notes || '—'}</td>
        </tr>`;
    };

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

    const soldRows = sold.map(s => {
      const pnl = parseFloat(s.realized_pnl_inr || 0);
      return `
        <tr>
          <td class="symbol">${s.symbol}</td>
          <td class="muted">${fmtDate(s.first_buy_date)}</td>
          <td class="muted">${fmtDate(s.last_sell_date)}</td>
          <td class="right">₹${fmt(parseFloat(s.avg_buy_price_inr || 0), 2)}</td>
          <td class="right">₹${fmt(parseFloat(s.avg_sell_price_inr || 0), 2)}</td>
          <td class="right gold">₹${fmt(parseFloat(s.total_cost_inr || 0), 0)}</td>
          <td class="right">₹${fmt(parseFloat(s.total_proceeds_inr || 0), 0)}</td>
          <td class="right ${pnlClass(pnl)}">₹${fmt(pnl, 0)}</td>
        </tr>`;
    }).join('');

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
              <th onclick="Render.sortTable('sold-tbl',0)">Symbol<span class="sort-icon">⇅</span></th>
              <th onclick="Render.sortTable('sold-tbl',1)">First Buy<span class="sort-icon">⇅</span></th>
              <th onclick="Render.sortTable('sold-tbl',2)">Last Sell<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('sold-tbl',3)">Avg Buy<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('sold-tbl',4)">Avg Sell<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('sold-tbl',5)">Cost<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('sold-tbl',6)">Proceeds<span class="sort-icon">⇅</span></th>
              <th class="right" onclick="Render.sortTable('sold-tbl',7)">Realized P&amp;L<span class="sort-icon">⇅</span></th>
            </tr></thead>
            <tbody>${sold.length ? soldRows : `<tr><td colspan="8" class="empty-state">No sold positions</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('history-content').innerHTML = html;

    // ── MONTHLY P&L CHART ──────────────────────────────────────
    // Labels: uses fmtMonthShort() which handles the timezone offset bug
    // (Sheets date cell → UTC ISO string → wrong month without IST correction).
    // Chart shows Zerodha realized P&L only, as requested.
    if (pnlData.length > 0) {
      const ctx = document.getElementById('pnl-chart')?.getContext('2d');
      if (ctx) {
        if (_pnlChart) _pnlChart.destroy();
        const labels    = pnlData.map(p => fmtMonthShort(p.month));
        const zRealized = pnlData.map(p => parseFloat(p.zerodha_realized_pnl_inr || 0));
        _pnlChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Zerodha Realized P&L (₹)', data: zRealized, backgroundColor: 'rgba(45,95,168,0.72)', borderRadius: 4 },
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                labels: {
                  color: '#a8967e',
                  font: { family: "'JetBrains Mono', monospace", size: 11 },
                  boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true
                }
              },
              tooltip: {
                backgroundColor: '#fff',
                titleColor: '#1e1912',
                bodyColor: '#6b5e50',
                borderColor: 'rgba(42,33,24,0.14)',
                borderWidth: 1,
                padding: 10,
                callbacks: { label: (c) => ` ${c.dataset.label}: ₹${fmt(c.parsed.y, 0)}` }
              }
            },
            scales: {
              x: {
                ticks: { color: '#a8967e', font: { family: "'JetBrains Mono', monospace", size: 11 } },
                grid:  { color: 'rgba(42,33,24,0.05)' }
              },
              y: {
                ticks: {
                  color: '#a8967e',
                  font: { family: "'JetBrains Mono', monospace", size: 11 },
                  callback: v => '₹' + fmt(v, 0)
                },
                grid: { color: 'rgba(42,33,24,0.05)' }
              }
            }
          }
        });
      }
    } else {
      const el = document.getElementById('pnl-chart');
      if (el) el.parentElement.innerHTML = '<div class="empty-state">Monthly P&L data will appear after first month closes</div>';
    }
  }

  // ── SORT TABLE (flat — for MF, Vested, Sold) ─────────────
  let _sortState = {};

  function sortTable(tableId, colIdx) {
    const tbl = document.getElementById(tableId);
    if (!tbl) return;
    const key = `${tableId}-${colIdx}`;
    const asc = _sortState[key] !== true;
    _sortState[key] = asc;

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

  // ── SORT TABLE GROUPED (group-aware — for India Equity) ───
  function sortTableGrouped(tableId, colIdx) {
    const tbl = document.getElementById(tableId);
    if (!tbl) return;
    const key = `${tableId}-g-${colIdx}`;
    const asc = _sortState[key] !== true;
    _sortState[key] = asc;

    tbl.querySelectorAll('th').forEach((th, i) => {
      th.classList.toggle('sorted', i === colIdx);
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = i === colIdx ? (asc ? '↑' : '↓') : '⇅';
    });

    const tbody = tbl.querySelector('tbody');
    const allRows = [...tbody.children];

    const groups = [];
    let current = null;
    allRows.forEach(row => {
      if (row.classList.contains('subsec-row')) {
        current = { header: row, rows: [] };
        groups.push(current);
      } else if (current) {
        current.rows.push(row);
      }
    });

    const cellVal = (row) => {
      const cell = row.cells[colIdx];
      if (!cell) return '';
      const txt = cell.textContent.replace(/[₹$,+%]/g, '').trim();
      const n = parseFloat(txt);
      return isNaN(n) ? txt : n;
    };

    groups.forEach(g => {
      g.rows.sort((a, b) => {
        const av = cellVal(a), bv = cellVal(b);
        if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    });

    groups.forEach(g => {
      tbody.appendChild(g.header);
      g.rows.forEach(r => tbody.appendChild(r));
    });
  }

  // ── ALERTS TAB ────────────────────────────────────────────
  // Renders anomaly alerts computed by Apps Script computeStockAlerts().
  // Alert types: PRICE_MOVE, QTY_CHANGE, NEW_POSITION, POSITION_CLOSED.
  // Only covers stocks — REITs, ETFs, and MFs are excluded at the source.
  // Requires ≥2 months of zerodha_holdings_import data; shows a placeholder
  // message until May 2026 data is imported.
  function renderAlerts(d) {
    const alerts = d.stockAlerts || [];

    // Type display config: label, badge CSS class, description
    const TYPE_META = {
      PRICE_MOVE:       { label: 'Price Move',       cls: 'alert-price',    icon: '⚡' },
      QTY_CHANGE:       { label: 'Qty Changed',      cls: 'alert-qty',      icon: '🔄' },
      NEW_POSITION:     { label: 'New Position',     cls: 'alert-new',      icon: '✚' },
      POSITION_CLOSED:  { label: 'Position Closed',  cls: 'alert-closed',   icon: '✕' },
    };

    // Sort: PRICE_MOVE first (most actionable), then others; within each group by |change_pct| desc
    const sorted = [...alerts].sort((a, b) => {
      const typeOrder = { PRICE_MOVE: 0, QTY_CHANGE: 1, NEW_POSITION: 2, POSITION_CLOSED: 3 };
      const to = (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      if (to !== 0) return to;
      return Math.abs(parseFloat(b.change_pct) || 0) - Math.abs(parseFloat(a.change_pct) || 0);
    });

    const alertRows = sorted.map(a => {
      const meta      = TYPE_META[a.type] || { label: a.type, cls: '', icon: '•' };
      const changePct = parseFloat(a.change_pct);
      const pctStr2   = !isNaN(changePct)
        ? `<span class="${pnlClass(changePct)}">${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%</span>`
        : '<span class="muted">—</span>';

      const ltpCell  = a.ltp      !== null ? `₹${fmt(a.ltp, 2)}`      : '<span class="muted">—</span>';
      const prevCell = a.prev_ltp !== null ? `₹${fmt(a.prev_ltp, 2)}` : '<span class="muted">—</span>';

      const qtyDelta = a.qty_delta;
      const qtyCell  = qtyDelta !== null && qtyDelta !== undefined
        ? `<span class="${qtyDelta >= 0 ? 'pos' : 'neg'}">${qtyDelta >= 0 ? '+' : ''}${fmt(qtyDelta, 3)}</span>`
        : '<span class="muted">—</span>';

      return `
        <tr>
          <td class="symbol">${a.symbol}</td>
          <td><span class="alert-badge ${meta.cls}">${meta.icon} ${meta.label}</span></td>
          <td class="right">${prevCell}</td>
          <td class="right">${ltpCell}</td>
          <td class="right">${pctStr2}</td>
          <td class="right">${fmt(a.prev_qty, 3) || '<span class="muted">—</span>'}</td>
          <td class="right">${fmt(a.qty, 3)}</td>
          <td class="right">${qtyCell}</td>
        </tr>`;
    }).join('');

    // Summary stats
    const priceMoves = alerts.filter(a => a.type === 'PRICE_MOVE').length;
    const qtyChanges = alerts.filter(a => a.type === 'QTY_CHANGE').length;
    const newPos     = alerts.filter(a => a.type === 'NEW_POSITION').length;
    const closed     = alerts.filter(a => a.type === 'POSITION_CLOSED').length;

    // Derive comparison months from the alerts
    const alertMonth = alerts.length > 0 ? alerts[0].month : null;
    const subLabel   = alertMonth
      ? `Comparing current snapshot (${alertMonth}) vs previous month`
      : 'Compares latest two months of zerodha_holdings_import';

    const statsHtml = alerts.length > 0 ? `
      <div class="alert-stats">
        ${priceMoves > 0 ? `<span class="alert-stat alert-price">⚡ ${priceMoves} price move${priceMoves > 1 ? 's' : ''} ≥40%</span>` : ''}
        ${qtyChanges > 0 ? `<span class="alert-stat alert-qty">🔄 ${qtyChanges} qty change${qtyChanges > 1 ? 's' : ''}</span>` : ''}
        ${newPos     > 0 ? `<span class="alert-stat alert-new">✚ ${newPos} new position${newPos > 1 ? 's' : ''}</span>` : ''}
        ${closed     > 0 ? `<span class="alert-stat alert-closed">✕ ${closed} closed</span>` : ''}
      </div>` : '';

    const html = `
      ${sectionHeader('Stock Anomaly Alerts', alerts.length > 0 ? alerts.length + ' anomalies' : undefined, subLabel)}
      ${statsHtml}
      <div class="table-wrap">
        ${alerts.length > 0 ? tableControls('alerts-tbl', undefined, undefined) : ''}
        <div class="table-inner">
          ${alerts.length > 0 ? `
          <table id="alerts-tbl">
            <thead><tr>
              <th onclick="Render.sortTable('alerts-tbl',0)">Symbol<span class="sort-icon">⇅</span></th>
              <th>Type</th>
              <th class="right">Prev LTP</th>
              <th class="right">Curr LTP</th>
              <th class="right" onclick="Render.sortTable('alerts-tbl',4)">MoM %<span class="sort-icon">⇅</span></th>
              <th class="right">Prev Qty</th>
              <th class="right">Curr Qty</th>
              <th class="right" onclick="Render.sortTable('alerts-tbl',7)">Qty Δ<span class="sort-icon">⇅</span></th>
            </tr></thead>
            <tbody>${alertRows}</tbody>
          </table>` : `
          <div class="empty-state" style="padding:40px 0;text-align:center">
            <div style="font-size:2rem;margin-bottom:12px">✓</div>
            <div style="font-weight:500;margin-bottom:6px">No anomalies detected</div>
            <div class="muted" style="font-size:0.85rem">
              ${d.stockAlerts === undefined || (Array.isArray(d.stockAlerts) && d.stockAlerts.length === 0 && !alertMonth)
                ? 'Alerts appear here once two months of holdings data are loaded (available after May 2026 import).'
                : 'No stocks moved ±40% or changed quantity vs previous month.'}
            </div>
          </div>`}
        </div>
      </div>`;

    document.getElementById('alerts-content').innerHTML = html;

    // Inject alert badge styles if not already present
    if (!document.getElementById('alert-styles')) {
      const style = document.createElement('style');
      style.id = 'alert-styles';
      style.textContent = `
        .alert-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.78rem;
          font-weight: 500;
          white-space: nowrap;
        }
        .alert-price  { background: rgba(192,57,43,0.10); color: #c0392b; }
        .alert-qty    { background: rgba(45,95,168,0.10); color: #2d5fa8; }
        .alert-new    { background: rgba(26,122,60,0.10); color: #1a7a3c; }
        .alert-closed { background: rgba(107,78,168,0.10); color: #6b4ea8; }
        .alert-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 0 0 16px;
        }
        .alert-stat {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.82rem;
          font-weight: 500;
        }
      `;
      document.head.appendChild(style);
    }
  }

  return {
    renderSummary,
    renderIndia,
    renderGlobal,
    renderFI,
    renderRetirement,
    renderHistory,
    renderAlerts,
    filterTable,
    sortTable,
    sortTableGrouped,
  };
})();
