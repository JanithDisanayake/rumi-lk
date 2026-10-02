'use strict';
/**
 * Optional sibling steps of /observe, loaded by name.
 *
 * The organiser (menu, binding, resume) hands off to steps that live in their
 * own modules — the debrief, the report send, the ratings form. A deployment
 * (or a branch) may not ship every step yet, and the organiser must then
 * degrade — no pending rows, no debrief row, a plain "still working" — rather
 * than crash the coach's /observe. So these are looked up here, by name, and a
 * step that is not installed returns null. Any OTHER load error (a syntax error
 * inside an installed step) still throws: a broken step must be loud.
 */

const KNOWN_STEPS = new Set(['observe-debrief.service', 'observe-send.service', 'observe-form.service']);

/** @returns {object|null} the step's module, or null when it is not installed */
function step(name) {
  if (!KNOWN_STEPS.has(name)) throw new Error(`observe-siblings: unknown step "${name}"`);
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(`./${name}`);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(name)) return null;
    throw err;
  }
}

module.exports = { step };
