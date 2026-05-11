// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer v7
// Phase 7: MF NAVs moved fully server-side (Apps Script UrlFetchApp)
//
// Architecture:
//  - Stock/ETF/REIT prices: GOOGLEFINANCE formulas in live_prices sheet
//    → served as d.live_stock_prices { symbol → price }
//  - MF NAVs: Apps Script calls mfapi.in server-side via UrlFetchApp.fetchAll()
//    → served as d.mf_navs { scheme_code → { nav, navDate } }
//  - Index prices (S&P 500, Sensex): GOOGLEFINANCE formulas in live_prices
//    → served as d.live_prices { IDX_SP500, IDX_SENSEX, ... }
//  - BTC: CoinGecko browser fetch in app.js (CORS-enabled, no extension issues)
//  - No browser-side mfapi.in fetches — extensions cannot interfere
//  - Cache: v7 sessionStorage, 5-min TTL (bumped from v6 to clear stale cache)
// ═══════════════════════════════════════════════════════════════

var Data = (function() {
  var CACHE_KEY     = 'allmyf_data_v7';
  var FETCH_TIMEOUT = 25000;
  var _raw      = null;
  var _computed = null;

  // ── PUBLIC: fetch ─────────────────────────────────────────
  // MF NAVs now arrive pre-fetched in the payload (d.mf_navs).
  // No browser-side mfapi.in calls needed — compute() is synchronous.
  function fetch() {
    console.log('[Data] fetch() v7');

    var cached = getCache(CACHE_KEY, CONFIG.CACHE_SECONDS);
    if (cached) {
      console.log('[Data] main data from cache (v7)');
      _raw = cached.data;
      _computed = compute(cached.data);
      return Promise.resolve(_computed);
    }

    return httpGet(CONFIG.API_URL).then(function(json) {
      if (json.error) throw new Error('Apps Script error: ' + (json.message || JSON.stringify(json)));
      _raw = json;
      setCache(CACHE_KEY, { data: json });
      _computed = compute(json);
      return _computed;
    });
  }

  // ── NOTE: fetchMfNavs() removed in v7 ────────────────────
  // MF NAVs now arrive pre-fetched in d.mf_navs from Apps Script.
  // L1/L2 matching runs synchronously inside compute() — no browser fetches needed.

  // ── HTTP GET ─────────────────────────────────────────────
  function httpGet(url) {
    return new Promise(function(resolve, reject) {
      var ctrl  = new AbortController();
      var timer = setTimeout(function() {
        ctrl.abort();
        reject(new Error('Request timed out after 25s.'));
      }, FETCH_TIMEOUT);

      window.fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store', signal: ctrl.signal })
        .then(function(res) {
          clearTimeout(timer);
          if (!res.ok) return reject(new Error('HTTP ' + res.status));
          return res.text();
        })
        .then(function(text) {
          if (!text) return reject(new Error('Empty response'));
          var json;
          try { json = JSON.parse(text); } catch(e) {
            return reject(new Error('Invalid JSON from Apps Script'));
          }
          resolve(json);
        })
        .catch(function(err) {
          clearTimeout(timer);
          if (err && err.name === 'AbortError') return;
          reject(new Error('Network error: ' + (err && err.message || err)));
        });
    });
  }

  // ── CACHE ─────────────────────────────────────────────────
  function getCache(key, ttl) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > (ttl || 300) * 1000) return null;
      return obj;
    } catch(e) { return null; }
  }

  function setCache(key, payload) {
    try {
      sessionStorage.setItem(key, JSON.stringify(Object.assign({ ts: Date.now() }, payload)));
    } catch(e) { console.warn('[Data] cache write failed:', e.message); }
  }

  function clearCache() {
    // Clear both v5 and v6 keys to ensure full reset
    ['allmyf_data_v5', 'allmyf_data_v6', 'allmyf_lp_v1'].forEach(function(k) {
      sessionStorage.removeItem(k);
    });
    console.log('[Data] all caches cleared');
  }

  // ── COMPUTE ───────────────────────────────────────────────
  // d.mf_navs: { scheme_code → {nav,navDate} } — pre-fetched by Apps Script mfNavs()
  // d.mf_codes: { asset_id → scheme_code } — for non-Zerodha MF lookup
  // d.live_stock_prices: { symbol → price } — GOOGLEFINANCE via Apps Script
  // d.live_prices: { id → {price,currency,source} } — all live_prices sheet rows
  function compute(d) {
    var mfNavsMap  = d.mf_navs  || {};  // { scheme_code: { nav, navDate } }
    var mfCodeMap  = d.mf_codes || {};  // { asset_id: scheme_code }
    var livePrices = d.live_stock_prices || {};  // stock/ETF/REIT prices from GOOGLEFINANCE

    var lp         = d.live_prices       || {};
    var assets     = d.assets            || [];
    var zHold      = d.zerodha_holdings  || [];
    var vHold      = d.vested_holdings   || [];
    var manAssets  = d.manual_assets     || [];
    var soldStocks = d.sold_stocks       || [];
    var watchlist  = d.watchlist         || [];
    var monthlyPnl = d.monthly_pnl       || [];

    // ── ANNOTATE SOLD STOCKS — opportunity cost + tax fields ──────
    soldStocks.forEach(function(s) {
      var sellPx   = parseFloat(s.avg_sell_price_inr) || 0;
      var qty      = parseFloat(s.total_sell_qty)     || 0;
      var pnl      = parseFloat(s.realized_pnl_inr)   || 0;
      var holdDays = parseInt(s.holding_period_days, 10);
      if (isNaN(holdDays)) holdDays = 0;

      // Tax category — use stored value if present, otherwise derive
      s._taxCategory  = s.tax_category || (holdDays > 365 ? 'LTCG' : 'STCG');
      // After-tax delta — use stored value if present, otherwise estimate
      var storedDelta = parseFloat(s.after_tax_delta);
      s._afterTaxDelta = isNaN(storedDelta)
        ? Math.round(pnl * (s._taxCategory === 'LTCG' ? 0.875 : 0.80))
        : storedDelta;

      // Opportunity cost — requires live price
      var currPx = livePrices[s.symbol] || 0;
      if (currPx > 0 && sellPx > 0) {
        var pct = (currPx - sellPx) / sellPx * 100;
        s._currentPrice    = currPx;
        s._opportunityCost = (currPx - sellPx) * qty;   // +ve = could have had more
        s._opportunityPct  = pct;
        s._verdict = pct > 10  ? 'REGRET'
                   : pct > 0   ? 'MILD_REGRET'
                   : pct > -10 ? 'GOOD_CALL'
                   :              'GREAT_CALL';
      } else {
        s._currentPrice    = null;
        s._opportunityCost = null;
        s._opportunityPct  = null;
        s._verdict         = 'NO_DATA';
      }
    });

    // ── ANNOTATE WATCHLIST — live price + move since add_date ────
    watchlist.forEach(function(w) {
      var ticker   = String(w.ticker || '').trim();
      var startPx  = parseFloat(w.start_price)   || 0;
      var targetPx = parseFloat(w.target_price)  || 0;
      // Prefer livePrices (fresh from GOOGLEFINANCE) over sheet formula result
      var livePx   = livePrices[ticker] || 0;
      var sheetPx  = parseFloat(w.current_price) || 0;
      var currPx   = livePx > 0 ? livePx : sheetPx;
      w._currentPrice = currPx > 0 ? currPx : null;
      if (currPx > 0 && startPx > 0) {
        w._pnlAbs = currPx - startPx;
        w._pnlPct = (currPx - startPx) / startPx * 100;
      } else {
        w._pnlAbs = null;
        w._pnlPct = null;
      }
      // Target gap: how far current is from target (negative = below target)
      w._targetGap = (currPx > 0 && targetPx > 0)
        ? (targetPx - currPx) / currPx * 100
        : null;
      w._active = !w.remove_date && w.status !== 'bought' && w.status !== 'dropped';
    });
    var watchlistActive = watchlist.filter(function(w) { return w._active; });

    var snap       = d.latest_snapshot   || {};

    var usdinr = (lp['FX_USDINR'] && lp['FX_USDINR'].price > 0)
      ? lp['FX_USDINR'].price : CONFIG.FALLBACK_USDINR;

    // ── CLASSIFY ZERODHA ─────────────────────────────────
    var ETF_SYMS = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    var mfRows = zHold.filter(function(h) {
      return h.symbol && (h.symbol.indexOf(' ') >= 0 || h.symbol.length > 15);
    });
    var zEquityRows = zHold.filter(function(h) {
      return h.symbol && h.symbol.indexOf(' ') < 0 && h.symbol.length <= 15;
    });
    var zReits = zEquityRows.filter(function(h) { return h.symbol.slice(-3) === '-RR'; });
    var zEtfs  = zEquityRows.filter(function(h) {
      return ETF_SYMS.indexOf(h.symbol) >= 0 && h.symbol.slice(-3) !== '-RR';
    });
    var zEquityStocks = zEquityRows.filter(function(h) {
      return h.symbol.slice(-3) !== '-RR' && ETF_SYMS.indexOf(h.symbol) < 0;
    });

    // ── ZERODHA MF → SCHEME CODE (L1/L2 matching, synchronous) ─
    // Builds symbol → scheme_code map so compute() can look up mfNavsMap.
    // L1: exact lowercase name match against assets_master asset_name/ticker_symbol
    // L2: starts-with prefix (Zerodha sometimes truncates long fund names)
    // No L3 network search — if no match, fund falls back to snapshot NAV.
    var nameToCode = {};
    assets.forEach(function(a) {
      var code = a.mf_scheme_code ? String(a.mf_scheme_code).trim() : '';
      if (!code || code === 'LOOKUP_NEEDED') return;
      if (a.asset_name)    nameToCode[a.asset_name.trim().toLowerCase()]    = code;
      if (a.ticker_symbol) nameToCode[a.ticker_symbol.trim().toLowerCase()] = code;
    });
    var zerodhaSymToCode = {};
    mfRows.forEach(function(h) {
      var sym = String(h.symbol || '').trim();
      var q   = sym.toLowerCase();
      if (nameToCode[q]) { zerodhaSymToCode[sym] = nameToCode[q]; return; }
      var keys = Object.keys(nameToCode);
      for (var ki = 0; ki < keys.length; ki++) {
        var name = keys[ki];
        if (name.indexOf(q) === 0 || q.indexOf(name) === 0) {
          zerodhaSymToCode[sym] = nameToCode[name]; break;
        }
      }
    });

    // ── LIVE LTP — NSE rows (from Apps Script TwelveData) ─
    // Apps Script stores REITs bare (BIRET not BIRET-RR) — try both.
    function annotateNse(h) {
      var sym  = String(h.symbol || '');
      var bare = sym.replace(/-RR$/, '');
      var ltp  = livePrices[sym] || livePrices[bare];
      if (!ltp || ltp <= 0) return;
      var qty      = parseFloat(h.quantity    || 0);
      var invested = parseFloat(h.invested_inr || 0);
      h._liveLTP     = ltp;
      h._liveCurrent = ltp * qty;
      h._livePnl     = h._liveCurrent - invested;
      h._livePct     = invested > 0 ? h._livePnl / invested * 100 : null;
    }
    zEquityStocks.forEach(annotateNse);
    zReits.forEach(annotateNse);
    zEtfs.forEach(annotateNse);

    // ── LIVE LTP — Vested rows (USD prices from Apps Script) ─
    vHold.forEach(function(h) {
      var p = livePrices[h.symbol];
      if (!p || p <= 0) return;
      var qty = parseFloat(h.quantity    || 0);
      var inv = parseFloat(h.invested_usd || 0);
      h._liveLTP     = p;
      h._liveCurrent = p * qty;
      h._livePnl     = h._liveCurrent - inv;
      h._livePct     = inv > 0 ? h._livePnl / inv * 100 : null;
    });

    // ── LIVE NAV — Zerodha MFs (from d.mf_navs, server-side) ─
    mfRows.forEach(function(h) {
      var code = zerodhaSymToCode[h.symbol];
      if (!code || !mfNavsMap[code]) return;
      var qty      = parseFloat(h.quantity    || 0);
      var invested = parseFloat(h.invested_inr || 0);
      h._liveNAV     = mfNavsMap[code].nav;
      h._liveNavDate = mfNavsMap[code].navDate;
      h._liveCurrent = qty * mfNavsMap[code].nav;
      h._livePnl     = h._liveCurrent - invested;
      h._livePct     = invested > 0 ? h._livePnl / invested * 100 : null;
    });

    // ── MANUAL ASSETS + non-Zerodha MF NAVs ──────────────
    var latestManual = {};
    manAssets.forEach(function(m) {
      if (!m.asset_id) return;
      if (!latestManual[m.asset_id] || m.snapshot_month > latestManual[m.asset_id].snapshot_month)
        latestManual[m.asset_id] = m;
    });
    var manList = Object.values(latestManual);

    var manMFCurrent = 0, manMFInvested = 0;
    manList.forEach(function(m) {
      if (!m.asset_id || m.asset_id.indexOf('MF_') < 0) return;
      var code     = mfCodeMap[m.asset_id] ? String(mfCodeMap[m.asset_id]).trim() : '';
      var units    = parseFloat(m.quantity      || 0);
      var invested = parseFloat(m.invested_amount || 0);
      manMFInvested += invested;
      if (code && code !== 'LOOKUP_NEEDED' && mfNavsMap[code]) {
        m._liveNAV     = mfNavsMap[code].nav;
        m._liveNavDate = mfNavsMap[code].navDate;
        m._liveCurrent = units * mfNavsMap[code].nav;
        manMFCurrent  += m._liveCurrent;
      }
    });

    // ── TOTALS ────────────────────────────────────────────
    var zEquityTotal = zEquityRows.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr) || 0),
        current:  s.current  + (h._liveCurrent !== undefined
                    ? h._liveCurrent : parseFloat(h.current_value_inr || 0)),
      };
    }, { invested: 0, current: 0 });

    var mfTotal = mfRows.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr) || 0),
        current:  s.current  + (h._liveCurrent !== undefined
                    ? h._liveCurrent : parseFloat(h.current_value_inr || 0)),
      };
    }, { invested: 0, current: 0 });
    mfTotal.current  += manMFCurrent;
    mfTotal.invested += manMFInvested;

    var zTotal = {
      invested: zEquityTotal.invested + mfTotal.invested - manMFInvested,
      current:  zEquityTotal.current  + mfTotal.current  - manMFCurrent,
    };
    zTotal.pnl = zTotal.current - zTotal.invested;

    var vTotal = vHold.reduce(function(s, h) {
      var curr = h._liveCurrent !== undefined ? h._liveCurrent : parseFloat(h.current_value_usd || 0);
      var pnl  = h._livePnl     !== undefined ? h._livePnl     : parseFloat(h.pnl_usd || 0);
      return {
        invested_usd: s.invested_usd + (parseFloat(h.invested_usd) || 0),
        current_usd:  s.current_usd  + curr,
        pnl_usd:      s.pnl_usd      + pnl,
      };
    }, { invested_usd: 0, current_usd: 0, pnl_usd: 0 });
    vTotal.invested_inr = vTotal.invested_usd * usdinr;
    vTotal.current_inr  = vTotal.current_usd  * usdinr;
    vTotal.pnl_inr      = vTotal.pnl_usd      * usdinr;

    // ── COMMODITY / FI / RETIREMENT ───────────────────────
    var xauUSD = (lp['FX_XAUINR'] && lp['FX_XAUINR'].price > 100) ? lp['FX_XAUINR'].price : 0;
    var xagUSD = (lp['FX_XAGINR'] && lp['FX_XAGINR'].price > 1)   ? lp['FX_XAGINR'].price : 0;
    var goldPerGram   = xauUSD > 0 ? (xauUSD * usdinr) / 31.1035 : 0;
    var silverPerGram = xagUSD > 0 ? (xagUSD * usdinr) / 31.1035 : 0;

    // Separate Vest rows (display-only — never included in totalCurrent or totalInvested)
    var vestList = manList.filter(function(m) {
      return m.asset_id && m.asset_id.indexOf('VEST_') === 0;
    }).map(function(m) {
      var inv  = parseFloat(m.invested_amount  || 0);
      var curr = parseFloat(m.current_value    || 0);
      var inr  = parseFloat(m.current_value_inr || 0);
      var fx   = parseFloat(m.usd_inr_at_snapshot || 0);
      return Object.assign({}, m, {
        _investedUsd: inv,
        _currentUsd:  curr,
        _currentInr:  inr > 0 ? inr : (curr > 0 && fx > 0 ? Math.round(curr * fx) : 0),
        _pnlUsd:  curr > 0 && inv > 0 ? curr - inv : null,
        _pnlPct:  curr > 0 && inv > 0 ? (curr - inv) / inv * 100 : null,
      });
    });

    var commodityVal = manList.reduce(function(s, m) {
      if (!m.asset_id || m.asset_id.indexOf('COMMODITY') < 0) return s;
      var qty = parseFloat(m.quantity || 0);
      if (m.asset_id.indexOf('SILVER') >= 0)
        return s + (silverPerGram > 0 ? silverPerGram * qty : 0);
      return s + (goldPerGram > 0 ? goldPerGram * qty : parseFloat(m.invested_amount || 0));
    }, 0);

    var fiVal = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      var id = m.asset_id;
      if (id.indexOf('BOND') < 0 && id.indexOf('FD') < 0 && id.indexOf('RD') < 0) return s;
      var val = parseFloat(m.current_value || m.invested_amount || 0);
      if (m.currency === 'USD') val *= usdinr;
      return s + val;
    }, 0);

    var retirementVal = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      if (m.asset_id.indexOf('PENSION') < 0 && m.asset_id.indexOf('EPFO') < 0) return s;
      return s + parseFloat(m.current_value || 0);
    }, 0);

    var manInvested = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      var id = m.asset_id;
      if (id.indexOf('COMMODITY') >= 0 || id.indexOf('BOND') >= 0 ||
          id.indexOf('FD') >= 0 || id.indexOf('RD') >= 0 ||
          id.indexOf('PENSION') >= 0 || id.indexOf('EPFO') >= 0 ||
          id.indexOf('EU_') >= 0 || id.indexOf('MF_') >= 0) {
        var inv = parseFloat(m.invested_amount || 0);
        if (m.currency === 'USD') inv *= usdinr;
        return s + inv;
      }
      return s;
    }, 0);

    var totalCurrent  = zEquityTotal.current + vTotal.current_inr +
                        commodityVal + fiVal + retirementVal + manMFCurrent;
    var totalInvested = zTotal.invested + vTotal.invested_inr + manInvested;

    // ── ALLOCATION ────────────────────────────────────────
    var alloc = [
      { name: 'India Equity & ETFs', value: zEquityTotal.current, color: '#C9A84C' },
      { name: 'Mutual Funds',        value: mfTotal.current,      color: '#5B8DEF' },
      { name: 'US/Global (Vested)',  value: vTotal.current_inr,   color: '#3DD68C' },
      { name: 'Commodities',         value: commodityVal,         color: '#F4645F' },
      { name: 'Fixed Income',        value: fiVal,                color: '#9B7FEA' },
      { name: 'Retirement',          value: retirementVal,        color: '#38BDF8' },
    ].filter(function(a) { return a.value > 0; });
    var allocTotal = alloc.reduce(function(s, a) { return s + a.value; }, 0);
    alloc.forEach(function(a) { a.pct = allocTotal > 0 ? a.value / allocTotal * 100 : 0; });

    var latestPnl = monthlyPnl.length > 0 ? monthlyPnl[monthlyPnl.length - 1] : {};
    var soldTotal = soldStocks.reduce(function(s, r) { return s + (parseFloat(r.realized_pnl_inr) || 0); }, 0);
    var assetMap  = {};
    assets.forEach(function(a) { assetMap[a.asset_id] = a; });

    var nLivePrices = Object.keys(livePrices).length;
    var nLiveMFNavs = Object.keys(mfNavsMap).length;

    console.log('[Data] compute done | live prices:', nLivePrices,
      '(GOOGLEFINANCE) | MF NAVs:', nLiveMFNavs,
      '| goldPerGram:', goldPerGram.toFixed(0));
    console.log('[Data] totalCurrent:', totalCurrent.toFixed(0),
      '| totalInvested:', totalInvested.toFixed(0));

    return {
      raw: d, lp, usdinr, assets, assetMap,
      zHold, vHold, manList, vestList,
      zEquityStocks, zReits, zEtfs, mfRows,
      zTotal, vTotal, mfTotal, zEquityTotal,
      commodityVal, fiVal, retirementVal, manMFCurrent,
      totalCurrent, totalInvested,
      alloc, allocTotal,
      latestPnl,
      soldStocks, soldTotal,
      watchlist, watchlistActive,
      monthlyPnl, snap,
      stockAlerts: d.stock_alerts || [],
      nLivePrices, nLiveMFNavs,
      goldPerGram, silverPerGram,
      rowCounts: (d._meta && d._meta.row_counts) || {},
      generatedAt: d._meta && d._meta.generated_at,
    };
  }

  // ── FORMAT HELPERS ────────────────────────────────────────
  function fmt(n, decimals) {
    decimals = decimals || 0;
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(n);
  }
  function fmtInr(n, compact) {
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    if (compact) {
      if (Math.abs(n) >= 1e7) return '\u20b9' + (n / 1e7).toFixed(2) + ' Cr';
      if (Math.abs(n) >= 1e5) return '\u20b9' + (n / 1e5).toFixed(2) + ' L';
    }
    return '\u20b9' + fmt(n, 0);
  }
  function fmtUsd(n, compact) {
    if (n === null || n === undefined || isNaN(n)) return '\u2014';
    if (compact && Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
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
    fetch, clearCache, fmt, fmtInr, fmtUsd, pctStr, pnlClass,
    get computed() { return _computed; },
  };
}());
