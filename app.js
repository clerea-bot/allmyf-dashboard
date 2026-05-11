// ═══════════════════════════════════════════════════════════════
// AllMyF — App Orchestrator v3
// Full console tracing + robust error display
// ═══════════════════════════════════════════════════════════════

var App = (function() {
  var _data      = null;
  var _activeTab = 'summary';
  var _rendered  = {};

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    console.log('[App] init() called');
    setupNav();
    setupRefresh();
    loadData();
    fetchTickerExternal();
  }

  // ── NAV ──────────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
    });
  }

  function switchTab(tab) {
    if (tab === _activeTab) return;
    _activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function(p) {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    if (_data && !_rendered[tab]) renderTab(tab);
  }

  // ── DATA LOAD ────────────────────────────────────────────
  function loadData() {
    console.log('[App] loadData() — calling Data.fetch()');
    setStatus('Loading…', false);

    Data.fetch()
      .then(function(d) {
        console.log('[App] Data.fetch() resolved OK', d ? 'data present' : 'data NULL');
        _data = d;
        _rendered = {};
        renderTab(_activeTab);
        updateLastUpdated(d.generatedAt);
        setStatus(null, false);
        updateTickerUsdinr(d.usdinr);
        updateTickerFromData(d);
      })
      .catch(function(err) {
        console.error('[App] Data.fetch() rejected:', err);
        showError(err.message || String(err));
        setStatus('Error', false);
      });
  }

  // ── RENDER ────────────────────────────────────────────────
  function renderTab(tab) {
    console.log('[App] renderTab:', tab);
    if (!_data) { console.warn('[App] renderTab called with no data'); return; }
    try {
      switch (tab) {
        case 'summary':    Render.renderSummary(_data);    break;
        case 'india':      Render.renderIndia(_data);      break;
        case 'global':     Render.renderGlobal(_data);     break;
        case 'fi':         Render.renderFI(_data);         break;
        case 'retirement': Render.renderRetirement(_data); break;
        case 'history':    Render.renderHistory(_data);    break;
        case 'alerts':     Render.renderAlerts(_data);     break;
      }
      _rendered[tab] = true;
      console.log('[App] renderTab', tab, 'complete');
    } catch (err) {
      console.error('[App] renderTab', tab, 'threw:', err);
      var el = document.getElementById(tab + '-content');
      if (el) el.innerHTML = errorBox('Render error in ' + tab + ': ' + err.message);
    }
  }

  // ── REFRESH ───────────────────────────────────────────────
  function setupRefresh() {
    var btn = document.getElementById('refresh-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        console.log('[App] manual refresh');
        Data.clearCache();
        _rendered = {};
        loadData();
      });
    }
  }

  // ── HELPERS ───────────────────────────────────────────────
  function setStatus(text, spinning) {
    var lu  = document.getElementById('last-updated');
    var btn = document.getElementById('refresh-btn');
    if (lu  && text)    lu.textContent = text;
    if (btn) btn.classList.toggle('spinning', !!spinning);
  }

  function updateLastUpdated(ts) {
    var lu = document.getElementById('last-updated');
    if (!lu) return;
    try {
      var d = new Date(ts);
      lu.textContent = d.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
      }) + ' IST';
    } catch(e) { lu.textContent = 'Live'; }
  }

  function errorBox(msg) {
    return '<div class="error-box" style="margin:24px 0">' +
      '<strong>⚠ Error</strong><br><br>' + msg + '<br><br>' +
      'Open browser console (F12) for full details. ' +
      'Click <strong>Refresh</strong> to retry.</div>';
  }

  function showError(msg) {
    console.error('[App] showError:', msg);
    var el = document.getElementById(_activeTab + '-content');
    if (el) {
      el.innerHTML = errorBox(msg);
    } else {
      var fb = document.getElementById('summary-content');
      if (fb) fb.innerHTML = errorBox(msg);
    }
  }

  // ── TICKER — USD/INR (from backend data) ─────────────────
  function updateTickerUsdinr(rate) {
    var el = document.getElementById('tk-usdinr');
    if (el && rate > 0) el.textContent = '₹' + Number(rate).toFixed(2);
  }

  // ── TICKER — S&P 500 + Sensex (from GOOGLEFINANCE via payload) ──
  // IDX_SP500 / IDX_SP500_CHG and IDX_SENSEX / IDX_SENSEX_CHG are
  // rows in live_prices sheet → served in d.lp. No browser fetch needed.
  function updateTickerFromData(d) {
    var lp = d.lp || {};

    // S&P 500
    var spPx  = lp['IDX_SP500']     ? lp['IDX_SP500'].price     : null;
    var spChg = lp['IDX_SP500_CHG'] ? lp['IDX_SP500_CHG'].price : null;
    if (spPx > 0) {
      var el = document.getElementById('tk-sp500');
      if (el) el.textContent = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(spPx);
    }
    if (spChg !== null) {
      var eld = document.getElementById('tk-sp500-d');
      if (eld) {
        eld.textContent = (spChg >= 0 ? '+' : '') + Number(spChg).toFixed(2) + '%';
        eld.className   = spChg >= 0 ? 'up' : 'dn';
      }
    }
    console.log('[App] S&P 500 (GOOGLEFINANCE):', spPx, spChg !== null ? spChg.toFixed(2) + '%' : 'no chg');

    // Sensex
    var sxPx  = lp['IDX_SENSEX']     ? lp['IDX_SENSEX'].price     : null;
    var sxChg = lp['IDX_SENSEX_CHG'] ? lp['IDX_SENSEX_CHG'].price : null;
    if (sxPx > 0) {
      var elS = document.getElementById('tk-sensex');
      if (elS) elS.textContent = new Intl.NumberFormat('en-IN', {
        maximumFractionDigits: 0
      }).format(sxPx);
    }
    if (sxChg !== null) {
      var eldS = document.getElementById('tk-sensex-d');
      if (eldS) {
        eldS.textContent = (sxChg >= 0 ? '+' : '') + Number(sxChg).toFixed(2) + '%';
        eldS.className   = sxChg >= 0 ? 'up' : 'dn';
      }
    }
    console.log('[App] Sensex (GOOGLEFINANCE):', sxPx, sxChg !== null ? sxChg.toFixed(2) + '%' : 'no chg');
  }

  // ── TICKER — BTC (CoinGecko, browser-side, CORS-enabled) ─
  // S&P 500 and Sensex moved to updateTickerFromData() above.
  function fetchTickerExternal() {
    window.fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
      { cache: 'no-store' }
    ).then(function(r) {
      return r.ok ? r.json() : null;
    }).then(function(j) {
      if (!j || !j.bitcoin) return;
      var price = j.bitcoin.usd;
      var chg   = j.bitcoin.usd_24h_change;
      var elPx  = document.getElementById('tk-btc');
      var elD   = document.getElementById('tk-btc-d');
      if (elPx && price > 0) {
        elPx.textContent = '$' + new Intl.NumberFormat('en-US', {
          maximumFractionDigits: 0
        }).format(price);
      }
      if (elD && chg !== null && chg !== undefined) {
        elD.textContent = (chg >= 0 ? '+' : '') + Number(chg).toFixed(2) + '%';
        elD.className   = chg >= 0 ? 'up' : 'dn';
      }
      console.log('[App] BTC (CoinGecko):', price, chg && Number(chg).toFixed(2) + '%');
    }).catch(function(err) {
      console.warn('[App] BTC ticker fetch failed:', err && err.message);
    });
  }

  return { init: init };
}());

// Cloudflare Access is the auth layer — start the app directly.
App.init();
