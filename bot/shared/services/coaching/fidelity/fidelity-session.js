'use strict';
/**
 * Lesson-plan fidelity for one coaching session: gather its inputs, grade, and let the session's framework map the
 * measurement. Shared by the analysis job and the late-plan recompute so both grade exactly the same inputs.
 */
const { computeLpFidelity, resolveFidelitySources } = require('./fidelity-orchestrator');
const { renderLinkedPlanText } = require('./lesson-plan-text');

function log(message, detail) {
  try { require('../../../utils/logger').logToFile(message, detail); } catch (_) { /* never fails a grading */ }
}

/**
 * @param {object} session coaching_sessions row (transcript_text, audio_duration_seconds, lesson_plan_text,
 *                         lesson_plan_link_method, linked_lesson_plan_id)
 * @param {{runs?:number, renderLinkedPlanText?:Function, computeLpFidelity?:Function}} [opts]
 * @returns {Promise<object|null>} the lp_fidelity blob (graded_at stamped), or null when there is no transcript
 */
async function computeFidelityForSession(session, opts = {}) {
  const render = opts.renderLinkedPlanText || renderLinkedPlanText;
  const compute = opts.computeLpFidelity || computeLpFidelity;
  const s = session || {};

  let linkedPlanText = null;
  if (!s.lesson_plan_text && s.linked_lesson_plan_id) {
    const rendered = await render(s.linked_lesson_plan_id);
    linkedPlanText = rendered ? rendered.text : null;
  }
  const { planText, source, lessonPlanId } = resolveFidelitySources(s, { linkedPlanText });
  const result = await compute({
    planText,
    source,
    lessonPlanId,
    transcript: s.transcript_text,
    audioDurationSeconds: s.audio_duration_seconds,
    ...(opts.runs != null ? { runs: opts.runs } : {}),
  });
  if (!result) return null;
  return { ...result, graded_at: new Date().toISOString() };
}

/**
 * The optional framework hook: a framework that has an indicator for plan fidelity can map the measurement onto it
 * (`applyLpFidelity(analysis, lpFidelity) → analysis`). A framework without the hook is left as it is; the
 * measurement still travels on analysis_data.lp_fidelity and the report reads it there.
 */
function applyFrameworkFidelity(framework, analysis, lpFidelity) {
  if (!framework || typeof framework.applyLpFidelity !== 'function' || !analysis || !lpFidelity) return analysis;
  try {
    return framework.applyLpFidelity(analysis, lpFidelity) || analysis;
  } catch (e) {
    log('[lp-fidelity] framework applyLpFidelity failed — keeping the analysis as scored', { framework: framework.name, error: e.message });
    return analysis;
  }
}

module.exports = { computeFidelityForSession, applyFrameworkFidelity };
