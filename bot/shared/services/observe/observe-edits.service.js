/**
 * Merge a coach's rating edits into the observation (v2) — the one write both
 * edit surfaces share: the stepwise chat form (observe-form.service) and the
 * Meta form Flow's endpoint. v1 (autofill_analysis_data) is never touched.
 *
 * Also the field helpers both surfaces need to address an indicator and show
 * its evidence the same way.
 */

const supabase = require('../../config/supabase');
const { getObservePack, scaleBounds } = require('./observe-framework');
const { TERMINAL_IN_FILTER } = require('./observe-terminal');
const { logToFile } = require('../../utils/logger');

// The full text stays in analysis_data regardless of what a form shows. 600 is
// the Flow TextArea's own allowance — the evidence is the whole point of the
// review step, and a coach can't judge a rating from a truncated quote.
const PREFILL_TEXT_CAP = 600;

// Indicator ids are numbers in some rubrics (7) and dotted strings in others
// ("A1.2"); form field names need neither dots nor a number type.
const fid = (id) => String(id).replace(/\./g, '_');

// Word-boundary clip: never cuts mid-word (a mid-word cut reads as a bug).
function clipWords(s, n) {
  const a = [...String(s == null ? '' : s)];
  if (a.length <= n) return a.join('');
  const cut = a.slice(0, n - 1).join('');
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:·]+$/, '')}…`;
}

/** Evidence / improvement text, whichever key the rubric's prompt filled. */
const evidenceOf = (ind) => String(ind.evidence_summary || ind.evidence || ind.evidence_sw || '');
const improvementOf = (ind) => String(ind.improvement || ind.improvement_sw || '');

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
 * Merge the coach's edits (r_<id> rating, ev_<id> evidence, imp_<id>
 * improvement) into a v2 analysis, recompute scores, stamp the summary,
 * persist. v1 (autofill_analysis_data) is never touched here.
 *
 * @returns {Promise<object>} the summary, or { refused: 'terminal' }
 */
async function applyObserverEdits(sessionId, edits) {
  const session = await loadSession(sessionId);
  const v1 = session.autofill_analysis_data || session.analysis_data;
  const v2 = JSON.parse(JSON.stringify(session.analysis_data || {}));
  const pack = getObservePack();
  const { min, max } = scaleBounds(pack);

  let rescored = 0;
  let textChanged = 0;
  const v1ById = {};
  Object.values((v1 || {}).domains || {}).forEach((d) => (d.indicators || []).forEach((ind) => { v1ById[String(ind.id)] = ind; }));

  Object.values(v2.domains || {}).forEach((d) => {
    (d.indicators || []).forEach((ind) => {
      const f = fid(ind.id);
      const orig = v1ById[String(ind.id)] || {};
      const r = edits[`r_${f}`];
      if (r !== undefined && r !== null && r !== '') {
        const parsed = parseInt(r, 10);
        const newScore = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : min));
        if (newScore !== Number(orig.score)) rescored += 1;
        ind.score = newScore;
      }
      for (const [prefix, field, read] of [['ev_', 'evidence', evidenceOf], ['imp_', 'improvement', improvementOf]]) {
        const val = edits[`${prefix}${f}`];
        if (typeof val === 'string') {
          const origText = read(orig);
          if (val !== origText.slice(0, PREFILL_TEXT_CAP) && val !== origText) {
            textChanged += 1;
            ind[field] = val;
          }
        }
      }
    });
  });

  pack.computeScores(v2);

  const summary = { indicators_rescored: rescored, text_fields_changed: textChanged, edited_at: new Date().toISOString() };
  v2.observer_edit_summary = summary;

  // A wholesale analysis_data write from a read at entry — re-read the debrief
  // at write time so a resubmission can't drop what the worker merged meanwhile.
  const { data: freshRow } = await supabase.from('coaching_sessions').select('analysis_data').eq('id', sessionId).single();
  const freshDebrief = freshRow && freshRow.analysis_data && freshRow.analysis_data.observer_debrief;
  if (freshDebrief) v2.observer_debrief = freshDebrief;

  // Both guards are needed — the read stops the common case, the predicate the race.
  const { data: written, error } = await supabase.from('coaching_sessions')
    .update({ analysis_data: v2, status: 'observer_review_complete' })
    .eq('id', sessionId)
    .not('status', 'in', TERMINAL_IN_FILTER)
    .select('id');
  if (error) throw new Error(`observe: failed to persist v2 edits: ${error.message}`);
  if (!written || !written.length) {
    // The observation went terminal under us. Say so rather than reporting a
    // successful edit — a caller that believes this succeeded would go on to
    // send the teacher a report that was cancelled.
    logToFile('🚫 observe: observer edits refused — observation is terminal', { sessionId });
    return { refused: 'terminal' };
  }

  logToFile('📝 observe: observer edits applied (v2)', { sessionId, ...summary });
  return summary;
}

module.exports = {
  applyObserverEdits, clipWords, evidenceOf, improvementOf, fid, PREFILL_TEXT_CAP,
};
