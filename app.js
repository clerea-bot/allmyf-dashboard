// ═══════════════════════════════════════════════════════════════
// AllMyF — App Orchestrator
// Tab routing, data lifecycle, UI state management
// ═══════════════════════════════════════════════════════════════

const App = (() => {
  let _data = null;
  let _activeTab = 'summary';
  let _rendered  = new Set();

  // ── INIT ──────────────────────────────────────────────────
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

  // ── LOAD DATA ─────────────────────────────────────────────
  async function loadData() {
    try {
      _data = await Data.fetch();
      _rendered.clear();
      renderTab(_activeTab);
      updateLastUpdated(_data.generatedAt);
    } catch (err) {
      showError(err.message);
    }
  }

  function renderTab(tab) {
    if (!_data) return;
    switch (tab) {
      case 'summary':    Render.renderSummary(_data);    break;
      case 'india':      Render.renderIndia(_data);      break;
      case 'global':     Render.renderGlobal(_data);     break;
      case 'fi':         Render.renderFI(_data);         break;
      case 'retirement': Render.renderRetirement(_data); break;
      case 'history':    Render.renderHistory(_data);    break;
    }
    _rendered.add(tab);
  }

  // ── REFRESH ───────────────────────────────────────────────
  function setupRefresh() {
    const btn = document.getElementById('refresh-btn');
    btn?.addEventListener('click', async () => {
      btn.classList.add('spinning');
      Data.clearCache();
      _rendered.clear();
      await loadData();
      btn.classList.remove('spinning');
    });
  }

  function updateLastUpdated(ts) {
    const el = document.getElementById('last-updated');
    if (!el) return;
    if (!ts) { el.textContent = 'Live'; return; }
    try {
      const d = new Date(ts);
      el.textContent = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST';
    } catch { el.textContent = 'Live'; }
  }

  // ── ERROR ─────────────────────────────────────────────────
  function showError(msg) {
    const html = `
      <div class="error-box">
        <strong>Could not load portfolio data.</strong><br>
        ${msg}<br><br>
        <em>Check that your Apps Script web app is deployed and accessible, then click Refresh.</em>
      </div>`;
    document.querySelectorAll('[id$="-content"]').forEach(el => {
      if (!el.id.includes('lock')) el.innerHTML = html;
    });
  }

  return { init };
})();
