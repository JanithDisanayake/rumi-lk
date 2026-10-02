/**
 * The portal API must accept the app's origin, and its cookie must reach it.
 *
 * A bundled Capacitor app serves its pages from `https://localhost` (Android,
 * androidScheme 'https') or `capacitor://localhost` (iOS) while the API stays
 * on the portal host. Two server-side settings decide whether login works:
 *
 *   1. CORS. Without these origins the app's preflight gets no
 *      Access-Control-Allow-Origin and every API call is blocked before it is
 *      sent — which presents as "correct password won't log in", a CORS error
 *      rather than an auth error.
 *   2. The session cookie's SameSite. The app's origin is cross-site to the
 *      API, so a 'lax' cookie is never stored or returned and login silently
 *      fails on the request after /login. 'none' is required for a bundled
 *      app to hold a session. That widens CSRF exposure for web sessions too,
 *      so it is an explicit opt-in (SESSION_COOKIE_SAMESITE=none), and the web
 *      default stays 'lax'.
 */

const fs = require('fs');
const path = require('path');

const {
  APP_ORIGINS,
  buildPortalCorsOrigins,
  resolveSessionSameSite,
} = require('../../dashboard/lib/portal-app-origins');

describe('buildPortalCorsOrigins', () => {
  it('always includes the Capacitor app origins (no port, local scheme)', () => {
    const origins = buildPortalCorsOrigins({});
    expect(APP_ORIGINS).toEqual(['https://localhost', 'capacitor://localhost']);
    for (const o of APP_ORIGINS) expect(origins).toContain(o);
  });

  it('keeps the configured portal + website origins and the local dev servers', () => {
    const origins = buildPortalCorsOrigins({
      portalUrl: 'https://portal.example.org',
      websiteOrigins: ['https://www.example.org', 'https://example.org'],
    });
    expect(origins).toEqual(
      expect.arrayContaining([
        'https://portal.example.org',
        'https://www.example.org',
        'https://example.org',
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
      ])
    );
  });

  it('never allows a wildcard (credentials are on)', () => {
    expect(buildPortalCorsOrigins({ portalUrl: '*' })).not.toContain('*');
  });

  it('skips an unset portal url rather than adding an empty origin', () => {
    expect(buildPortalCorsOrigins({ portalUrl: '' })).not.toContain('');
  });
});

describe('resolveSessionSameSite', () => {
  it("defaults to 'lax' — web sessions are unchanged", () => {
    expect(resolveSessionSameSite({})).toBe('lax');
  });

  it.each([['none', 'none'], ['NONE', 'none'], [' strict ', 'strict'], ['lax', 'lax']])(
    'honours SESSION_COOKIE_SAMESITE=%p',
    (raw, expected) => {
      expect(resolveSessionSameSite({ SESSION_COOKIE_SAMESITE: raw })).toBe(expected);
    }
  );

  it("falls back to 'lax' for an unknown value instead of passing junk to express-session", () => {
    expect(resolveSessionSameSite({ SESSION_COOKIE_SAMESITE: 'sometimes' })).toBe('lax');
  });
});

describe('dashboard/index.js uses them', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/index.js'), 'utf8');

  it('builds the portal CORS allow-list from buildPortalCorsOrigins', () => {
    expect(src).toMatch(/origin:\s*buildPortalCorsOrigins\(/);
  });

  it('sets the session cookie sameSite from resolveSessionSameSite', () => {
    expect(src).toMatch(/sameSite:\s*resolveSessionSameSite\(process\.env\)/);
  });
});
