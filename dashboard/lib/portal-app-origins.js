/**
 * What the portal API must allow for the Android/iOS portal app.
 *
 * A bundled Capacitor app serves its pages from a local origin with no port —
 * `https://localhost` on Android (androidScheme 'https'), `capacitor://localhost`
 * on iOS — while the API stays on the portal host. Without these origins in the
 * CORS allow-list the app's preflight gets no Access-Control-Allow-Origin and
 * every API call is blocked before it is sent, which presents as "correct
 * password won't log in": a CORS error, not an auth error.
 *
 * The app's origin is also cross-site to the API, so a SameSite=lax session
 * cookie is never stored or returned and login silently fails on the request
 * after /login. SameSite=none is required for a bundled app to hold a session.
 * That applies to ALL portal sessions, web included, so it is an explicit
 * opt-in (SESSION_COOKIE_SAMESITE=none) and the default stays 'lax'. CSRF
 * exposure under 'none' is bounded by the explicit allow-list here (never a
 * wildcard) plus httpOnly and Secure, but it is a real widening versus 'lax'.
 *
 * Kept as its own tiny module so the rules are unit-testable without booting
 * the Express app.
 */

const APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];

// Vite dev server and local static server, for running the portal locally.
const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

/**
 * @param {object} [opts]
 * @param {string} [opts.portalUrl]  PORTAL_URL without a trailing slash
 * @param {string[]} [opts.websiteOrigins]  the public website's origins
 * @returns {string[]} the credentialed CORS allow-list for /api/portal
 */
function buildPortalCorsOrigins({ portalUrl, websiteOrigins = [] } = {}) {
  const configured = [portalUrl, ...websiteOrigins].filter(
    (o) => typeof o === 'string' && o && o !== '*'
  );
  return [...new Set([...configured, ...LOCAL_DEV_ORIGINS, ...APP_ORIGINS])];
}

const SAMESITE_VALUES = ['lax', 'strict', 'none'];

/** express-session `cookie.sameSite` from SESSION_COOKIE_SAMESITE; 'lax' unless set. */
function resolveSessionSameSite(env = process.env) {
  const raw = typeof env.SESSION_COOKIE_SAMESITE === 'string'
    ? env.SESSION_COOKIE_SAMESITE.trim().toLowerCase()
    : '';
  return SAMESITE_VALUES.includes(raw) ? raw : 'lax';
}

module.exports = { APP_ORIGINS, buildPortalCorsOrigins, resolveSessionSameSite };
