// ═══════════════════════════════════════════════════════════════
// AllMyF — Authentication Module
// ═══════════════════════════════════════════════════════════════

const Auth = (() => {
  const SESSION_KEY = 'allmyf_session';
  const SESSION_HOURS = 12;

  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function saveSession() {
    const expiry = Date.now() + (SESSION_HOURS * 60 * 60 * 1000);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiry }));
  }

  function checkSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    try {
      const { expiry } = JSON.parse(raw);
      return Date.now() < expiry;
    } catch { return false; }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function attemptUnlock(password) {
    const hash = await hashPassword(password);
    return hash === CONFIG.PASSWORD_HASH;
  }

  function init() {
    const lockScreen   = document.getElementById('lock-screen');
    const app          = document.getElementById('app');
    const pwdInput     = document.getElementById('pwd-input');
    const unlockBtn    = document.getElementById('unlock-btn');
    const lockError    = document.getElementById('lock-error');
    const lockoutBtn   = document.getElementById('lockout-btn');

    function showApp() {
      lockScreen.classList.add('fade-out');
      setTimeout(() => {
        lockScreen.style.display = 'none';
        app.classList.add('visible');
        window.App && App.init();
      }, 600);
    }

    function showError(msg) {
      lockError.textContent = msg;
      pwdInput.classList.add('error');
      setTimeout(() => pwdInput.classList.remove('error'), 600);
    }

    // Check existing session
    if (checkSession()) {
      showApp();
      return;
    }

    async function handleUnlock() {
      const pwd = pwdInput.value.trim();
      if (!pwd) return;
      unlockBtn.textContent = 'Checking…';
      unlockBtn.disabled = true;
      const ok = await attemptUnlock(pwd);
      if (ok) {
        saveSession();
        showApp();
      } else {
        showError('Incorrect password');
        unlockBtn.textContent = 'Unlock Dashboard';
        unlockBtn.disabled = false;
        pwdInput.value = '';
        pwdInput.focus();
      }
    }

    unlockBtn.addEventListener('click', handleUnlock);
    pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
    pwdInput.focus();

    lockoutBtn && lockoutBtn.addEventListener('click', () => {
      clearSession();
      location.reload();
    });
  }

  return { init, checkSession, clearSession };
})();

// Boot auth immediately
Auth.init();
