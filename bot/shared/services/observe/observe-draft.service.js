/**
 * Leader-observation draft lifecycle — the AI does the first pass, the coach
 * owns the final judgement.
 *
 * onAnalysisReady   : freeze v1 (autofill_analysis_data) exactly once, move to
 *                     review, arm awaiting_form, send the COACH the pre-filled
 *                     ratings — the editable WhatsApp Flow on Meta when one is
 *                     published (OBSERVE_FORM_FLOW_ID), the stepwise chat form
 *                     everywhere else and whenever the Flow can't be sent.
 * buildScreenPrefill: analysis_data → one domain screen's ${data.*} bindings
 *                     (the Meta Flow).
 * applyObserverEdits: merge the coach's edits into analysis_data (v2),
 *                     re-run the pack's scorer, stamp observer_edit_summary
 *                     (the v1→v2 diff is the record of what the coach changed).
 *
 * Observe-ness is derived from the SESSION ROW (observation_type), never from
 * a queue payload — a lost payload field must not change what a row is.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const ObserveState = require('./observe-state.service');
const { t } = require('./observe-strings');
const { languageFor } = require('./observe-language');
const { getObservePack, scaleBounds } = require('./observe-framework');
const { TERMINAL_IN_FILTER, isTerminalStatus } = require('./observe-terminal');
const { resolveChannelDriver } = require('../../config/feature-availability');
const { logToFile } = require('../../utils/logger');

const {
  applyObserverEdits, clipWords, evidenceOf, improvementOf, fid, PREFILL_TEXT_CAP,
} = require('./observe-edits.service');

async function loadSession(sessionId) {
  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    throw new Error(`observe: session ${sessionId} not found (${error && error.message})`);
  }
  return session;
}

/**
 * The coach's channel identity, from the SESSION ROW — never the job's `from`,
 * which can be whoever happened to trigger this pipeline stage (once, the
 * observed teacher, which put the coach's form in the teacher's chat).
 */
async function observerIdentity(session, fallback) {
  const observerId = session.observer_user_id || session.user_id;
  const { data } = await supabase.from('users').select('phone_number').eq('id', observerId).maybeSingle();
  if (data && data.phone_number) return data.phone_number;
  logToFile('⚠️ observe: observer identity not found — draft falls back to the job `from`', { sessionId: session.id, observerId });
  return fallback;
}

/**
 * A Meta Flow can only go to a bare WhatsApp number on the Meta driver. Any
 * prefixed identity ("slack:…", "mtx:…", "matrix:…") belongs to another
 * channel — checked by shape, not by the registry's prefix list, so a channel
 * this build has never heard of still gets the chat form, never a Flow.
 */
function canReceiveMetaFlow(identity) {
  return /^\+?\d{6,20}$/.test(String(identity || '')) && resolveChannelDriver(process.env) === 'meta';
}

/**
 * Analysis finished for a leader observation: freeze v1 once, move to review,
 * arm the coach's form state, send the form.
 */
async function onAnalysisReady(sessionId, from) {
  const session = await loadSession(sessionId);
  const observerId = session.observer_user_id || session.user_id;
  // The form is read by the OBSERVER; the bound teacher's language is not the reader's.
  const lang = await languageFor('coach', session);

  // The analysis job outlives a cancel: it was queued before it and lands after.
  if (isTerminalStatus(session.status)) {
    logToFile('🚫 observe: analysis ready but the observation is over — not re-armed', { sessionId, status: session.status });
    return;
  }

  // The predicate closes the window the read above cannot: a cancel that lands
  // between the two must not be overwritten by a job that was already running.
  const { data: armed, error: upErr } = await supabase.from('coaching_sessions')
    .update({
      status: 'awaiting_observer_review',
      debrief_status: session.debrief_status || 'pending',
      // freeze v1 exactly once
      ...(session.autofill_analysis_data ? {} : { autofill_analysis_data: session.analysis_data }),
    })
    .eq('id', sessionId)
    .not('status', 'in', TERMINAL_IN_FILTER)
    .select('id');
  if (upErr) logToFile('⚠️ observe: failed to persist review status/freeze', { sessionId, error: upErr.message });
  // Refuse ONLY on an explicit "no rows matched"; an ambiguous write result
  // must not cost a coach their form.
  if (!upErr && Array.isArray(armed) && armed.length === 0) {
    logToFile('🚫 observe: observation went terminal while the analysis ran — not re-armed', { sessionId });
    return;
  }

  const recipient = await observerIdentity(session, from);

  const flowId = process.env.OBSERVE_FORM_FLOW_ID || '';
  if (flowId && canReceiveMetaFlow(recipient)) {
    const sent = await WhatsAppService.sendFlow(recipient, {
      flowId,
      flowToken: `${observerId}:${sessionId}`,   // the endpoint derives identity from this
      header: t(lang, 'flow_header'),
      body: t(lang, 'flow_body'),
      buttonText: t(lang, 'flow_button'),
    });
    if (sent) {
      await armFormState(observerId, sessionId, { via: 'flow' });
      logToFile('🔭 observe: pre-filled form Flow sent', { sessionId, observerId });
      return;
    }
    logToFile('⚠️ observe: form Flow not sent — falling back to the chat form', { sessionId });
  }

  // Everywhere else (and as the Meta fallback): the stepwise chat form.
  const ObserveForm = require('./observe-form.service');
  await ObserveForm.start({ id: observerId }, recipient, sessionId, { lang });
}

/**
 * Never clobber a live debrief-recording state: the coach may be mid-debrief
 * for ANOTHER observation when this analysis lands. The form itself does not
 * depend on the state (a pending-list tap reopens it).
 */
async function armFormState(observerId, sessionId, extra = {}) {
  const current = await ObserveState.getState(observerId);
  if (current && current.state === 'awaiting_debrief_audio') {
    logToFile('🔭 observe: analysis ready but observer is mid-debrief — state left armed', {
      sessionId, debriefSessionId: current.sessionId,
    });
    return false;
  }
  await ObserveState.setState(observerId, 'awaiting_form', { sessionId, ...extra });
  return true;
}

/**
 * @param {object} analysis  domains-shaped analysis_data
 * @param {string} domainKey
 * @returns {object} ${data.*} bindings for that domain's Flow screen
 */
function buildScreenPrefill(analysis, domainKey) {
  const pack = getObservePack();
  const spec = pack.domains[domainKey];
  const stored = ((analysis || {}).domains || {})[domainKey] || {};
  const byId = {};
  (stored.indicators || []).forEach((ind) => { byId[String(ind.id)] = ind; });
  const { min, max } = scaleBounds(pack);

  // The published Flow binds its rating options to ${data.scale}, so the labels
  // follow the pack and can never disagree with the clamp.
  const data = { scale: pack.scaleOptions };
  spec.indicators.forEach((specInd) => {
    const f = fid(specInd.id);
    const ind = byId[String(specInd.id)] || {};
    const raw = Number(ind.score);
    const score = Number.isFinite(raw) && ind.score !== null && ind.score !== undefined ? Math.max(min, Math.min(max, raw)) : min;
    data[`s_${f}`] = String(score);
    data[`e_${f}`] = clipWords(evidenceOf(ind), PREFILL_TEXT_CAP);
    data[`i_${f}`] = clipWords(improvementOf(ind), PREFILL_TEXT_CAP);
  });
  return data;
}

module.exports = {
  onAnalysisReady, buildScreenPrefill, applyObserverEdits, armFormState, clipWords, evidenceOf, improvementOf, fid,
  PREFILL_TEXT_CAP,
};
