/**
 * BAILEYS_AUTH_STORE=redis — session storage, the cross-instance lock, and the /pairing page.
 */
const path = require('path');

const redisAuth = require('../../bot/shared/services/messaging/baileys-redis-auth');

// A tiny in-memory ioredis stand-in for the calls the module makes.
function fakeRedis() {
  const hashes = new Map();
  const strings = new Map();
  const hash = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  return {
    hget: async (k, f) => (hash(k).has(f) ? hash(k).get(f) : null),
    hset: async (k, f, v) => { hash(k).set(f, v); return 1; },
    hmget: async (k, ...fs) => fs.map((f) => (hash(k).has(f) ? hash(k).get(f) : null)),
    hdel: async (k, f) => { hash(k).delete(f); return 1; },
    hexists: async (k, f) => (hash(k).has(f) ? 1 : 0),
    del: async (k) => { hashes.delete(k); strings.delete(k); return 1; },
    set: async (k, v, _px, _ttl, nx) => {
      if (nx === 'NX' && strings.has(k)) return null;
      strings.set(k, v); return 'OK';
    },
    eval: async (script, _n, k, id) => {
      if (strings.get(k) !== id) return 0;
      if (script.includes("'del'")) strings.delete(k);
      return 1;
    },
    _strings: strings,
  };
}

const lib = {
  initAuthCreds: () => ({ noiseKey: { private: Buffer.from([1, 2, 3]) }, registered: false }),
  BufferJSON: {
    replacer: (_k, v) => (Buffer.isBuffer(v) ? { type: 'Buffer', data: v.toString('base64') } : v),
    reviver: (_k, v) => (v && v.type === 'Buffer' ? Buffer.from(v.data, 'base64') : v),
  },
  proto: { Message: { AppStateSyncKeyData: { fromObject: (o) => ({ wrapped: o }) } } },
};

describe('redis auth state', () => {
  test('starts from fresh creds, persists them, and loads them back', async () => {
    const redis = fakeRedis();
    expect(await redisAuth.hasCredentials(redis)).toBe(false);

    const first = await redisAuth.useRedisAuthState(lib, redis);
    expect(first.state.creds.registered).toBe(false);
    first.state.creds.registered = true;
    await first.saveCreds();
    expect(await redisAuth.hasCredentials(redis)).toBe(true);

    const second = await redisAuth.useRedisAuthState(lib, redis);
    expect(second.state.creds.registered).toBe(true);
    expect(Buffer.isBuffer(second.state.creds.noiseKey.private)).toBe(true);
  });

  test('keys round-trip, null deletes, app-state keys are re-wrapped', async () => {
    const redis = fakeRedis();
    const { state } = await redisAuth.useRedisAuthState(lib, redis);
    await state.keys.set({ session: { a: { x: 1 }, b: { x: 2 } }, 'app-state-sync-key': { k1: { keyData: 'd' } } });
    expect(await state.keys.get('session', ['a', 'b', 'c'])).toEqual({ a: { x: 1 }, b: { x: 2 }, c: null });
    expect((await state.keys.get('app-state-sync-key', ['k1'])).k1).toEqual({ wrapped: { keyData: 'd' } });
    await state.keys.set({ session: { a: null } });
    expect((await state.keys.get('session', ['a'])).a).toBeNull();
  });

  test('clearSession forgets everything', async () => {
    const redis = fakeRedis();
    const { state, saveCreds } = await redisAuth.useRedisAuthState(lib, redis);
    await saveCreds();
    await state.keys.set({ session: { a: { x: 1 } } });
    await redisAuth.clearSession(redis);
    expect(await redisAuth.hasCredentials(redis)).toBe(false);
    expect((await state.keys.get('session', ['a'])).a).toBeNull();
  });
});

describe('redis lock', () => {
  afterEach(() => redisAuth._resetLockForTests());

  test('a second claimant waits, then gives up with a clear error', async () => {
    const redis = fakeRedis();
    redis._strings.set(redisAuth.LOCK_KEY, 'someone-else');
    await expect(redisAuth.acquireLock({ redis, waitMs: 30, pollMs: 10 })).rejects.toThrow(/still holds the WhatsApp session lock/);
  });

  test('claims a free lock and releases it', async () => {
    const redis = fakeRedis();
    await redisAuth.acquireLock({ redis });
    expect(redis._strings.get(redisAuth.LOCK_KEY)).toBe(redisAuth.INSTANCE_ID);
    await redisAuth.releaseLock(redis);
    expect(redis._strings.has(redisAuth.LOCK_KEY)).toBe(false);
  });
});

describe('/pairing routes', () => {
  const routesPath = path.resolve(__dirname, '../../bot/shared/services/messaging/pairing-routes.js');
  let saved;
  beforeEach(() => { saved = { ...process.env }; });
  afterEach(() => { process.env = saved; });

  function call(router, method, url, query = {}) {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200, headers: {},
        set(h) { Object.assign(this.headers, h); return this; },
        status(c) { this.statusCode = c; return this; },
        type() { return this; },
        end() { resolve(this); return this; },
        send(b) { this.body = b; resolve(this); return this; },
        json(b) { this.body = b; resolve(this); return this; },
        redirect(c, l) { this.statusCode = c; this.location = l; resolve(this); },
      };
      router.handle({ method, url, originalUrl: url, query, headers: {} }, res, () => resolve({ statusCode: 'next' }));
    });
  }

  test('does not exist without PAIRING_TOKEN, and rejects a wrong key', async () => {
    delete process.env.PAIRING_TOKEN;
    const { build } = require(routesPath);
    expect((await call(build(), 'GET', '/', { key: 'x' })).statusCode).toBe(404);
    process.env.PAIRING_TOKEN = 'right-token';
    expect((await call(build(), 'GET', '/', { key: 'wrong' })).statusCode).toBe(404);
  });

  test('serves the page with the right key and never caches it', async () => {
    process.env.PAIRING_TOKEN = 'right-token';
    const { build } = require(routesPath);
    const res = await call(build(), 'GET', '/', { key: 'right-token' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pair WhatsApp');
    expect(res.headers['Cache-Control']).toBe('no-store');
    const state = await call(build(), 'GET', '/state', { key: 'right-token' });
    expect(state.body).toHaveProperty('status');
    expect(state.body).not.toHaveProperty('qr');
  });

  test('qrToSvg draws a scannable-size SVG', () => {
    const { qrToSvg } = require(routesPath);
    const svg = qrToSvg('2@Zm9vYmFy,YmF6,cXV4');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
  });
});
