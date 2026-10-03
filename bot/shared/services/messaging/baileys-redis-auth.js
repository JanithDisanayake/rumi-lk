'use strict';
/**
 * Redis-backed Baileys session, for hosts with no persistent disk (BAILEYS_AUTH_STORE=redis).
 *
 * The default store is a folder (`useMultiFileAuthState`), which a container
 * redeploy wipes — and wiping it means a new QR scan every release. This keeps
 * the same data (creds + Signal keys) in one Redis hash instead, and replaces the
 * pid-file instance lock with a Redis lock that a NEW instance WAITS for rather
 * than failing on: during a rolling deploy the old container is still draining
 * while the new one boots, and two live sockets on one session make WhatsApp
 * invalidate it (see baileys-connection.js).
 *
 * The hash holds the WhatsApp login. Treat the Redis instance like a credential.
 *
 * Plain ioredis calls only (hget/hset/hmget/hdel/hexists/del/set/eval), so the
 * unit tests can drive it with a small in-memory fake.
 */

const crypto = require('crypto');

const PREFIX = process.env.BAILEYS_REDIS_PREFIX || 'rumi:baileys';
const AUTH_KEY = `${PREFIX}:auth`;
const LOCK_KEY = `${PREFIX}:lock`;

const LOCK_TTL_MS = 45000;
const LOCK_RENEW_MS = 15000;
const LOCK_POLL_MS = 3000;
const LOCK_WAIT_MS = 180000;

let client = null;

/** The shared ioredis connection (created on first use). */
function getRedis() {
  if (!client) {
    const Redis = require('ioredis');
    if (!process.env.REDIS_URL) throw new Error('BAILEYS_AUTH_STORE=redis needs REDIS_URL');
    client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
    client.on('error', () => { /* ioredis retries; a log line per retry is noise */ });
  }
  return client;
}

/** Test seam: use a fake client. */
function _setRedisForTests(fake) {
  client = fake;
}

/**
 * Same contract as Baileys' useMultiFileAuthState: `{ state, saveCreds }`.
 *
 * @param {{initAuthCreds: Function, BufferJSON: object, proto: object}} lib the loaded `baileys` module
 * @param {object} [redis]
 */
async function useRedisAuthState(lib, redis = getRedis()) {
  const { initAuthCreds, BufferJSON, proto } = lib;
  const encode = (value) => JSON.stringify(value, BufferJSON.replacer);
  const decode = (text) => (text ? JSON.parse(text, BufferJSON.reviver) : null);

  const creds = decode(await redis.hget(AUTH_KEY, 'creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const fields = ids.map((id) => `${type}-${id}`);
          const rows = fields.length ? await redis.hmget(AUTH_KEY, ...fields) : [];
          const out = {};
          ids.forEach((id, i) => {
            let value = decode(rows[i]);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            out[id] = value;
          });
          return out;
        },
        set: async (data) => {
          const writes = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const field = `${category}-${id}`;
              writes.push(value ? redis.hset(AUTH_KEY, field, encode(value)) : redis.hdel(AUTH_KEY, field));
            }
          }
          await Promise.all(writes);
        },
      },
    },
    saveCreds: async () => { await redis.hset(AUTH_KEY, 'creds', encode(creds)); },
  };
}

/** True when a paired session is stored. */
async function hasCredentials(redis = getRedis()) {
  return Boolean(await redis.hexists(AUTH_KEY, 'creds'));
}

/** Forget the stored session (the next connect shows a QR). */
async function clearSession(redis = getRedis()) {
  await redis.del(AUTH_KEY);
}

// ── Cross-instance lock ──────────────────────────────────────────────────────

const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
let renewTimer = null;
let lockHeld = false;

const RENEW_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Claim the session, waiting for another instance to let go of it (up to
 * `waitMs`). The lock expires on its own if its holder dies without releasing.
 *
 * @param {object} [opts]
 * @param {(msg: string, meta?: object) => void} [opts.log]
 * @param {() => void} [opts.onLost] called if a renewal finds the lock gone
 * @throws {Error} when it could not be claimed in time
 */
async function acquireLock({ redis = getRedis(), log = () => {}, onLost = () => {}, waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS } = {}) {
  if (lockHeld) return;
  const deadline = Date.now() + waitMs;
  let announced = false;

  for (;;) {
    const got = await redis.set(LOCK_KEY, INSTANCE_ID, 'PX', LOCK_TTL_MS, 'NX');
    if (got === 'OK') break;
    if (!announced) {
      announced = true;
      log('Baileys: another instance holds the WhatsApp session — waiting for it to let go', { waitSeconds: Math.round(waitMs / 1000) });
    }
    if (Date.now() >= deadline) {
      throw new Error('Another Rumi instance still holds the WhatsApp session lock; not connecting a second socket to the same session.');
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  lockHeld = true;
  renewTimer = setInterval(async () => {
    try {
      const renewed = await redis.eval(RENEW_SCRIPT, 1, LOCK_KEY, INSTANCE_ID, String(LOCK_TTL_MS));
      if (Number(renewed) !== 1) {
        lockHeld = false;
        clearInterval(renewTimer);
        renewTimer = null;
        log('Baileys: lost the WhatsApp session lock', {});
        onLost();
      }
    } catch (error) {
      log('Baileys: could not renew the session lock (will retry)', { error: error.message });
    }
  }, LOCK_RENEW_MS);
  if (renewTimer.unref) renewTimer.unref();
}

async function releaseLock(redis = getRedis()) {
  if (renewTimer) { clearInterval(renewTimer); renewTimer = null; }
  if (!lockHeld) return;
  lockHeld = false;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, INSTANCE_ID);
  } catch { /* it expires by itself */ }
}

function _resetLockForTests() {
  if (renewTimer) clearInterval(renewTimer);
  renewTimer = null;
  lockHeld = false;
}

module.exports = {
  AUTH_KEY,
  LOCK_KEY,
  INSTANCE_ID,
  getRedis,
  useRedisAuthState,
  hasCredentials,
  clearSession,
  acquireLock,
  releaseLock,
  _setRedisForTests,
  _resetLockForTests,
};
