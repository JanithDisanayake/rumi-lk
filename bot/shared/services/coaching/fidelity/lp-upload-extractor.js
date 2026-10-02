'use strict';
/**
 * Extract the prescribed move list from a lesson plan's TEXT — whatever its source: a plan Rumi made for the teacher
 * (its stored text), an uploaded document, or text pasted into the chat. Free-form plan text → fidelity-moves-v1
 * objects, so the grader and the scorer are identical downstream. The LLM assigns the tags (there are no field paths
 * in a teacher's document); normalizeMoves clamps them. json_object mode, jsonrepair-tolerant, injectable client.
 *
 * An image-only PDF (a scanned or photographed plan) has no text layer, so there is nothing to read here: require
 * usable text and fail loudly with lp_unparseable rather than return a phantom empty list.
 *
 * Model: LP_FIDELITY_EXTRACT_MODEL, else LP_FIDELITY_MODEL, else the default grader model — one var drives both
 * unless a deployment wants a cheaper extractor.
 */
const { UPLOAD_EXTRACTION_BRIEF, buildUploadPrompt } = require('./upload-extractor-prompt');
const { canonicalPhase } = require('./fidelity-phases');

const DEFAULT_EXTRACT_MODEL = 'google/gemini-3.8-flash';
const MIN_PLAN_CHARS = 40;
const BUCKETS = new Set(['must_happen', 'adaptive_set', 'optional_extension']);
const SELECTIONS = new Set(['none', 'choose_one', 'per_group']);
const SOURCES = new Set(['linked', 'uploaded', 'pasted']);

let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* strict parse fallback */ }
function safeJsonParse(content) {
  try { return JSON.parse(content); } catch (e) {
    if (!_jsonrepair) throw e;
    return JSON.parse(_jsonrepair(content));
  }
}

function extractModel() {
  return process.env.LP_FIDELITY_EXTRACT_MODEL || process.env.LP_FIDELITY_MODEL || DEFAULT_EXTRACT_MODEL;
}

// Defensively normalise the LLM's move objects — never let a malformed tag reach the scorer.
function normalizeMoves(moves, source = 'uploaded') {
  const sourceField = SOURCES.has(source) ? source : 'uploaded';
  return (moves || []).map((m, i) => ({
    move_id: m.move_id || `m${i + 1}`,
    phase: canonicalPhase(m.phase) || 'explain',
    type: m.type || 'instruction',
    text: (m.text || '').trim(),
    source_field: sourceField,
    bucket: BUCKETS.has(m.bucket) ? m.bucket : 'must_happen',
    selection: SELECTIONS.has(m.selection) ? m.selection : 'none',
    track_time_on_task: m.track_time_on_task === true,
    prescribed_minutes: Number.isFinite(m.prescribed_minutes) ? m.prescribed_minutes : null,
    adjudicable: m.adjudicable !== false,
    observable_in_photo: m.observable_in_photo === true,
  })).filter((m) => m.text.length > 0);
}

function unparseable(message, cause) {
  const err = new Error(`lp_unparseable: ${message}`);
  err.code = 'lp_unparseable';
  if (cause) err.cause = cause;
  return err;
}

/**
 * @param {string} lpText  the plan's text (must have a real text layer)
 * @param {{lessonId?:string, source?:'linked'|'uploaded'|'pasted', client?:object, model?:string, maxTokens?:number}} opts
 * @returns {Promise<{template:'UPLOADED', goal, total_minutes, moves, usage, model}>}
 */
async function extractUploadedLp(lpText, opts = {}) {
  if (!lpText || String(lpText).trim().length < MIN_PLAN_CHARS) {
    throw unparseable('the plan has no usable text (a scanned image-PDF has no text layer)');
  }
  const model = opts.model || extractModel();
  const client = opts.client || require('../../llm-client').getClient();
  const user = buildUploadPrompt(lpText, opts.lessonId);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [{ role: 'system', content: UPLOAD_EXTRACTION_BRIEF }, { role: 'user', content: user }],
      max_completion_tokens: opts.maxTokens || 4000,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices && response.choices[0];
    try {
      const parsed = safeJsonParse((choice && choice.message && choice.message.content) || '');
      const moves = normalizeMoves(parsed.moves, opts.source);
      if (moves.length === 0) throw new Error('no moves extracted');
      return {
        template: 'UPLOADED',
        goal: parsed.goal || null,
        total_minutes: Number.isFinite(parsed.total_minutes) ? parsed.total_minutes : null,
        moves,
        usage: response.usage || {},
        model,
      };
    } catch (e) { lastErr = e; }
  }
  throw unparseable('the extractor returned no usable moves', lastErr);
}

module.exports = { extractUploadedLp, normalizeMoves, DEFAULT_EXTRACT_MODEL, MIN_PLAN_CHARS };
