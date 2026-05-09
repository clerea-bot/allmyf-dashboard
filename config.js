// ═══════════════════════════════════════════════════════════════
// AllMyF Dashboard — Configuration
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Google Apps Script Web App URL
  API_URL: 'https://script.google.com/macros/s/AKfycbwoP9jBOs4gR16qLNwxE_FlZfFia8l7srRjTBaT24LfjZ6JWrLZJIXC47oFaboOTASxwQ/exec',

  // Cache API response for N seconds (reduces Apps Script quota usage)
  CACHE_SECONDS: 300,

  // USD/INR fallback rate if live price unavailable
  // Update this each time the rate moves significantly (current: May 2026)
  FALLBACK_USDINR: 94.5,

  // Dashboard owner name (shown in header)
  OWNER_NAME: 'AllMyF',

  // App version
  VERSION: '4.1.0',
};
