# AllMyF Dashboard

Personal finance dashboard for `allmyf.uk`.

## Stack
- Vanilla JS (no framework, no build step)
- Chart.js for visualizations
- Google Apps Script as the API backend
- GitHub Pages for hosting

## Files
| File | Purpose |
|---|---|
| `index.html` | Main dashboard UI + CSS |
| `config.js` | API URL, password hash, settings |
| `auth.js` | SHA-256 password authentication |
| `data.js` | API fetching, caching, data processing |
| `render.js` | All tab rendering functions |
| `app.js` | Orchestrator — tabs, refresh, lifecycle |

## Changing Your Password

1. Open browser console (F12)
2. Run this command with your new password:
```javascript
crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_NEW_PASSWORD'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
```
3. Copy the hash output
4. Open `config.js` and replace the `PASSWORD_HASH` value
5. Commit and push

**Default password: `allmyf2026`** — change this immediately after first login.

## Deploy to GitHub Pages

1. Push this repo to `clerea-bot/allmyf-dashboard`
2. Go to Settings → Pages
3. Source: Deploy from branch → `main` → `/ (root)`
4. Visit `https://clerea-bot.github.io/allmyf-dashboard`
5. Point `allmyf.uk` DNS to GitHub Pages (CNAME)

## DNS Setup for allmyf.uk

In your domain registrar:
1. Add a CNAME record: `www` → `clerea-bot.github.io`
2. For apex domain, add A records pointing to GitHub's IPs:
   - 185.199.108.153
   - 185.199.109.153
   - 185.199.110.153
   - 185.199.111.153
3. Add `CNAME` file in repo root containing: `allmyf.uk`
4. Enable HTTPS in GitHub Pages settings

## Monthly Update Workflow

At end of each month:
1. Export Zerodha Holdings, P&L, Tradebook
2. Export Vested Holdings, P&L
3. Fill AllMyF_Monthly_Template_v3.xlsx
4. Upload files in a new Claude chat
5. Claude normalizes and imports into the master sheet
6. Click Refresh on the dashboard
