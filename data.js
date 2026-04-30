// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer  v2
// Fetches from Apps Script with timeout + visible error handling
// ═══════════════════════════════════════════════════════════════

const Data = (() => {
  const CACHE_KEY     = 'allmyf_data_cache';
  const FETCH_TIMEOUT = 20000; // 20 seconds
  let _raw      = null;
  let _computed = null;

  // ── FETCH WITH TIMEOUT ────────────────────────────────────
  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await window.fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store',
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out after 20s — Apps Script may be slow to start. Click Refresh to retry.');
      throw new Error('Network error: ' + err.message + '. Check Apps Script deployment and CORS settings.');
    }
  }

  // ── MAIN FETCH ────────────────────────────────────────────
  async function fetch() {
    // Return cached data if fresh
    const cached = getCached();
    if (cached) {
      _raw = cached;
      _computed = compute(_raw);
      return _computed;
    }

    const res = await fetchWithTimeout(CONFIG.API_URL, FETCH_TIMEOUT);

    if (!res.ok) {
      throw new Error(`Apps Script returned HTTP ${res.status}. Open the API URL directly to check: ${CONFIG.API_URL}`);
    }

    let json;
    try {
      const text = await res.text();
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('Response is not valid JSON. The Apps Script may have returned an error page. Open the API URL directly to check.');
    }

    if (json.error) throw new Error('Apps Script error: ' + (json.message || JSON.stringify(json)));

    _raw = json;
    setCache(json);
    _computed = compute(_raw);
    return _computed;
  }

  // ── CACHE ─────────────────────────────────────────────────
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
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  function clearCache() { sessionStorage.removeItem(CACHE_KEY); }

  // ── COMPUTE DERIVED VALUES ────────────────────────────────
  function compute(d) {
    const lp         = d.live_prices    || {};
    const assets     = d.assets         || [];
    const zHold      = d.zerodha_holdings || [];
    const vHold      = d.vested_holdings  || [];
    const manAssets  = d.manual_assets   || [];
    const snap       = d.latest_snapshot  || {};
    const monthlyPnl = d.monthly_pnl      || [];
    const soldStocks = d.sold_stocks      || [];

    const usdinr = lp['FX_USDINR']?.price || CONFIG.FALLBACK_USDINR;

    // ── Zerodha totals ────────────────────────────────────
    const zTotal = zHold.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr)     || 0),
      current:  s.current  + (parseFloat(h.current_value_inr)|| 0),
      pnl:      s.pnl      + (parseFloat(h.pnl_inr)          || 0),
    }), { invested: 0, current: 0, pnl: 0 });

    // ── Vested totals ─────────────────────────────────────
    const vTotal = vHold.reduce((s, h) => ({
      invested_usd: s.invested_usd + (parseFloat(h.invested_usd)      || 0),
      current_usd:  s.current_usd  + (parseFloat(h.current_value_usd) || 0),
      pnl_usd:      s.pnl_usd      + (parseFloat(h.pnl_usd)           || 0),
    }), { invested_usd: 0, current_usd: 0, pnl_usd: 0 });
    vTotal.invested_inr = vTotal.invested_usd * usdinr;
    vTotal.current_inr  = vTotal.current_usd  * usdinr;
    vTotal.pnl_inr      = vTotal.pnl_usd      * usdinr;

    // ── Latest manual assets (one per asset_id) ───────────
    const latestManual = {};
    manAssets.forEach(m => {
      if (!m.asset_id) return;
      if (!latestManual[m.asset_id] || m.snapshot_month > latestManual[m.asset_id].snapshot_month)
        latestManual[m.asset_id] = m;
    });
    const manList = Object.values(latestManual);

    // ── Classify Zerodha rows ─────────────────────────────
    // MFs: long fund names (contain spaces or length > 15)
    const mfRows       = zHold.filter(h => h.symbol && (h.symbol.includes(' ') || h.symbol.length > 15));
    const zEquityRows  = zHold.filter(h => h.symbol && !h.symbol.includes(' ') && h.symbol.length <= 15);
    const zReits       = zEquityRows.filter(h => h.symbol.endsWith('-RR'));
    const ETF_SYMS     = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    const zEtfs        = zEquityRows.filter(h => ETF_SYMS.includes(h.symbol) && !h.symbol.endsWith('-RR'));
    const zEquityStocks= zEquityRows.filter(h => !h.symbol.endsWith('-RR') && !ETF_SYMS.includes(h.symbol));

    const zEquityTotal = zEquityRows.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr)     || 0),
      current:  s.current  + (parseFloat(h.current_value_inr)|| 0),
    }), { invested: 0, current: 0 });

    const mfTotal = mfRows.reduce((s, h) => ({
      invested: s.invested + (parseFloat(h.invested_inr)     || 0),
      current:  s.current  + (parseFloat(h.current_value_inr)|| 0),
    }), { invested: 0, current: 0 });

    // ── Aggregated values ─────────────────────────────────
    const commodityVal  = parseFloat(snap.commodity_value_inr  || 0);
    const fiVal         = parseFloat(snap.fixed_income_value_inr|| 0);
    const retirementVal = parseFloat(snap.retirement_value_inr  || 0);

    const totalCurrent  = zTotal.current + vTotal.current_inr + commodityVal + fiVal + retirementVal;
    const totalInvested = zTotal.invested + vTotal.invested_inr;

    // ── Allocation breakdown ──────────────────────────────
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

    const latestPnl  = monthlyPnl.length > 0 ? monthlyPnl[monthlyPnl.length - 1] : {};
    const soldTotal  = soldStocks.reduce((s, r) => s + (parseFloat(r.realized_pnl_inr) || 0), 0);
    const assetMap   = {};
    assets.forEach(a => { assetMap[a.asset_id] = a; });

    return {
      raw: d,
      lp, usdinr,
      assets, assetMap,
      zHold, vHold, manList,
      zEquityStocks, zReits, zEtfs, mfRows,
      zTotal, vTotal, mfTotal, zEquityTotal,
      commodityVal, fiVal, retirementVal,
      totalCurrent, totalInvested,
      alloc, allocTotal,
      latestPnl,
      soldStocks, soldTotal,
      monthlyPnl,
      snap,
      generatedAt: d._meta?.generated_at,
    };
  }

  // ── FORMAT HELPERS ────────────────────────────────────────
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
      if (Math.abs(n) >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr';
      if (Math.abs(n) >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L';
    }
    return '₹' + fmt(n, 0);
  }
  function fmtUsd(n, compact = false) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (compact && Math.abs(n) >= 1000) return '$' + (n/1000).toFixed(1) + 'K';
    return '$' + fmt(n, 2);
  }
  function pctStr(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (parseFloat(n) >= 0 ? '+' : '') + parseFloat(n).toFixed(2) + '%';
  }
  function pnlClass(n) {
    if (!n && n !== 0) return '';
    return parseFloat(n) >= 0 ? 'pos' : 'neg';
  }

  return {
    fetch, clearCache,
    fmt, fmtInr, fmtUsd, pctStr, pnlClass,
    get computed() { return _computed; },
  };
})();
