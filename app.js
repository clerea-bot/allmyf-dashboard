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

  // ── TICKER — S&P 500 (Yahoo Finance) + BTC (CoinGecko) ──
  function fetchTickerExternal() {
    // S&P 500 — Yahoo Finance v8 chart API (no key required)
    window.fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=2d&includePrePost=false',
      { cache: 'no-store' }
    ).then(function(r) {
      return r.ok ? r.json() : null;
    }).then(function(j) {
      if (!j) return;
      var meta = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (!meta) return;
      var price = meta.regularMarketPrice;
      var prev  = meta.chartPreviousClose || meta.previousClose;
      var chg   = (prev > 0 && price > 0) ? (price - prev) / prev * 100 : null;
      var elPx  = document.getElementById('tk-sp500');
      var elD   = document.getElementById('tk-sp500-d');
      if (elPx && price > 0) {
        elPx.textContent = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(price);
      }
      if (elD && chg !== null) {
        elD.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
        elD.className   = chg >= 0 ? 'up' : 'dn';
      }
      console.log('[App] S&P 500 ticker:', price, chg && chg.toFixed(2) + '%');
    }).catch(function(err) {
      console.warn('[App] S&P 500 ticker fetch failed:', err && err.message);
    });

    // BTC — CoinGecko free API (CORS-enabled, no key required)
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
      console.log('[App] BTC ticker:', price, chg && Number(chg).toFixed(2) + '%');
    }).catch(function(err) {
      console.warn('[App] BTC ticker fetch failed:', err && err.message);
    });
  }

  return { init: init };
}());

// Cloudflare Access is the auth layer — start the app directly.
App.init();
