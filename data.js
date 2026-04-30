// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer v3
// Renamed internal fetch fn to avoid any global shadowing.
// Full console tracing.
// ═══════════════════════════════════════════════════════════════

var Data = (function() {
  var CACHE_KEY     = 'allmyf_data_v3';   // new key — clears any stale old cache
  var FETCH_TIMEOUT = 25000;
  var _raw      = null;
  var _computed = null;

  // ── FETCH (public, called by App) ────────────────────────
  function fetch() {
    console.log('[Data] fetch() called');

    var cached = getCache();
    if (cached) {
      console.log('[Data] returning cached data');
      _raw      = cached;
      _computed = compute(cached);
      return Promise.resolve(_computed);
    }

    console.log('[Data] no cache — firing HTTP request to:', CONFIG.API_URL);

    return httpGet(CONFIG.API_URL).then(function(json) {
      console.log('[Data] response received, keys:', Object.keys(json));
      if (json.error) throw new Error('Apps Script error: ' + (json.message || JSON.stringify(json)));
      _raw      = json;
      setCache(json);
      _computed = compute(json);
      console.log('[Data] compute() done');
      return _computed;
    });
  }

  // ── HTTP GET with timeout ─────────────────────────────────
  function httpGet(url) {
    return new Promise(function(resolve, reject) {
      var controller  = new AbortController();
      var timer = setTimeout(function() {
        controller.abort();
        reject(new Error('Request timed out after 25s. Apps Script cold-start or CORS issue. Open the API URL directly to verify it returns JSON.'));
      }, FETCH_TIMEOUT);

      console.log('[Data] window.fetch firing…');
      window.fetch(url, {
        method:   'GET',
        redirect: 'follow',
        cache:    'no-store',
        signal:   controller.signal,
      })
      .then(function(res) {
        clearTimeout(timer);
        console.log('[Data] HTTP status:', res.status, 'ok:', res.ok);
        if (!res.ok) {
          return reject(new Error('HTTP ' + res.status + ' from Apps Script. Open the API URL to check.'));
        }
        return res.text();
      })
      .then(function(text) {
        if (!text) return reject(new Error('Empty response from Apps Script.'));
        console.log('[Data] response length:', text.length, 'chars');
        var json;
        try { json = JSON.parse(text); }
        catch(e) {
          console.error('[Data] JSON parse failed, first 200 chars:', text.slice(0,200));
          return reject(new Error('Response is not valid JSON. Apps Script may have returned an HTML error page.'));
        }
        resolve(json);
      })
      .catch(function(err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') return; // already rejected above
        console.error('[Data] fetch error:', err);
        reject(new Error('Network error: ' + (err.message || err)));
      });
    });
  }

  // ── CACHE ─────────────────────────────────────────────────
  function getCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CONFIG.CACHE_SECONDS * 1000) return null;
      return obj.data;
    } catch(e) { return null; }
  }

  function setCache(data) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: data, ts: Date.now() })); }
    catch(e) { console.warn('[Data] cache write failed:', e.message); }
  }

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
    console.log('[Data] cache cleared');
  }

  // ── COMPUTE ───────────────────────────────────────────────
  function compute(d) {
    var lp         = d.live_prices       || {};
    var assets     = d.assets            || [];
    var zHold      = d.zerodha_holdings  || [];
    var vHold      = d.vested_holdings   || [];
    var manAssets  = d.manual_assets     || [];
    var snap       = d.latest_snapshot   || {};
    var monthlyPnl = d.monthly_pnl       || [];
    var soldStocks = d.sold_stocks       || [];

    var usdinr = (lp['FX_USDINR'] && lp['FX_USDINR'].price) || CONFIG.FALLBACK_USDINR;

    var zTotal = zHold.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr)      || 0),
        current:  s.current  + (parseFloat(h.current_value_inr) || 0),
        pnl:      s.pnl      + (parseFloat(h.pnl_inr)           || 0),
      };
    }, { invested: 0, current: 0, pnl: 0 });

    var vTotal = vHold.reduce(function(s, h) {
      return {
        invested_usd: s.invested_usd + (parseFloat(h.invested_usd)      || 0),
        current_usd:  s.current_usd  + (parseFloat(h.current_value_usd) || 0),
        pnl_usd:      s.pnl_usd      + (parseFloat(h.pnl_usd)           || 0),
      };
    }, { invested_usd: 0, current_usd: 0, pnl_usd: 0 });
    vTotal.invested_inr = vTotal.invested_usd * usdinr;
    vTotal.current_inr  = vTotal.current_usd  * usdinr;
    vTotal.pnl_inr      = vTotal.pnl_usd      * usdinr;

    // Latest manual asset per ID
    var latestManual = {};
    manAssets.forEach(function(m) {
      if (!m.asset_id) return;
      if (!latestManual[m.asset_id] || m.snapshot_month > latestManual[m.asset_id].snapshot_month)
        latestManual[m.asset_id] = m;
    });
    var manList = Object.keys(latestManual).map(function(k) { return latestManual[k]; });

    // Classify Zerodha rows
    var ETF_SYMS = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    var mfRows  = zHold.filter(function(h) {
      return h.symbol && (h.symbol.indexOf(' ') >= 0 || h.symbol.length > 15);
    });
    var zEquityRows = zHold.filter(function(h) {
      return h.symbol && h.symbol.indexOf(' ') < 0 && h.symbol.length <= 15;
    });
    var zReits  = zEquityRows.filter(function(h) { return h.symbol.slice(-3) === '-RR'; });
    var zEtfs   = zEquityRows.filter(function(h) {
      return ETF_SYMS.indexOf(h.symbol) >= 0 && h.symbol.slice(-3) !== '-RR';
    });
    var zEquityStocks = zEquityRows.filter(function(h) {
      return h.symbol.slice(-3) !== '-RR' && ETF_SYMS.indexOf(h.symbol) < 0;
    });

    var zEquityTotal = zEquityRows.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr)      || 0),
        current:  s.current  + (parseFloat(h.current_value_inr) || 0),
      };
    }, { invested: 0, current: 0 });

    var mfTotal = mfRows.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr)      || 0),
        current:  s.current  + (parseFloat(h.current_value_inr) || 0),
      };
    }, { invested: 0, current: 0 });

    var commodityVal  = parseFloat(snap.commodity_value_inr   || 0);
    var fiVal         = parseFloat(snap.fixed_income_value_inr || 0);
    var retirementVal = parseFloat(snap.retirement_value_inr   || 0);

    var totalCurrent  = zTotal.current + vTotal.current_inr + commodityVal + fiVal + retirementVal;
    var totalInvested = zTotal.invested + vTotal.invested_inr;

    var alloc = [
      { name: 'India Equity & ETFs', value: zEquityTotal.current, color: '#C9A84C' },
      { name: 'Mutual Funds',        value: mfTotal.current,       color: '#5B8DEF' },
      { name: 'US/Global (Vested)',  value: vTotal.current_inr,    color: '#3DD68C' },
      { name: 'Commodities',         value: commodityVal,          color: '#F4645F' },
      { name: 'Fixed Income',        value: fiVal,                 color: '#9B7FEA' },
      { name: 'Retirement',          value: retirementVal,         color: '#38BDF8' },
    ].filter(function(a) { return a.value > 0; });
    var allocTotal = alloc.reduce(function(s, a) { return s + a.value; }, 0);
    alloc.forEach(function(a) { a.pct = allocTotal > 0 ? (a.value / allocTotal * 100) : 0; });

    var latestPnl = monthlyPnl.length > 0 ? monthlyPnl[monthlyPnl.length - 1] : {};
    var soldTotal = soldStocks.reduce(function(s, r) {
      return s + (parseFloat(r.realized_pnl_inr) || 0);
    }, 0);
    var assetMap = {};
    assets.forEach(function(a) { assetMap[a.asset_id] = a; });

    return {
      raw: d,
      lp: lp, usdinr: usdinr,
      assets: assets, assetMap: assetMap,
      zHold: zHold, vHold: vHold, manList: manList,
      zEquityStocks: zEquityStocks, zReits: zReits, zEtfs: zEtfs, mfRows: mfRows,
      zTotal: zTotal, vTotal: vTotal, mfTotal: mfTotal, zEquityTotal: zEquityTotal,
      commodityVal: commodityVal, fiVal: fiVal, retirementVal: retirementVal,
      totalCurrent: totalCurrent, totalInvested: totalInvested,
      alloc: alloc, allocTotal: allocTotal,
      latestPnl: latestPnl,
      soldStocks: soldStocks, soldTotal: soldTotal,
      monthlyPnl: monthlyPnl, snap: snap,
      generatedAt: d._meta && d._meta.generated_at,
    };
  }

  // ── FORMAT HELPERS ────────────────────────────────────────
  function fmt(n, decimals) {
    decimals = decimals || 0;
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }
  function fmtInr(n, compact) {
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    if (compact) {
      if (Math.abs(n) >= 1e7) return '\u20b9' + (n/1e7).toFixed(2) + ' Cr';
      if (Math.abs(n) >= 1e5) return '\u20b9' + (n/1e5).toFixed(2) + ' L';
    }
    return '\u20b9' + fmt(n, 0);
  }
  function fmtUsd(n, compact) {
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    if (compact && Math.abs(n) >= 1000) return '$' + (n/1000).toFixed(1) + 'K';
    return '$' + fmt(n, 2);
  }
  function pctStr(n) {
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    return (parseFloat(n) >= 0 ? '+' : '') + parseFloat(n).toFixed(2) + '%';
  }
  function pnlClass(n) {
    if (!n && n !== 0) return '';
    return parseFloat(n) >= 0 ? 'pos' : 'neg';
  }

  return {
    fetch:      fetch,
    clearCache: clearCache,
    fmt:        fmt,
    fmtInr:     fmtInr,
    fmtUsd:     fmtUsd,
    pctStr:     pctStr,
    pnlClass:   pnlClass,
    get computed() { return _computed; },
  };
}());
