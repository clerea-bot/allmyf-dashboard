// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer v4
// Phase 5: mfapi.in live NAV + gold/silver USD price fix
//
// Changes from v3:
//  - CACHE_KEY bumped to v4 (clears stale v3 cache automatically)
//  - fetch() chains mfapi.in parallel calls after main API load
//  - fetchMfNavs(): fires one GET per scheme code, 10s timeout each
//  - compute() now accepts mfNavs and uses them for all MFs
//  - gold/silver: Business Insider gives USD → multiply by usdinr
//  - manMFCurrent (non-Zerodha MF live value) added to totalCurrent
//  - mfTotal now includes both Zerodha and non-Zerodha MFs
// ═══════════════════════════════════════════════════════════════

var Data = (function() {
  var CACHE_KEY     = 'allmyf_data_v4';  // bumped — clears old v3 cache on first load
  var FETCH_TIMEOUT = 25000;
  var _raw      = null;
  var _computed = null;

  // ── FETCH (public, called by App) ────────────────────────
  function fetch() {
    console.log('[Data] fetch() v4 called');

    var cached = getCache();
    if (cached) {
      console.log('[Data] returning cached data (v4)');
      _raw      = cached.data;
      _computed = compute(cached.data, cached.mfNavs || {});
      return Promise.resolve(_computed);
    }

    console.log('[Data] no cache — firing HTTP request to:', CONFIG.API_URL);

    return httpGet(CONFIG.API_URL).then(function(json) {
      console.log('[Data] response received, keys:', Object.keys(json));
      if (json.error) throw new Error('Apps Script error: ' + (json.message || JSON.stringify(json)));
      _raw = json;

      // Fetch live NAVs from mfapi.in (parallel; gracefully skipped if offline)
      return fetchMfNavs(json.mf_codes || {}).then(function(mfNavs) {
        setCache({ data: json, mfNavs: mfNavs });
        _computed = compute(json, mfNavs);
        console.log('[Data] compute() done');
        return _computed;
      });
    });
  }

  // ── MFAPI.IN — LIVE NAV FETCH ─────────────────────────────
  // Fires parallel GET requests for every unique MF scheme code.
  // mfapi.in is free, no API key needed, CORS-enabled.
  // Any failed call returns null nav and is silently skipped.
  // Returns: { schemeCode: { nav: Number, navDate: String } }
  function fetchMfNavs(mfCodes) {
    var codeMap = mfCodes || {};
    var allCodes = Object.keys(codeMap).map(function(k) {
      return String(codeMap[k] || '').trim();
    });
    var unique = allCodes.filter(function(c, i, a) {
      return c && c !== 'LOOKUP_NEEDED' && a.indexOf(c) === i;
    });

    if (unique.length === 0) {
      console.log('[Data] mfapi: no scheme codes to fetch');
      return Promise.resolve({});
    }

    console.log('[Data] mfapi.in — fetching', unique.length, 'scheme codes in parallel');

    var promises = unique.map(function(code) {
      // AbortController gives each call a 10-second timeout
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, 10000);

      return window.fetch('https://api.mfapi.in/mf/' + code + '/latest', {
        method: 'GET',
        cache:  'no-store',
        signal: controller.signal,
      })
      .then(function(r) {
        clearTimeout(timer);
        return r.ok ? r.json() : null;
      })
      .then(function(json) {
        if (json && json.status === 'SUCCESS' && json.data && json.data[0]) {
          var nav = parseFloat(json.data[0].nav);
          return nav > 0 ? { code: code, nav: nav, navDate: json.data[0].navDate } : null;
        }
        return null;
      })
      .catch(function(err) {
        clearTimeout(timer);
        console.warn('[Data] mfapi failed for', code, ':', err && err.message);
        return null;
      });
    });

    return Promise.all(promises).then(function(results) {
      var out = {};
      var ok  = 0;
      results.forEach(function(r) {
        if (r && r.nav) { out[r.code] = { nav: r.nav, navDate: r.navDate }; ok++; }
      });
      console.log('[Data] mfapi done:', ok, '/', unique.length, 'NAVs loaded');
      return out;
    });
  }

  // ── HTTP GET with timeout ─────────────────────────────────
  function httpGet(url) {
    return new Promise(function(resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function() {
        controller.abort();
        reject(new Error(
          'Request timed out after 25s. Apps Script cold-start or CORS issue. ' +
          'Open the API URL directly to verify it returns JSON.'
        ));
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
          console.error('[Data] JSON parse failed, first 200 chars:', text.slice(0, 200));
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
  // Cache stores { data, mfNavs, ts } — both the raw JSON and the NAV snapshot.
  function getCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CONFIG.CACHE_SECONDS * 1000) return null;
      return obj;
    } catch(e) { return null; }
  }

  function setCache(payload) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        data:    payload.data,
        mfNavs:  payload.mfNavs,
        ts:      Date.now(),
      }));
    } catch(e) { console.warn('[Data] cache write failed:', e.message); }
  }

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
    console.log('[Data] cache cleared');
  }

  // ── COMPUTE ───────────────────────────────────────────────
  // mfNavs: { schemeCode: { nav: Number, navDate: String } }
  //   — populated by fetchMfNavs(); empty object if offline.
  function compute(d, mfNavs) {
    mfNavs = mfNavs || {};

    var lp         = d.live_prices       || {};
    var assets     = d.assets            || [];
    var zHold      = d.zerodha_holdings  || [];
    var vHold      = d.vested_holdings   || [];
    var manAssets  = d.manual_assets     || [];
    var snap       = d.latest_snapshot   || {};
    var monthlyPnl = d.monthly_pnl       || [];
    var soldStocks = d.sold_stocks       || [];
    var mfCodeMap  = d.mf_codes          || {};  // { assetId: schemeCode }

    var usdinr = (lp['FX_USDINR'] && lp['FX_USDINR'].price) || CONFIG.FALLBACK_USDINR;

    // ── ZERODHA TOTAL ─────────────────────────────────────────
    var zTotal = zHold.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr)      || 0),
        current:  s.current  + (parseFloat(h.current_value_inr) || 0),
        pnl:      s.pnl      + (parseFloat(h.pnl_inr)           || 0),
      };
    }, { invested: 0, current: 0, pnl: 0 });

    // ── VESTED TOTAL ─────────────────────────────────────────
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

    // ── LATEST MANUAL ASSET PER ID ────────────────────────────
    var latestManual = {};
    manAssets.forEach(function(m) {
      if (!m.asset_id) return;
      if (!latestManual[m.asset_id] || m.snapshot_month > latestManual[m.asset_id].snapshot_month)
        latestManual[m.asset_id] = m;
    });
    var manList = Object.keys(latestManual).map(function(k) { return latestManual[k]; });

    // ── CLASSIFY ZERODHA ROWS ─────────────────────────────────
    var ETF_SYMS = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    // MF rows: symbol contains a space OR is very long (full fund name)
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

    var zEquityTotal = zEquityRows.reduce(function(s, h) {
      return {
        invested: s.invested + (parseFloat(h.invested_inr)      || 0),
        current:  s.current  + (parseFloat(h.current_value_inr) || 0),
      };
    }, { invested: 0, current: 0 });

    // ── LIVE MF NAV INTEGRATION ────────────────────────────────
    // Step 1: build asset_name/ticker → schemeCode map from assets_master
    //   Used to match Zerodha MF fund names (stored as symbol) to scheme codes.
    var assetNameToCode = {};
    assets.forEach(function(a) {
      var code = a.mf_scheme_code ? String(a.mf_scheme_code).trim() : '';
      if (!code || code === 'LOOKUP_NEEDED') return;
      if (a.asset_name)    assetNameToCode[a.asset_name.trim().toLowerCase()]    = code;
      if (a.ticker_symbol) assetNameToCode[a.ticker_symbol.trim().toLowerCase()] = code;
    });

    // Step 2: annotate each Zerodha MF row with live NAV from mfapi
    //   Falls back to snapshot values if scheme code not found or NAV unavailable.
    mfRows.forEach(function(h) {
      var code = assetNameToCode[(h.symbol || '').trim().toLowerCase()];
      if (code && mfNavs[code]) {
        h._liveNAV     = mfNavs[code].nav;
        h._liveNavDate = mfNavs[code].navDate;
        h._liveCurrent = parseFloat(h.quantity || 0) * mfNavs[code].nav;
      }
      // If no match, h._liveNAV stays undefined; render falls back to ltp_inr
    });

    // Step 3: compute mfTotal using live NAVs where available
    var mfTotal = mfRows.reduce(function(s, h) {
      var curr = (h._liveCurrent !== undefined) ? h._liveCurrent : parseFloat(h.current_value_inr || 0);
      return {
        invested: s.invested + (parseFloat(h.invested_inr) || 0),
        current:  s.current  + curr,
      };
    }, { invested: 0, current: 0 });

    // Step 4: annotate non-Zerodha MF rows in manList with live NAV from mfapi
    //   mfCodeMap: { assetId → schemeCode } — lookup via asset_id directly.
    var manMFCurrent  = 0;
    var manMFInvested = 0;
    manList.forEach(function(m) {
      if (!m.asset_id || m.asset_id.indexOf('MF_') < 0) return;
      var code    = mfCodeMap[m.asset_id] ? String(mfCodeMap[m.asset_id]).trim() : '';
      var units   = parseFloat(m.quantity || 0);
      var invested = parseFloat(m.invested_amount || 0);
      manMFInvested += invested;
      if (code && mfNavs[code]) {
        m._liveNAV     = mfNavs[code].nav;
        m._liveNavDate = mfNavs[code].navDate;
        m._liveCurrent = units * mfNavs[code].nav;
        manMFCurrent  += m._liveCurrent;
      }
      // If offline: m._liveNAV stays undefined; render shows "—"
    });

    // Step 5: add non-Zerodha MFs to mfTotal (for allocation chart + MF summary card)
    mfTotal.current  += manMFCurrent;
    mfTotal.invested += manMFInvested;

    // ── COMMODITY VALUE ────────────────────────────────────────
    // NOTE: Business Insider IMPORTHTML formulas (used for gold/silver prices)
    // return price in USD per troy oz — NOT INR.
    // The asset_ids are still named FX_XAUINR / FX_XAGINR (legacy naming).
    // Conversion: USD per troy oz × usdinr / 31.1035 grams per troy oz = INR per gram.
    var xauUSD = (lp['FX_XAUINR'] && typeof lp['FX_XAUINR'].price === 'number' && lp['FX_XAUINR'].price > 0)
      ? lp['FX_XAUINR'].price : 0;
    var xagUSD = (lp['FX_XAGINR'] && typeof lp['FX_XAGINR'].price === 'number' && lp['FX_XAGINR'].price > 0)
      ? lp['FX_XAGINR'].price : 0;
    var goldPerGram   = xauUSD > 0 ? (xauUSD * usdinr) / 31.1035 : 0;
    var silverPerGram = xagUSD > 0 ? (xagUSD * usdinr) / 31.1035 : 0;

    var commodityVal = manList.reduce(function(s, m) {
      if (!m.asset_id || m.asset_id.indexOf('COMMODITY') < 0) return s;
      var qty = parseFloat(m.quantity || 0);
      if (m.asset_id.indexOf('GOLD') >= 0 || m.asset_id.indexOf('SGB') >= 0) {
        return s + (goldPerGram > 0 ? goldPerGram * qty : parseFloat(m.invested_amount || 0));
      }
      if (m.asset_id.indexOf('SILVER') >= 0) {
        return s + (silverPerGram > 0 ? silverPerGram * qty : 0);
      }
      return s + parseFloat(m.current_value || m.invested_amount || 0);
    }, 0);

    // ── FIXED INCOME VALUE ────────────────────────────────────
    var fiVal = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      var id = m.asset_id;
      if (id.indexOf('BOND') < 0 && id.indexOf('FD') < 0 && id.indexOf('RD') < 0) return s;
      var val = parseFloat(m.current_value || m.invested_amount || 0);
      if (m.currency === 'USD') val = val * usdinr;
      return s + val;
    }, 0);

    // ── RETIREMENT VALUE ──────────────────────────────────────
    var retirementVal = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      if (m.asset_id.indexOf('PENSION') < 0 && m.asset_id.indexOf('EPFO') < 0) return s;
      return s + parseFloat(m.current_value || 0);
    }, 0);

    // ── TOTALS ────────────────────────────────────────────────
    // manInvested: everything in manual_assets that isn't already in zTotal/vTotal.
    // Includes: commodities, bonds, FDs, RDs, retirement, EU funds, non-Zerodha MFs.
    var manInvested = manList.reduce(function(s, m) {
      if (!m.asset_id) return s;
      var id = m.asset_id;
      if (id.indexOf('COMMODITY') >= 0 || id.indexOf('BOND') >= 0 ||
          id.indexOf('FD') >= 0 || id.indexOf('RD') >= 0 ||
          id.indexOf('PENSION') >= 0 || id.indexOf('EPFO') >= 0 ||
          id.indexOf('EU_') >= 0 || id.indexOf('MF_') >= 0) {
        var inv = parseFloat(m.invested_amount || 0);
        if (m.currency === 'USD') inv = inv * usdinr;
        return s + inv;
      }
      return s;
    }, 0);

    // totalCurrent now includes live non-Zerodha MF values (was missing in Phase 4)
    var totalCurrent  = zTotal.current + vTotal.current_inr + commodityVal + fiVal + retirementVal + manMFCurrent;
    var totalInvested = zTotal.invested + vTotal.invested_inr + manInvested;

    // ── ALLOCATION CHART DATA ─────────────────────────────────
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

    console.log('[Data] commodityVal:', commodityVal.toFixed(0),
      '| goldPerGram:', goldPerGram.toFixed(2),
      '| silverPerGram:', silverPerGram.toFixed(2));
    console.log('[Data] fiVal:', fiVal.toFixed(0),
      '| retirementVal:', retirementVal.toFixed(0),
      '| manMFCurrent:', manMFCurrent.toFixed(0));
    console.log('[Data] totalCurrent:', totalCurrent.toFixed(0),
      '| totalInvested:', totalInvested.toFixed(0));

    return {
      raw: d,
      lp: lp, usdinr: usdinr,
      assets: assets, assetMap: assetMap,
      zHold: zHold, vHold: vHold, manList: manList,
      zEquityStocks: zEquityStocks, zReits: zReits, zEtfs: zEtfs, mfRows: mfRows,
      zTotal: zTotal, vTotal: vTotal, mfTotal: mfTotal, zEquityTotal: zEquityTotal,
      commodityVal: commodityVal, fiVal: fiVal, retirementVal: retirementVal,
      manMFCurrent: manMFCurrent,
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
