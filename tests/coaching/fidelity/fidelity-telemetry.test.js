'use strict';
/**
 * The grading leaves telemetry on the blob (every run's percentage, the spread, the recording facts, the failure
 * cause) for audits. The teacher's voice note serialises the analysis into a prompt, so none of that may reach it:
 * a run's percentage beside the band would be quotable as "your score".
 */
const { stripFidelityTelemetry } = require('../../../bot/shared/services/coaching/fidelity/fidelity-telemetry');

describe('fidelity-telemetry · stripFidelityTelemetry', () => {
  const graded = () => ({
    framework: 'oecd',
    lp_fidelity: {
      status: 'ok', fidelity_pct: 66.7, band: 'partial',
      runs: [{ pct: 66.7, model: 'm' }, { pct: 75, model: 'm' }], runs_requested: 3, spread: 8.3,
      recording: { stamps: 40 }, missing_verdicts: 0, cause: null, reasoning_effort: null, empty_retry: false,
      moves: [{ move_id: 'm1', verdict: 'executed' }],
    },
  });

  test('removes every telemetry key and keeps what a person may hear', () => {
    const out = stripFidelityTelemetry(graded());
    expect(Object.keys(out.lp_fidelity).sort()).toEqual(['band', 'fidelity_pct', 'moves', 'status']);
    expect(out.lp_fidelity.moves).toEqual([{ move_id: 'm1', verdict: 'executed' }]);
    expect(out.framework).toBe('oecd');
  });

  test('never mutates its input', () => {
    const input = graded();
    stripFidelityTelemetry(input);
    expect(input.lp_fidelity.runs).toHaveLength(2);
    expect(input.lp_fidelity.spread).toBe(8.3);
  });

  test('an analysis with nothing to strip comes back as the same object', () => {
    const plain = { framework: 'oecd', lp_fidelity: { status: 'lp_absent' } };
    expect(stripFidelityTelemetry(plain)).toBe(plain);
    const none = { framework: 'oecd' };
    expect(stripFidelityTelemetry(none)).toBe(none);
  });

  test('non-objects pass through', () => {
    for (const x of [null, undefined, 'x', 3]) expect(stripFidelityTelemetry(x)).toBe(x);
  });
});
