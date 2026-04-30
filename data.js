// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer
// Fetches from Apps Script, caches, and provides computed values
// ═══════════════════════════════════════════════════════════════

const Data = (() => {
  const CACHE_KEY = 'allmyf_data_cache';
  let _raw = null;
  let _computed = null;

  // ── FETCH ──────────────────────────────────────────────────
  async function fetch() {
    // Check cache
    const cached = getCached();
    if (cached) {
      _raw = cached;
      _computed = compute(_raw);
      return _computed;
    }

    const res = await window.fetch(CONFIG.API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.message || 'Apps Script error');

    _raw = json;
    setCache(json);
    _computed = compute(json);
    return _computed;
  }

  function getCached() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.CACHE_SECONDS * 1000) return null;
      return data;
    } catch { return null; }
  }

  function setCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
  }

  // ── COMPUTE DERIVED VALUES ─────────────────────────────────
  function compute(d) {
    const lp          = d.live_prices || {};
    const assets      = d.assets || [];
    const zHold       = d.zerodha_holdings || [];
    const vHold       = d.vested_holdings || [];
    const manAssets   = d.manual_assets || [];
    const snap        = d.latest_snapshot || {};
    const monthlyPnl  = d.monthly_pnl || [];
    const soldStocks  = d.sold_stocks || [];

    // FX Rate
    const usdinr = (lp['FX_USDINR']?.price) || CONFIG.FALLBACK_USDINR;

    // Zerodha totals from holdings import
    const zTotal = zHold.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr) || 0),
      current:  s.current  + (parseFloat(h.current_value_inr) || 0),
      pnl:      s.pnl      + (parseFloat(h.pnl_inr) || 0),
    }), { invested: 0, current: 0, pnl: 0 });

    // Vested totals
    const vTotal = vHold.reduce((s, h) => ({
      invested_usd: s.invested_usd + (parseFloat(h.invested_usd) || 0),
      current_usd:  s.current_usd  + (parseFloat(h.current_value_usd) || 0),
      pnl_usd:      s.pnl_usd      + (parseFloat(h.pnl_usd) || 0),
    }), { invested_usd: 0, current_usd: 0, pnl_usd: 0 });
    vTotal.invested_inr = vTotal.invested_usd * usdinr;
    vTotal.current_inr  = vTotal.current_usd  * usdinr;
    vTotal.pnl_inr      = vTotal.pnl_usd      * usdinr;

    // Manual assets — get latest per asset_id
    const latestManual = {};
    manAssets.forEach(m => {
      const id = m.asset_id;
      if (!latestManual[id] || m.snapshot_month > latestManual[id].snapshot_month)
        latestManual[id] = m;
    });
    const manList = Object.values(latestManual);

    // Manual totals by asset_class
    const manTotals = { commodity: 0, bond: 0, fd: 0, rd: 0, retirement: 0, other: 0 };
    manList.forEach(m => {
      const val = parseFloat(m.current_value_inr || m.current_value || 0);
      const usdVal = m.currency === 'USD' ? val * usdinr : val;
      const cls = m.asset_id?.split('_')[1]?.toLowerCase() || 'other';
      if      (cls === 'commodity') manTotals.commodity  += usdVal;
      else if (cls === 'bond')      manTotals.bond        += usdVal;
      else if (cls === 'fd')        manTotals.fd          += usdVal;
      else if (cls === 'rd')        manTotals.rd          += usdVal;
      else if (cls === 'pension')   manTotals.retirement  += usdVal;
      else                          manTotals.other       += usdVal;
    });

    // Assets by class from assets_master
    const assetMap = {};
    assets.forEach(a => { assetMap[a.asset_id] = a; });

    // Get MF current value from zerodha holdings (MFs appear there too)
    const mfRows = zHold.filter(h => h.symbol && h.symbol.length > 10); // MF names are long strings
    const mfTotal = mfRows.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr) || 0),
      current:  s.current  + (parseFloat(h.current_value_inr) || 0),
    }), { invested: 0, current: 0 });

    // Zerodha EQUITY only (short symbols — stocks and ETFs)
    const zEquityRows = zHold.filter(h => h.symbol && h.symbol.length <= 12);
    const zEquityTotal = zEquityRows.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr) || 0),
      current:  s.current  + (parseFloat(h.current_value_inr) || 0),
    }), { invested: 0, current: 0 });

    // Grand total
    const commodityVal = snap.commodity_value_inr ? parseFloat(snap.commodity_value_inr) : manTotals.commodity;
    const fiVal = (manTotals.bond + manTotals.fd + manTotals.rd) || (snap.fixed_income_value_inr ? parseFloat(snap.fixed_income_value_inr) : 0);
    const retirementVal = manTotals.retirement || (snap.retirement_value_inr ? parseFloat(snap.retirement_value_inr) : 0);

    const totalCurrent = zTotal.current + vTotal.current_inr + commodityVal + fiVal + retirementVal;
    const totalInvested = zTotal.invested + vTotal.invested_inr;

    // Monthly P&L record
    const latestPnl = monthlyPnl.length > 0 ? monthlyPnl[monthlyPnl.length - 1] : {};

    // Allocation breakdown
    const alloc = [
      { name: 'India Equity & ETFs', value: zEquityTotal.current, color: '#C9A84C' },
      { name: 'Mutual Funds',        value: mfTotal.current,       color: '#5B8DEF' },
      { name: 'US/Global (Vested)',  value: vTotal.current_inr,    color: '#3DD68C' },
      { name: 'Commodities',         value: commodityVal,          color: '#F4645F' },
      { name: 'Fixed Income',        value: fiVal,                 color: '#9B7FEA' },
      { name: 'Retirement',          value: retirementVal,         color: '#38BDF8' },
    ].filter(a => a.value > 0);
    const allocTotal = alloc.reduce((s, a) => s + a.value, 0);
    alloc.forEach(a => { a.pct = allocTotal > 0 ? (a.value / allocTotal * 100) : 0; });

    // Classify zerodha holdings
    const zEquityStocks = zEquityRows.filter(h => {
      const sym = h.symbol;
      return !sym.includes('-RR') && !sym.includes('ETF') && !sym.includes('CASE') &&
             !['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'].includes(sym);
    });
    const zReits = zEquityRows.filter(h => h.symbol?.includes('-RR'));
    const zEtfs  = zEquityRows.filter(h => !h.symbol?.includes('-RR') && !zEquityStocks.includes(h) && !mfRows.includes(h));

    // Sold stocks realized total
    const soldTotal = soldStocks.reduce((s, r) => s + (parseFloat(r.realized_pnl_inr) || 0), 0);

    // Monthly PnL for history chart
    const pnlHistory = d.all_snapshots || [];

    return {
      raw: d,
      lp, usdinr,
      assets, assetMap,
      zHold, vHold, manList, manAssets: latestManual,
      zEquityStocks, zReits, zEtfs, mfRows,
      zTotal, vTotal, mfTotal, zEquityTotal,
      commodityVal, fiVal, retirementVal,
      totalCurrent, totalInvested,
      alloc, allocTotal,
      latestPnl,
      soldStocks, soldTotal,
      pnlHistory,
      snap,
      monthlyPnl,
      generatedAt: d._meta?.generated_at,
    };
  }

  // ── HELPERS ───────────────────────────────────────────────
  function fmt(n, decimals = 0) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }

  function fmtInr(n, compact = false) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (compact) {
      if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
      if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L';
      return '₹' + fmt(n, 0);
    }
    return '₹' + fmt(n, 0);
  }

  function fmtUsd(n, compact = false) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (compact && Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    return '$' + fmt(n, 2);
  }

  function pctStr(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const s = parseFloat(n).toFixed(2);
    return (n >= 0 ? '+' : '') + s + '%';
  }

  function pnlClass(n) {
    if (!n && n !== 0) return '';
    return parseFloat(n) >= 0 ? 'pos' : 'neg';
  }

  return { fetch, clearCache, fmt, fmtInr, fmtUsd, pctStr, pnlClass, get computed() { return _computed; } };
})();
