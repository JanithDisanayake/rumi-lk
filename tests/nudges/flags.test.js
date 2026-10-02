'use strict';
/**
 * flags.js — ONE reading of "on" for every teacher-nudge switch. The sweeper's
 * per-tick check and the worker's boot-time check must agree, or a flag ends up
 * armed at boot and ignored per tick.
 */

const { flagOn } = require('../../bot/shared/services/nudges/flags');

const ENV_KEYS = ['TEACHER_NUDGES_TEST_FLAG'];
const saved = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('flagOn — one reading of "on"', () => {
  it.each(['true', 'TRUE', ' 1 ', 'yes', 'Yes'])('%j is on', (v) => {
    process.env.TEACHER_NUDGES_TEST_FLAG = v;
    expect(flagOn('TEACHER_NUDGES_TEST_FLAG')).toBe(true);
  });

  it.each([undefined, '', 'false', '0', 'no', 'off', 'enabled', 'on'])('%j is off', (v) => {
    if (v !== undefined) process.env.TEACHER_NUDGES_TEST_FLAG = v;
    expect(flagOn('TEACHER_NUDGES_TEST_FLAG')).toBe(false);
  });

  it('is read at call time, never cached', () => {
    expect(flagOn('TEACHER_NUDGES_TEST_FLAG')).toBe(false);
    process.env.TEACHER_NUDGES_TEST_FLAG = 'true';
    expect(flagOn('TEACHER_NUDGES_TEST_FLAG')).toBe(true);
  });
});
