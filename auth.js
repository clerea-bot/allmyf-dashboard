// ═══════════════════════════════════════════════════════════════
// AllMyF — Authentication Module
// Uses pure-JS SHA-256 so it works on HTTP (pre-HTTPS) AND HTTPS.
// crypto.subtle only works on secure contexts — this doesn't.
// ═══════════════════════════════════════════════════════════════

const Auth = (() => {
  const SESSION_KEY  = 'allmyf_session';
  const SESSION_HOURS = 12;

  // ── Pure-JS SHA-256 (no Web Crypto required) ──────────────
  function sha256(str) {
    function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const msg = unescape(encodeURIComponent(str));
    const bytes = Array.from(msg).map(c => c.charCodeAt(0));
    const l = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push((l / Math.pow(2, i * 8)) & 0xff);
    for (let i = 0; i < bytes.length; i += 64) {
      const w = [];
      for (let j = 0; j < 16; j++)
        w[j] = (bytes[i+j*4]<<24)|(bytes[i+j*4+1]<<16)|(bytes[i+j*4+2]<<8)|bytes[i+j*4+3];
      for (let j = 16; j < 64; j++) {
        const s0 = rightRotate(w[j-15],7)^rightRotate(w[j-15],18)^(w[j-15]>>>3);
        const s1 = rightRotate(w[j-2],17)^rightRotate(w[j-2],19)^(w[j-2]>>>10);
        w[j] = (w[j-16]+s0+w[j-7]+s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let j = 0; j < 64; j++) {
        const S1  = rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25);
        const ch  = (e&f)^(~e&g);
        const t1  = (hh+S1+ch+K[j]+w[j]) >>> 0;
        const S0  = rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22);
        const maj = (a&b)^(a&c)^(b&c);
        const t2  = (S0+maj) >>> 0;
        hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      h = h.map((v, i) => ([a,b,c,d,e,f,g,hh][i] + v) >>> 0);
    }
    return h.map(v => v.toString(16).padStart(8,'0')).join('');
  }

  // ── Session helpers ────────────────────────────────────────
  function saveSession() {
    const expiry = Date.now() + SESSION_HOURS * 3600 * 1000;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiry }));
  }

  function checkSession() {
    try {
      const { expiry } = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
      return Date.now() < (expiry || 0);
    } catch { return false; }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const lockScreen = document.getElementById('lock-screen');
    const app        = document.getElementById('app');
    const pwdInput   = document.getElementById('pwd-input');
    const unlockBtn  = document.getElementById('unlock-btn');
    const lockError  = document.getElementById('lock-error');
    const lockoutBtn = document.getElementById('lockout-btn');

    function showApp() {
      lockScreen.classList.add('fade-out');
      setTimeout(() => {
        lockScreen.style.display = 'none';
        app.classList.add('visible');
        // Guard: App may not be parsed yet if session restored on cold load
        if (window.App && typeof App.init === 'function') {
          App.init();
        } else {
          document.addEventListener('DOMContentLoaded', () => App.init());
        }
      }, 600);
    }

    function showError(msg) {
      lockError.textContent = msg;
      pwdInput.classList.add('error');
      setTimeout(() => pwdInput.classList.remove('error'), 600);
    }

    // Delay 50ms so all scripts finish parsing before showApp fires
    if (checkSession()) { setTimeout(showApp, 50); return; }

    function handleUnlock() {
      const pwd = pwdInput.value.trim();
      if (!pwd) return;
      unlockBtn.textContent = 'Checking…';
      unlockBtn.disabled = true;
      setTimeout(() => {
        const h = sha256(pwd);
        if (h === CONFIG.PASSWORD_HASH) {
          saveSession();
          showApp();
        } else {
          showError('Incorrect password');
          unlockBtn.textContent = 'Unlock Dashboard';
          unlockBtn.disabled = false;
          pwdInput.value = '';
          pwdInput.focus();
        }
      }, 30);
    }

    unlockBtn.addEventListener('click', handleUnlock);
    pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
    pwdInput.focus();

    lockoutBtn?.addEventListener('click', () => { clearSession(); location.reload(); });
  }

  // ── Console helper ─────────────────────────────────────────
  // Usage from browser console: Auth.hash('newpassword')
  function hash(pwd) {
    const h = sha256(pwd);
    console.log('Hash:', h);
    console.log('Paste into config.js as PASSWORD_HASH');
    return h;
  }

  return { init, checkSession, clearSession, hash };
})();

Auth.init();
