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

const DEFAULT_PLAN_WAIT_SECONDS = 90;

function planWaitMs() {
  const n = Number(process.env.LP_FIDELITY_PLAN_WAIT_SECONDS);
  return (Number.isFinite(n) && n >= 0 ? n : DEFAULT_PLAN_WAIT_SECONDS) * 1000;
}

/**
 * An uploaded plan is read by a job queued at the same moment as the analysis, so the analysis can start before the
 * plan's text exists. While the upload is still being read, wait for it (polling the session) rather than grade
 * "no plan" and recover later. Returns the session with the plan's fields refreshed.
 */
async function waitForPlanText(session, pollMs) {
  const deadline = Date.now() + planWaitMs();
  let current = session;
  const supabase = require('../../../config/supabase');
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const { data } = await supabase
      .from('coaching_sessions')
      .select('lesson_plan_text, lesson_plan_link_method, lesson_plan_extraction_status, linked_lesson_plan_id')
      .eq('id', session.id)
      .maybeSingle();
    if (data) current = { ...current, ...data };
    if (!data || current.lesson_plan_extraction_status !== 'pending') break;
  }
  log('[lp-fidelity] waited for the uploaded plan', { sessionId: session.id, found: !!current.lesson_plan_text });
  return current;
}

/**
 * @param {object} session coaching_sessions row (transcript_text, audio_duration_seconds, lesson_plan_text,
 *                         lesson_plan_link_method, linked_lesson_plan_id)
 * @param {{runs?:number, deps?:object, waitForPlan?:boolean, pollMs?:number, renderLinkedPlanText?:Function,
 *          computeLpFidelity?:Function}} [opts]
 *        waitForPlan: the analysis job waits for an upload still being read (LP_FIDELITY_PLAN_WAIT_SECONDS)
 *        deps: the orchestrator's injectable collaborators (extractPlanMoves, analyzeFidelity) for tests
 * @returns {Promise<object|null>} the lp_fidelity blob (graded_at stamped), or null when there is no transcript
 */
async function computeFidelityForSession(session, opts = {}) {
  const render = opts.renderLinkedPlanText || renderLinkedPlanText;
  const compute = opts.computeLpFidelity || computeLpFidelity;
  let s = session || {};
  if (opts.waitForPlan && s.id && !s.lesson_plan_text && s.lesson_plan_extraction_status === 'pending') {
    s = await waitForPlanText(s, opts.pollMs || 3000);
  }

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
  }, opts.deps || {});
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
