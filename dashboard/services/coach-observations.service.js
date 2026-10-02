/**
 * The coach's view in the portal: "My observations".
 *
 * Resolves, for one coach (a portal user in the observe role family):
 *   upcoming    — their observation_schedules still 'upcoming', date-ordered,
 *                 flagged overdue when the date has passed
 *   waiting     — observations waiting on THEM: a form to check
 *                 (awaiting_observer_review), a debrief to do (form done,
 *                 debrief_status pending), a report to send (debrief done,
 *                 teacher_delivery not yet out)
 *   inProgress  — still being transcribed / analysed (nothing to do yet)
 *   completed   — debrief done and the report reached the teacher
 * and their teachers — the DERIVED roster (leader_schools x users.school_id,
 * the same join as bot/shared/services/observe/observe-roster.service.js) —
 * with each teacher's past observations.
 *
 * Trust firewall: every payload here is a whitelist. No score, no rating, no
 * coach-the-coach feedback (analysis_data.observer_debrief) and nothing else
 * from analysis_data except the report's delivery state ever leaves this file.
 *
 * The dashboard is deployed on its own (a service rooted at dashboard/), so it
 * cannot require the bot's modules at runtime. The coach role family is
 * therefore mirrored from bot/shared/services/observe/observe-gate.js — same
 * env var, same default — and a drift-guard test
 * (tests/observe/observe-portal-coach.service.test.js) requires both files and
 * fails if they ever disagree.
 *
 * Every function takes the supabase client as `db`, so the route can pass the
 * dashboard's client and tests can pass an in-memory fake.
 */

// Mirror of observe-gate.js DEFAULT_LEADER_ROLES (drift-guarded by test).
const DEFAULT_COACH_ROLES = Object.freeze(['coach', 'school_leader', 'supervisor', 'principal']);

// Delivery states in which the report has left the coach's hands.
const REPORT_OUT = ['sent', 'awaiting_teacher_tap', 'operator_review'];
const TERMINAL = ['cancelled', 'abandoned'];
const SESSION_LIMIT = 500;

/** The observe role family; OBSERVE_LEADER_ROLES replaces it, read at call time. */
function coachRoles() {
  const raw = process.env.OBSERVE_LEADER_ROLES;
  if (!raw || !raw.trim()) return [...DEFAULT_COACH_ROLES];
  return raw.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
}

/** @param {{role?: string|null}|null} user users row */
function isCoach(user) {
  return !!user && typeof user.role === 'string' && coachRoles().includes(user.role.trim().toLowerCase());
}

function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Which list an observation belongs in, from its status, debrief_status and
 * the report's delivery state. null = not shown (cancelled / abandoned).
 */
function stageOf(row) {
  const status = row.status;
  if (TERMINAL.includes(status)) return null;
  if (status === 'completed') return 'completed';
  if (status === 'awaiting_observer_review') return 'form';
  if (status === 'observer_review_complete') {
    if (row.debrief_status !== 'done') return 'debrief';
    const delivery = ((row.analysis_data || {}).teacher_delivery) || {};
    return REPORT_OUT.includes(delivery.status) ? 'completed' : 'report';
  }
  return 'inProgress';
}

function shapeSchedule(r, today) {
  const scheduledFor = isoDay(r.scheduled_for);
  return {
    id: r.id,
    teacherName: r.teacher_name || null,
    teacherUserId: r.teacher_ext_id || null,
    schoolName: r.school_name || null,
    scheduledFor,
    scheduledSlot: r.scheduled_slot || null,
    overdue: !!(scheduledFor && today && scheduledFor < today),
  };
}

/**
 * The coach's observations, each shaped to the whitelist and tagged with the
 * observed teacher. Identity, in order: the visit the observation was linked
 * to, the bound teacher (user_id, unless it is still the coach's own bare
 * capture), the name typed when the report was sent.
 */
