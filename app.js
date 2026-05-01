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
    setStatus('Loading\u2026', false);

    Data.fetch()
      .then(function(d) {
        console.log('[App] Data.fetch() resolved OK', d ? 'data present' : 'data NULL');
        _data = d;
        _rendered = {};
        renderTab(_activeTab);
        updateLastUpdated(d.generatedAt);
        setStatus(null, false);
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
        case 'alerts':    Render.renderAlerts(_data);    break;
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
      '<strong>\u26a0 Error</strong><br><br>' + msg + '<br><br>' +
      'Open browser console (F12) for full details. ' +
      'Click <strong>Refresh</strong> to retry.</div>';
  }

  function showError(msg) {
    console.error('[App] showError:', msg);
    var el = document.getElementById(_activeTab + '-content');
    if (el) {
      el.innerHTML = errorBox(msg);
    } else {
      // Fallback — summary-content always exists
      var fb = document.getElementById('summary-content');
      if (fb) fb.innerHTML = errorBox(msg);
    }
  }

  return { init: init };
}());
