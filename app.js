// ═══════════════════════════════════════════════════════════════
// AllMyF — App Orchestrator  v2
// Tab routing, data lifecycle, UI state
// ═══════════════════════════════════════════════════════════════

const App = (() => {
  let _data      = null;
  let _activeTab = 'summary';
  let _rendered  = new Set();

  async function init() {
    setupNav();
    setupRefresh();
    await loadData();
  }

  // ── NAVIGATION ────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    if (tab === _activeTab) return;
    _activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (_data && !_rendered.has(tab)) renderTab(tab);
  }

  // ── DATA LOAD ─────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    try {
      _data = await Data.fetch();
      _rendered.clear();
      renderTab(_activeTab);
      updateLastUpdated(_data.generatedAt);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function setLoading(on) {
    const btn = document.getElementById('refresh-btn');
    if (btn) btn.classList.toggle('spinning', on);
    const lu = document.getElementById('last-updated');
    if (lu && on) lu.textContent = 'Loading…';
  }

  function renderTab(tab) {
    if (!_data) return;
    try {
      switch (tab) {
        case 'summary':    Render.renderSummary(_data);    break;
        case 'india':      Render.renderIndia(_data);      break;
        case 'global':     Render.renderGlobal(_data);     break;
        case 'fi':         Render.renderFI(_data);         break;
        case 'retirement': Render.renderRetirement(_data); break;
        case 'history':    Render.renderHistory(_data);    break;
      }
      _rendered.add(tab);
    } catch (err) {
      const el = document.getElementById(`${tab}-content`);
      if (el) el.innerHTML = errorHtml('Render error: ' + err.message);
    }
  }

  // ── REFRESH ───────────────────────────────────────────────
  function setupRefresh() {
    document.getElementById('refresh-btn')?.addEventListener('click', async () => {
      Data.clearCache();
      _rendered.clear();
      await loadData();
    });
  }

  function updateLastUpdated(ts) {
    const el = document.getElementById('last-updated');
    if (!el) return;
    try {
      const d = new Date(ts);
      el.textContent = d.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
      }) + ' IST';
    } catch { el.textContent = 'Live'; }
  }

  // ── ERROR ─────────────────────────────────────────────────
  function errorHtml(msg) {
    return `
      <div class="error-box" style="margin:24px 0">
        <strong>⚠ Could not load data</strong><br><br>
        ${msg}<br><br>
        <strong>Quick checks:</strong><br>
        1. Open your Apps Script URL directly in a new tab — it should return JSON.<br>
        2. In Apps Script editor → Deploy → Manage Deployments → confirm "Execute as: Me" and "Anyone can access".<br>
        3. Click <strong>Refresh</strong> above to retry.
      </div>`;
  }

  function showError(msg) {
    const el = document.getElementById(`${_activeTab}-content`);
    if (el) el.innerHTML = errorHtml(msg);
    document.getElementById('last-updated').textContent = 'Error';
  }

  return { init };
})();
