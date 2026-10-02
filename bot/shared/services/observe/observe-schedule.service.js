/**
 * Observation-schedule store — the coach's "my schedule".
 *
 * Table: observation_schedules. Keyed on (leader_user_id, school_ext_id,
 * teacher_ext_id), exactly ONE 'upcoming' row per key (partial unique index);
 * scheduling again moves it. markDone retires the matching upcoming row when
 * the observation actually starts (observe-capture) and is deliberately
 * tolerant — a lifecycle miss must never block a capture.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

/**
 * The observation started — retire the matching upcoming visit. Tolerant:
 * school-missing falls back to teacher-only; no match / DB error is a no-op.
 */
async function markDone(leaderUserId, teacherExtId, schoolExtId, sessionId) {
  try {
    let q = supabase
      .from('observation_schedules')
      .update({ status: 'done', session_id: sessionId || null, updated_at: new Date().toISOString() })
      .eq('leader_user_id', leaderUserId)
      .eq('teacher_ext_id', teacherExtId)
      .eq('status', 'upcoming');
    if (schoolExtId) q = q.eq('school_ext_id', schoolExtId);
    const { error } = await q;
    if (error) {
      logToFile('observe-schedule: markDone failed (non-blocking)', { leaderUserId, teacherExtId, error: error.message });
    }
  } catch (err) {
    logToFile('observe-schedule: markDone threw (non-blocking)', { leaderUserId, teacherExtId, error: err.message });
  }
}

module.exports = { markDone };