async function loadObservations(db, coachId) {
  const { data: rows, error } = await db
    .from('coaching_sessions')
    .select('id, created_at, status, debrief_status, user_id, observer_user_id, analysis_data')
    .eq('observer_user_id', coachId)
    .eq('observation_type', 'leader_observation')
    .order('created_at', { ascending: false })
    .limit(SESSION_LIMIT);
  if (error) throw new Error(error.message);
  const sessions = (rows || []).filter((r) => stageOf(r) !== null);
  if (!sessions.length) return [];

  const bySession = new Map();
  const { data: linked } = await db
    .from('observation_schedules')
    .select('session_id, teacher_ext_id, teacher_name, school_name')
    .eq('leader_user_id', coachId)
    .in('session_id', sessions.map((s) => s.id));
  for (const s of linked || []) if (s.session_id && !bySession.has(s.session_id)) bySession.set(s.session_id, s);

  const boundIds = [...new Set(sessions.map((s) => s.user_id).filter((id) => id && id !== coachId))];
  const names = new Map();
  if (boundIds.length) {
    const { data: users } = await db.from('users').select('id, name, first_name').in('id', boundIds);
    for (const u of users || []) names.set(u.id, u.name || u.first_name || null);
  }

  return sessions.map((r) => {
    const sched = bySession.get(r.id) || null;
    const bound = r.user_id && r.user_id !== coachId ? r.user_id : null;
    const delivery = ((r.analysis_data || {}).teacher_delivery) || {};
    return {
      id: r.id,
      createdAt: r.created_at || null,
      stage: stageOf(r),
      teacherUserId: bound || (sched && sched.teacher_ext_id) || null,
      teacherName: (sched && sched.teacher_name) || (bound && names.get(bound)) || delivery.teacher_name || null,
      schoolName: (sched && sched.school_name) || null,
      reportStatus: delivery.status || null,
      reportSentAt: delivery.sent_at || null,
    };
  });
}

/**
 * @param {object} db supabase client
 * @param {string} coachId portal session user id
 * @param {{today?: string}} [opts] today as YYYY-MM-DD (defaults to now, UTC)
 */
async function getCoachObservations(db, coachId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const empty = { upcoming: [], waiting: { form: [], debrief: [], report: [] }, inProgress: [], completed: [] };
  try {
    const [{ data: schedules, error }, observations] = await Promise.all([
      db.from('observation_schedules')
        .select('id, teacher_ext_id, teacher_name, school_name, scheduled_for, scheduled_slot, created_at')
        .eq('leader_user_id', coachId)
        .eq('status', 'upcoming')
        .order('scheduled_for', { ascending: true })
        .order('created_at', { ascending: true }),
      loadObservations(db, coachId),
    ]);
    if (error) throw new Error(error.message);
    const pick = (stage) => observations.filter((o) => o.stage === stage);
    return {
      upcoming: (schedules || []).map((r) => shapeSchedule(r, today)),
      waiting: { form: pick('form'), debrief: pick('debrief'), report: pick('report') },
      inProgress: pick('inProgress'),
      completed: pick('completed'),
    };
  } catch (err) {
    // The page must render even when this cannot — degrade, never throw.
    console.error('coach-observations: resolver failed:', err.message);
    return empty;
  }
}

/** The derived roster: users in the coach's schools, minus fellow coaches. */
async function loadRoster(db, coachId) {
  const { data: schools, error } = await db
    .from('leader_schools')
    .select('school_id, school_name')
    .eq('leader_user_id', coachId);
  if (error) throw new Error(error.message);
  const bySchool = new Map((schools || []).filter((s) => s.school_id).map((s) => [s.school_id, s.school_name]));
  if (!bySchool.size) return [];
  const { data: users, error: uErr } = await db
    .from('users')
    .select('id, name, first_name, school_id, role')
    .in('school_id', [...bySchool.keys()]);
  if (uErr) throw new Error(uErr.message);
  return (users || [])
    .filter((u) => u.id !== coachId && !isCoach(u))
    .map((u) => ({ id: u.id, name: u.name || u.first_name || 'Teacher', schoolName: bySchool.get(u.school_id) || null }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function summarise(teacher, observations) {
  const mine = observations.filter((o) => o.teacherUserId === teacher.id);
  return {
    ...teacher,
    observationCount: mine.length,
    lastObservedAt: mine.length ? mine[0].createdAt : null,
  };
}

/** @returns {Promise<Array<{id, name, schoolName, observationCount, lastObservedAt}>>} */
async function listCoachTeachers(db, coachId) {
  const roster = await loadRoster(db, coachId);
  if (!roster.length) return [];
  const observations = await loadObservations(db, coachId);
  return roster.map((t) => summarise(t, observations));
}

/**
 * One teacher and the observations this coach made of them — null unless the
 * teacher is on this coach's roster, so a coach cannot read another's teachers.
 */
async function getCoachTeacher(db, coachId, teacherId) {
  const roster = await loadRoster(db, coachId);
  const teacher = roster.find((t) => t.id === teacherId);
  if (!teacher) return null;
  const observations = (await loadObservations(db, coachId)).filter((o) => o.teacherUserId === teacherId);
  return { teacher, observations };
}

module.exports = {
  DEFAULT_COACH_ROLES,
  coachRoles,
  isCoach,
  stageOf,
  getCoachObservations,
  listCoachTeachers,
  getCoachTeacher,
};
