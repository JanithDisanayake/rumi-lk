'use strict';
/**
 * Telemetry the grading leaves on an analysis — for audits — which must never reach a prompt that speaks to a
 * person. The teacher's voice note serialises the analysis into its prompt, so a run's percentage beside the band,
 * the spread or a failure cause would all be quotable.
 */
const LP_FIDELITY_KEYS = ['runs', 'runs_requested', 'spread', 'recording', 'missing_verdicts', 'cause', 'reasoning_effort', 'empty_retry'];

const hasAny = (obj, keys) => !!obj && typeof obj === 'object' && keys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));

function without(obj, keys) {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * @param {object} analysis analysis_data
 * @returns {object} the same object when there is nothing to strip, otherwise a copy without the telemetry (the input is
 *                   never mutated)
 */
function stripFidelityTelemetry(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const lp = analysis.lp_fidelity;
  if (!hasAny(lp, LP_FIDELITY_KEYS)) return analysis;
  return { ...analysis, lp_fidelity: without(lp, LP_FIDELITY_KEYS) };
}

module.exports = { stripFidelityTelemetry };
