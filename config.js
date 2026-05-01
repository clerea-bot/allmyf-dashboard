// ═══════════════════════════════════════════════════════════════
// AllMyF Dashboard — Configuration
// To change your password:
//   1. Open browser console (F12)
//   2. Run: crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpassword'))
//              .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
//   3. Replace PASSWORD_HASH below with the output
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Google Apps Script Web App URL
  API_URL: 'https://script.google.com/macros/s/AKfycbwoP9jBOs4gR16qLNwxE_FlZfFia8l7srRjTBaT24LfjZ6JWrLZJIXC47oFaboOTASxwQ/exec',

  // SHA-256 hash of password "allmyf2026" — change this after first login
  // Default password: allmyf2026
  PASSWORD_HASH: '27d6ac661190a157f60dbcc165b425d47ef08508661fc0e77ff98b80720d6a94',

  // Cache API response for N seconds (reduces Apps Script quota usage)
  CACHE_SECONDS: 300,

  // Live stock price cache (TwelveData) — 30 minutes
  // Free plan: 800 credits/day. With ~120 symbols, this allows ~6 full refreshes/day.
  // Extend to 3600 (1 hour) if you hit the daily limit.
  LIVE_PRICE_CACHE_SECONDS: 1800,

  // TwelveData API key — free tier, 800 credits/day
  // Provides live LTP for Indian (NSE) and US stocks.
  // Replace if key is rotated: https://twelvedata.com/account/api-keys
  TWELVEDATA_KEY: '49f53091930e4bd8bcdd338a859e030a',

  // USD/INR fallback rate if live price unavailable
  // Update this each time the rate moves significantly (current: May 2026)
  FALLBACK_USDINR: 94.5,

  // Dashboard owner name (shown in header)
  OWNER_NAME: 'AllMyF',

  // App version
  VERSION: '4.0.0',
};
