// ═══════════════════════════════════════════════════════════════
// AllMyF — Data Layer v5
// Phase 5: mfapi search fallback + TwelveData live stock prices
//
// Changes from v4:
//  - CACHE_KEY bumped to v5 (clears v4 cache)
//  - mfapi matching: 3-level lookup:
//      L1 exact name match → L2 starts-with match → L3 mfapi search
//    L3 searches by first 4 words, then picks candidate whose latest NAV
//    is within 10% of the Zerodha snapshot ltp_inr (identifies regular plan)
//  - fetchLivePrices(): TwelveData batch for Indian NSE + US stocks
//    Separate 30-min cache (CACHE_LP_KEY) independent of main 5-min data cache
//  - compute() annotates every equity/ETF/REIT/MF row with _liveLTP/_liveCurrent
//    and recalculates totals from live values where available
// ═══════════════════════════════════════════════════════════════

var Data = (function() {
  var CACHE_KEY    = 'allmyf_data_v5';
  var CACHE_LP_KEY = 'allmyf_lp_v1';
  var FETCH_TIMEOUT = 25000;
  var _raw      = null;
  var _computed = null;

  // ── PUBLIC: fetch ─────────────────────────────────────────
  function fetch() {
    console.log('[Data] fetch() v5');

    var cached = getCache(CACHE_KEY, CONFIG.CACHE_SECONDS);
    if (cached) {
      console.log('[Data] main data from cache (v5)');
      _raw = cached.data;
      return fetchMfNavs(cached.data)
        .then(function(mfResult) { return fetchLivePrices(cached.data, mfResult); })
        .then(function(r) {
          _computed = compute(cached.data, r.mfResult, r.livePrices);
          return _computed;
        });
    }

    return httpGet(CONFIG.API_URL).then(function(json) {
      if (json.error) throw new Error('Apps Script error: ' + (json.message || JSON.stringify(json)));
      _raw = json;
      setCache(CACHE_KEY, { data: json });
      return fetchMfNavs(json)
        .then(function(mfResult) { return fetchLivePrices(json, mfResult); })
        .then(function(r) {
          _computed = compute(json, r.mfResult, r.livePrices);
          return _computed;
        });
    });
  }

  // ── MFAPI — LIVE NAV FETCH (3-level matching) ─────────────
  function fetchMfNavs(rawJson) {
    var assets    = rawJson.assets    || [];
    var zHold     = rawJson.zerodha_holdings || [];
    var mfCodeMap = rawJson.mf_codes  || {};

    // L1 + L2 lookup table: normalised asset_name / ticker_symbol → scheme code
    var nameToCode = {};
    assets.forEach(function(a) {
      var code = a.mf_scheme_code ? String(a.mf_scheme_code).trim() : '';
      if (!code || code === 'LOOKUP_NEEDED') return;
      if (a.asset_name)    nameToCode[a.asset_name.trim().toLowerCase()]    = code;
      if (a.ticker_symbol) nameToCode[a.ticker_symbol.trim().toLowerCase()] = code;
    });

    var ETF_SYMS = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    var zerodhaSymToCode = {};   // sym → scheme code (built across all 3 levels)
    var neededCodes      = {};   // code → true
    var searchQueue      = [];   // [{symbol, snapshotNav}] for L3

    // Non-Zerodha MF codes from assets_master
    Object.keys(mfCodeMap).forEach(function(id) {
      var c = String(mfCodeMap[id] || '').trim();
      if (c && c !== 'LOOKUP_NEEDED') neededCodes[c] = true;
    });

    // Zerodha MFs — L1 and L2
    zHold.forEach(function(h) {
      var sym = String(h.symbol || '').trim();
      if (!sym) return;
      if (sym.indexOf(' ') < 0 && sym.length <= 15) return;   // not a MF
      if (ETF_SYMS.indexOf(sym) >= 0) return;

      var q    = sym.toLowerCase();
      var snap = parseFloat(h.ltp_inr) || 0;

      // L1 exact
      if (nameToCode[q]) {
        zerodhaSymToCode[sym] = nameToCode[q];
        neededCodes[nameToCode[q]] = true;
        return;
      }

      // L2 starts-with (Zerodha symbol is a prefix of the full scheme name, or vice versa)
      var found = null;
      var keys  = Object.keys(nameToCode);
      for (var i = 0; i < keys.length; i++) {
        var name = keys[i];
        if (name.indexOf(q) === 0 || q.indexOf(name) === 0) { found = nameToCode[name]; break; }
      }
      if (found) {
        zerodhaSymToCode[sym] = found;
        neededCodes[found] = true;
        return;
      }

      // L3 queued
      if (snap > 0) searchQueue.push({ symbol: sym, snapshotNav: snap });
    });

    // L3 — parallel mfapi search + NAV proximity match
    var searchPromises = searchQueue.map(function(item) {
      var words = item.symbol.split(' ').slice(0, 4).join(' ');
      var url   = 'https://api.mfapi.in/mf/search?q=' + encodeURIComponent(words);
      var ctrl  = new AbortController();
      var timer = setTimeout(function() { ctrl.abort(); }, 8000);

      return window.fetch(url, { signal: ctrl.signal, cache: 'no-store' })
        .then(function(r) { clearTimeout(timer); return r.ok ? r.json() : []; })
        .then(function(results) {
          if (!Array.isArray(results) || results.length === 0) return null;
          var cands = results.slice(0, 5);
          return Promise.all(cands.map(function(c) {
            return window.fetch('https://api.mfapi.in/mf/' + c.schemeCode + '/latest',
              { cache: 'no-store' })
              .then(function(r2) { return r2.ok ? r2.json() : null; })
              .catch(function() { return null; });
          })).then(function(navResults) {
            var best = null, bestDiff = Infinity;
            navResults.forEach(function(nr, i) {
              if (!nr || nr.status !== 'SUCCESS' || !nr.data || !nr.data[0]) return;
              var nav  = parseFloat(nr.data[0].nav);
              var diff = Math.abs(nav - item.snapshotNav) / item.snapshotNav;
              if (diff < 0.10 && diff < bestDiff) {
                bestDiff = diff;
                best = { symbol: item.symbol, code: String(cands[i].schemeCode), nav, navDate: nr.data[0].navDate };
              }
            });
            return best;
          });
        })
        .catch(function(err) {
          clearTimeout(timer);
          console.warn('[Data] mfapi L3 search failed:', item.symbol, err && err.message);
          return null;
        });
    });

    return Promise.all(searchPromises).then(function(searchResults) {
      searchResults.forEach(function(r) {
        if (!r) return;
        console.log('[Data] mfapi L3 match:', r.symbol, '→', r.code, '(NAV', r.nav + ')');
        zerodhaSymToCode[r.symbol] = r.code;
        neededCodes[r.code] = true;
      });

      var allCodes = Object.keys(neededCodes).filter(function(c) {
        return c && c !== 'LOOKUP_NEEDED';
      });
      if (allCodes.length === 0) return { navMap: {}, zerodhaSymToCode };

      console.log('[Data] mfapi fetching', allCodes.length, 'scheme codes');
      return Promise.all(allCodes.map(function(code) {
        var ctrl  = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 10000);
        return window.fetch('https://api.mfapi.in/mf/' + code + '/latest',
          { cache: 'no-store', signal: ctrl.signal })
          .then(function(r) { clearTimeout(timer); return r.ok ? r.json() : null; })
          .then(function(j) {
            if (j && j.status === 'SUCCESS' && j.data && j.data[0]) {
              var nav = parseFloat(j.data[0].nav);
              return nav > 0 ? { code: code, nav: nav, navDate: j.data[0].navDate } : null;
            }
            return null;
          })
          .catch(function() { return null; });
      })).then(function(results) {
        var navMap = {}, ok = 0;
        results.forEach(function(r) { if (r && r.nav) { navMap[r.code] = r; ok++; } });
        console.log('[Data] mfapi done:', ok + '/' + allCodes.length, 'NAVs loaded');
        return { navMap: navMap, zerodhaSymToCode: zerodhaSymToCode };
      });
    });
  }

  // ── TWELVEDATA — LIVE STOCK PRICES ───────────────────────
  function fetchLivePrices(rawJson, mfResult) {
    var cached = getCache(CACHE_LP_KEY, CONFIG.LIVE_PRICE_CACHE_SECONDS || 1800);
    if (cached) {
      console.log('[Data] live prices from cache (30 min)');
      return Promise.resolve({ mfResult: mfResult, livePrices: cached.data });
    }

    var KEY   = CONFIG.TWELVEDATA_KEY;
    if (!KEY) return Promise.resolve({ mfResult: mfResult, livePrices: {} });

    var ETF_SYMS = ['OILIETF','METAL','MAHKTECH','CPSEETF','MID150CASE','TOP100CASE'];
    var zHold = rawJson.zerodha_holdings || [];
    var vHold = rawJson.vested_holdings  || [];

    // NSE symbols: stocks + ETFs + REITs (strip -RR for lookup, keep symbol)
    var nseSym = [];
    zHold.forEach(function(h) {
      var s = String(h.symbol || '').trim();
      if (!s || s.indexOf(' ') >= 0 || s.length > 15) return;  // skip MFs
      if (nseSym.indexOf(s) < 0) nseSym.push(s);
    });

    var usSym = [];
    vHold.forEach(function(h) {
      var s = String(h.symbol || '').trim();
      if (s && usSym.indexOf(s) < 0) usSym.push(s);
    });

    console.log('[Data] TwelveData:', nseSym.length, 'NSE +', usSym.length, 'US symbols');

    // TwelveData batch calls — NSE symbols use "SYM:NSE" format
    function tdFetch(symbols, suffix) {
      if (symbols.length === 0) return Promise.resolve({});
      var url = 'https://api.twelvedata.com/price?symbol=' +
        symbols.map(function(s) { return encodeURIComponent(s + (suffix || '')); }).join(',') +
        '&apikey=' + KEY;
      return window.fetch(url, { cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : {}; })
        .catch(function() { return {}; });
    }

    return Promise.all([tdFetch(nseSym, ':NSE'), tdFetch(usSym, '')])
      .then(function(results) {
        var nseRaw = results[0] || {};
        var usRaw  = results[1] || {};
        var livePrices = {}, loaded = 0;

        function extract(raw, sym, suffix) {
          // Multi-symbol: raw["SYM:NSE"] = {price:"..."} or raw["SYM"] = {price:"..."}
          var key = sym + (suffix || '');
          var entry = raw[key] || raw[sym];
          if (entry && entry.price) {
            var p = parseFloat(entry.price);
            if (p > 0) { livePrices[sym] = p; loaded++; }
          }
        }

        // Handle single-symbol case (TwelveData returns plain {price:"..."})
        if (nseSym.length === 1 && nseRaw.price) {
          var p = parseFloat(nseRaw.price);
          if (p > 0) { livePrices[nseSym[0]] = p; loaded++; }
        } else {
          nseSym.forEach(function(s) { extract(nseRaw, s, ':NSE'); });
        }

        if (usSym.length === 1 && usRaw.price) {
          var p2 = parseFloat(usRaw.price);
          if (p2 > 0) { livePrices[usSym[0]] = p2; loaded++; }
        } else {
          usSym.forEach(function(s) { extract(usRaw, s, ''); });
        }

        console.log('[Data] TwelveData done:', loaded + '/' + (nseSym.length + usSym.length));
        setCache(CACHE_LP_KEY, { data: livePrices });
        return { mfResult: mfResult, livePrices: livePrices };
      });
  }

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
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(CACHE_LP_KEY);
    console.log('[Data] all caches cleared');
  }

  // ── COMPUTE ───────────────────────────────────────────────
  function compute(d, mfResult, livePrices) {
    mfResult    = mfResult    || { navMap: {}, zerodhaSymToCode: {} };
    livePrices  = livePrices  || {};
    var navMap          = mfResult.navMap          || {};
    var zerodhaSymToCode = mfResult.zerodhaSymToCode || {};
    var mfCodeMap       = d.mf_codes              || {};

    var lp        = d.live_prices       || {};
    var assets    = d.assets            || [];
    var zHold     = d.zerodha_holdings  || [];
    var vHold     = d.vested_holdings   || [];
    var manAssets = d.manual_assets     || [];
    var soldStocks = d.sold_stocks      || [];
    var monthlyPnl = d.monthly_pnl      || [];
    var snap      = d.latest_snapshot   || {};

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

    // ── LIVE LTP — NSE rows ───────────────────────────────
    // _liveLTP is always in INR (TwelveData returns local currency for NSE).
    // REITs stored as "BIRET-RR" — TwelveData might serve as "BIRET" — try both.
    function annotateNse(h) {
      var sym  = String(h.symbol || '');
      var bare = sym.replace(/-RR$/, '');             // strip REIT suffix
      var ltp  = livePrices[sym] || livePrices[bare];
      if (!ltp || ltp <= 0) return;
      var qty      = parseFloat(h.quantity   || 0);
      var invested = parseFloat(h.invested_inr || 0);
      h._liveLTP     = ltp;
      h._liveCurrent = ltp * qty;
      h._livePnl     = h._liveCurrent - invested;
      h._livePct     = invested > 0 ? h._livePnl / invested * 100 : null;
    }
    zEquityStocks.forEach(annotateNse);
    zReits.forEach(annotateNse);
    zEtfs.forEach(annotateNse);

    // ── LIVE LTP — Vested (USD) ───────────────────────────
    vHold.forEach(function(h) {
      var p = livePrices[h.symbol];
      if (!p || p <= 0) return;
      var qty     = parseFloat(h.quantity    || 0);
      var inv     = parseFloat(h.invested_usd || 0);
      h._liveLTP     = p;
      h._liveCurrent = p * qty;
      h._livePnl     = h._liveCurrent - inv;
      h._livePct     = inv > 0 ? h._livePnl / inv * 100 : null;
    });

    // ── LIVE NAV — Zerodha MFs ────────────────────────────
    mfRows.forEach(function(h) {
      var code = zerodhaSymToCode[h.symbol];
      if (!code || !navMap[code]) return;
      var qty      = parseFloat(h.quantity    || 0);
      var invested = parseFloat(h.invested_inr || 0);
      h._liveNAV     = navMap[code].nav;
      h._liveNavDate = navMap[code].navDate;
      h._liveCurrent = qty * navMap[code].nav;
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
      var code    = mfCodeMap[m.asset_id] ? String(mfCodeMap[m.asset_id]).trim() : '';
      var units   = parseFloat(m.quantity     || 0);
      var invested = parseFloat(m.invested_amount || 0);
      manMFInvested += invested;
      if (code && navMap[code]) {
        m._liveNAV     = navMap[code].nav;
        m._liveNavDate = navMap[code].navDate;
        m._liveCurrent = units * navMap[code].nav;
        manMFCurrent  += m._liveCurrent;
      }
    });

    // ── TOTALS (live values preferred) ────────────────────
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
      pnl:      0,
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
    // Business Insider IMPORTHTML → USD/oz price for gold and silver
    var xauUSD = (lp['FX_XAUINR'] && lp['FX_XAUINR'].price > 100) ? lp['FX_XAUINR'].price : 0;
    var xagUSD = (lp['FX_XAGINR'] && lp['FX_XAGINR'].price > 1)   ? lp['FX_XAGINR'].price : 0;
    var goldPerGram   = xauUSD > 0 ? (xauUSD * usdinr) / 31.1035 : 0;
    var silverPerGram = xagUSD > 0 ? (xagUSD * usdinr) / 31.1035 : 0;

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
    var nLiveMFNavs = Object.keys(navMap).length;

    console.log('[Data] compute done | live prices:', nLivePrices,
      '| MF NAVs:', nLiveMFNavs,
      '| goldPerGram:', goldPerGram.toFixed(0));
    console.log('[Data] totalCurrent:', totalCurrent.toFixed(0),
      '| totalInvested:', totalInvested.toFixed(0));

    return {
      raw: d, lp, usdinr, assets, assetMap,
      zHold, vHold, manList,
      zEquityStocks, zReits, zEtfs, mfRows,
      zTotal, vTotal, mfTotal, zEquityTotal,
      commodityVal, fiVal, retirementVal, manMFCurrent,
      totalCurrent, totalInvested,
      alloc, allocTotal,
      latestPnl,
      soldStocks, soldTotal,
      monthlyPnl, snap,
      stockAlerts: d.stock_alerts || [],
      nLivePrices, nLiveMFNavs,
      goldPerGram, silverPerGram,
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
