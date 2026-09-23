/**
 * matrix-identity.js -- the short ("mtx:<digits>") vs. long
 * ("matrix:@user:server") identity FORMAT codec. See that file's header
 * comment for:
 *  - the varchar(20) column budget this exists to respect (bug: lesson plan
 *    creation failing with "value too long for type character varying(20)"),
 *  - why a Matrix phone-number username is "+"+digits (canonical, Synapse
 *    accepts it, matches WhatsApp's own shape) or "t"+digits (fallback --
 *    Synapse rejects a purely numeric localpart outright), and
 *  - why decodeIdentity() takes an OPTIONAL knownLocalpart rather than
 *    guessing between the two different Matrix accounts "+<digits>" and
 *    "t<digits>" can be. The actual memory/lookup of that knownLocalpart
 *    lives in matrix-channel.service.js (tested in matrix-channel-service.test.js
 *    and matrix-events-adapter.test.js) -- this file only covers the pure
 *    encode/decode format logic.
 */

function loadIdentity() {
  jest.resetModules();
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/messaging/matrix-identity');
}

afterEach(() => {
  jest.resetModules();
});

describe('matrix-identity -- encodeIdentity', () => {
  it('encodes a "+"+digits (canonical phone-number) localpart to the short "mtx:<digits>" form, dropping the "+"', () => {
    const identity = loadIdentity();
    expect(identity.encodeIdentity('@+15550100001:localhost')).toBe('mtx:15550100001');
  });

  it('encodes a "t"+digits (fallback phone-number) localpart the same way, dropping the "t"', () => {
    const identity = loadIdentity();
    expect(identity.encodeIdentity('@t15550100001:localhost')).toBe('mtx:15550100001');
  });

  it('accepts an uppercase "T" leading letter too', () => {
    const identity = loadIdentity();
    expect(identity.encodeIdentity('@T15550100001:localhost')).toBe('mtx:15550100001');
  });

  it('the short form is <= 20 characters for the longest possible localpart ("+"/"t" + 15 digits)', () => {
    const identity = loadIdentity();
    const fifteenDigits = '123456789012345';
    const encoded = identity.encodeIdentity(`@+${fifteenDigits}:localhost`);
    expect(encoded).toBe(`mtx:${fifteenDigits}`);
    expect(encoded.length).toBe(19); // "mtx:" (4) + 15 digits
    expect(encoded.length).toBeLessThanOrEqual(20);
  });

  it('rejects a PURELY numeric localpart (no leading "+"/"t") as a phone-number form -- Synapse itself would reject that account', () => {
    const identity = loadIdentity();
    const logToFile = jest.fn();
    // Falls through to the long form, exactly like any other non-matching localpart.
    expect(identity.encodeIdentity('@15550100001:localhost', { logToFile })).toBe('matrix:@15550100001:localhost');
  });

  it('rejects fewer than 7 digits or more than 15 digits after the "+"/"t"', () => {
    const identity = loadIdentity();
    const logToFile = jest.fn();
    expect(identity.encodeIdentity('@+123456:localhost', { logToFile })).toBe('matrix:@+123456:localhost'); // 6 digits
    expect(identity.encodeIdentity('@+1234567890123456:localhost', { logToFile })).toBe('matrix:@+1234567890123456:localhost'); // 16 digits
  });

  it('falls back to the existing long form for a non-phone-shaped localpart, and does not crash', () => {
    const identity = loadIdentity();
    const logToFile = jest.fn();
    expect(identity.encodeIdentity('@teacher:localhost', { logToFile })).toBe('matrix:@teacher:localhost');
    expect(identity.encodeIdentity('@teacher576594:localhost', { logToFile })).toBe('matrix:@teacher576594:localhost');
  });

  it('logs the non-phone-username warning exactly once per process, at info level, mentioning the 20-character limit', () => {
    const identity = loadIdentity();
    const logToFile = jest.fn();
    identity.encodeIdentity('@teacher:localhost', { logToFile });
    identity.encodeIdentity('@someone-else:localhost', { logToFile });
    expect(logToFile).toHaveBeenCalledTimes(1);
    expect(logToFile.mock.calls[0][0]).toMatch(/20-character/);
    expect(logToFile.mock.calls[0][0]).toMatch(/phone number/);
  });

  it('never truncates a long identity to fit -- returns it whole even though it may overflow the DB column', () => {
    const identity = loadIdentity();
    const longId = '@a-very-long-admin-account-name:example.org';
    expect(identity.encodeIdentity(longId, { logToFile: jest.fn() })).toBe(`matrix:${longId}`);
  });
});

describe('matrix-identity -- decodeIdentity', () => {
  it('decodes a short "mtx:<digits>" identity to the "+<digits>" convention when no knownLocalpart is given', () => {
    const identity = loadIdentity();
    expect(identity.decodeIdentity('mtx:15550100001', '@rumi:localhost')).toBe('@+15550100001:localhost');
  });

  it('decodes a short "mtx:<digits>" identity to the exact recorded "+" form when given as knownLocalpart', () => {
    const identity = loadIdentity();
    expect(identity.decodeIdentity('mtx:15550100001', '@rumi:localhost', '+15550100001')).toBe('@+15550100001:localhost');
  });

  it('decodes a short "mtx:<digits>" identity to the exact recorded "t" form when given as knownLocalpart -- never guesses "+" over a known "t" account', () => {
    const identity = loadIdentity();
    expect(identity.decodeIdentity('mtx:15550100001', '@rumi:localhost', 't15550100001')).toBe('@t15550100001:localhost');
  });

  it('decodes a long "matrix:<user_id>" identity by stripping the prefix, unaffected by any embedded colon', () => {
    const identity = loadIdentity();
    expect(identity.decodeIdentity('matrix:@teacher:example.org', '@rumi:example.org')).toBe('@teacher:example.org');
  });

  it('passes through an already-bare user id unchanged', () => {
    const identity = loadIdentity();
    expect(identity.decodeIdentity('@teacher:example.org', null)).toBe('@teacher:example.org');
  });

  it('throws a clear error decoding a short identity when the own server name is unknown -- never silently mis-routes', () => {
    const identity = loadIdentity();
    expect(() => identity.decodeIdentity('mtx:15550100001', null)).toThrow(/server name is unknown/);
    expect(() => identity.decodeIdentity('mtx:15550100001', undefined)).toThrow(/server name is unknown/);
  });
});

describe('matrix-identity -- round trip', () => {
  it('a "+"-form phone number round-trips: encode drops the "+", decode (with the knownLocalpart it produced) puts it back', () => {
    const identity = loadIdentity();
    const fullUserId = '@+15550100001:localhost';
    const wire = identity.encodeIdentity(fullUserId);
    expect(wire).toBe('mtx:15550100001');
    const decoded = identity.decodeIdentity(wire, '@rumi:localhost', '+15550100001');
    expect(decoded).toBe(fullUserId);
  });

  it('a "t"-form phone number round-trips too, given its own knownLocalpart -- proves "+" and "t" are never conflated', () => {
    const identity = loadIdentity();
    const fullUserId = '@t15550100001:localhost';
    const wire = identity.encodeIdentity(fullUserId);
    expect(wire).toBe('mtx:15550100001'); // same wire identity as the "+" form above -- lossy by design
    const decoded = identity.decodeIdentity(wire, '@rumi:localhost', 't15550100001');
    expect(decoded).toBe(fullUserId);
  });

  it('a non-phone-shaped localpart round-trips too, on the long form', () => {
    const identity = loadIdentity();
    const fullUserId = '@teacher:localhost';
    const wire = identity.encodeIdentity(fullUserId, { logToFile: jest.fn() });
    const decoded = identity.decodeIdentity(wire, '@rumi:localhost');
    expect(decoded).toBe(fullUserId);
  });
});

describe('matrix-identity -- phoneDigitsFromLocalpart / splitUserId / defaultLocalpart', () => {
  it('phoneDigitsFromLocalpart extracts digits from either form, and null for anything else', () => {
    const identity = loadIdentity();
    expect(identity.phoneDigitsFromLocalpart('+15550100001')).toBe('15550100001');
    expect(identity.phoneDigitsFromLocalpart('t15550100001')).toBe('15550100001');
    expect(identity.phoneDigitsFromLocalpart('T15550100001')).toBe('15550100001');
    expect(identity.phoneDigitsFromLocalpart('teacher')).toBeNull();
    expect(identity.phoneDigitsFromLocalpart('15550100001')).toBeNull(); // no leading +/t
  });

  it('splitUserId separates localpart and server, or returns null for a malformed id', () => {
    const identity = loadIdentity();
    expect(identity.splitUserId('@+15550100001:localhost')).toEqual({ localpart: '+15550100001', server: 'localhost' });
    expect(identity.splitUserId('not-a-user-id')).toBeNull();
  });

  it('defaultLocalpart builds the canonical "+" fallback form', () => {
    const identity = loadIdentity();
    expect(identity.defaultLocalpart('15550100001')).toBe('+15550100001');
  });
});
