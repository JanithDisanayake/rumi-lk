/**
 * The coach's view in the portal ("My observations"), resolved server-side.
 *
 * A coach sees their upcoming and overdue visits, the observations waiting on
 * them (a form to check, a debrief to do, a report to send), the finished ones,
 * and their DERIVED roster (leader_schools x users.school_id) with each
 * teacher's past observations. The payload is a whitelist: no score, no
 * coach-the-coach feedback, nothing from analysis_data but the delivery state.
 */

const { createFakeSupabase } = require('./_helpers/fake-supabase');

const TODAY = '2026-03-10';

function seed() {
  return createFakeSupabase({
    users: [
      { id: 'coach-1', role: 'coach', name: 'Robin Coach', phone_number: '15550100001' },
      { id: 't-1', name: 'Sam Taylor', phone_number: '15550100002', school_id: 'sch-1' },
      { id: 't-2', name: 'Alex Kim', phone_number: '15550100003', school_id: 'sch-1' },
      { id: 't-3', name: 'Jo Park', phone_number: '15550100004', school_id: 'sch-2' },
      { id: 't-9', name: 'Outside Teacher', phone_number: '15550100009', school_id: 'sch-3' },
      { id: 'coach-2', role: 'Supervisor', name: 'Other Coach', phone_number: '15550100005', school_id: 'sch-1' },
    ],
    leader_schools: [
      { id: 'ls-1', leader_user_id: 'coach-1', school_id: 'sch-1', school_ext_id: 'S-001', school_name: 'Hillside Primary' },
      { id: 'ls-2', leader_user_id: 'coach-1', school_id: 'sch-2', school_ext_id: 'S-002', school_name: 'Riverside Primary' },
      { id: 'ls-3', leader_user_id: 'coach-2', school_id: 'sch-3', school_ext_id: 'S-003', school_name: 'Lakeside Primary' },
    ],
    observation_schedules: [
      { id: 'sc-1', leader_user_id: 'coach-1', teacher_ext_id: 't-2', teacher_name: 'Alex Kim', school_name: 'Hillside Primary', school_ext_id: 'S-001', scheduled_for: '2026-03-12', scheduled_slot: 'morning', status: 'upcoming', created_at: '2026-03-01T00:00:00Z' },
      { id: 'sc-2', leader_user_id: 'coach-1', teacher_ext_id: 't-3', teacher_name: 'Jo Park', school_name: 'Riverside Primary', school_ext_id: 'S-002', scheduled_for: '2026-03-05', status: 'upcoming', created_at: '2026-03-01T00:00:00Z' },
      { id: 'sc-3', leader_user_id: 'coach-1', teacher_ext_id: 't-1', teacher_name: 'Sam Taylor', scheduled_for: '2026-03-01', status: 'cancelled', created_at: '2026-02-01T00:00:00Z' },
      { id: 'sc-4', leader_user_id: 'coach-2', teacher_ext_id: 't-9', teacher_name: 'Outside Teacher', scheduled_for: '2026-03-11', status: 'upcoming', created_at: '2026-03-01T00:00:00Z' },
      // A coach-owned capture whose teacher was named through a schedule.
      { id: 'sc-5', leader_user_id: 'coach-1', teacher_ext_id: 't-3', teacher_name: 'Jo Park', school_name: 'Riverside Primary', scheduled_for: '2026-02-20', status: 'done', session_id: 'cs-sched', created_at: '2026-02-01T00:00:00Z' },
    ],
    coaching_sessions: [
      { id: 'cs-form', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-1', status: 'awaiting_observer_review', debrief_status: 'pending', created_at: '2026-03-09T09:00:00Z', analysis_data: { scores: { percentage: 71 } } },
      { id: 'cs-debrief', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-1', status: 'observer_review_complete', debrief_status: 'pending', created_at: '2026-03-08T09:00:00Z', analysis_data: { scores: { percentage: 64 } } },
      { id: 'cs-report', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-2', status: 'observer_review_complete', debrief_status: 'done', created_at: '2026-03-07T09:00:00Z',
        analysis_data: { scores: { percentage: 80 }, observer_debrief: { feedback: 'You talked over the teacher twice.', score: 3 }, teacher_delivery: { status: 'failed', teacher_name: 'Alex Kim' } } },
      { id: 'cs-sent', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-2', status: 'observer_review_complete', debrief_status: 'done', created_at: '2026-03-06T09:00:00Z',
        analysis_data: { observer_debrief: { feedback: 'Private note for the coach.' }, teacher_delivery: { status: 'sent', teacher_name: 'Alex Kim', sent_at: '2026-03-06T12:00:00Z' } } },
      { id: 'cs-done', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-1', status: 'completed', debrief_status: 'done', created_at: '2026-02-28T09:00:00Z',
        analysis_data: { scores: { percentage: 90 }, teacher_delivery: { status: 'sent', sent_at: '2026-02-28T12:00:00Z' } } },
      { id: 'cs-sched', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'coach-1', status: 'completed', debrief_status: 'done', created_at: '2026-02-20T09:00:00Z', analysis_data: { teacher_delivery: { status: 'sent' } } },
      { id: 'cs-busy', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'coach-1', status: 'analyzing', debrief_status: 'pending', created_at: '2026-03-10T08:00:00Z' },
      { id: 'cs-cancel', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-1', status: 'cancelled', created_at: '2026-03-05T09:00:00Z' },
      { id: 'cs-other', observation_type: 'leader_observation', observer_user_id: 'coach-2', user_id: 't-9', status: 'completed', debrief_status: 'done', created_at: '2026-03-05T09:00:00Z' },
      { id: 'cs-own', observation_type: null, user_id: 'coach-1', status: 'completed', created_at: '2026-03-04T09:00:00Z' },
    ],
  });
}

const Coach = require('../../dashboard/services/coach-observations.service');
const Gate = require('../../bot/shared/services/observe/observe-gate');

const ids = (list) => list.map((o) => o.id);

// The client, with every query on the named tables answering a PostgREST error.
function failingTables(mockDb, names) {
  const failing = () => {
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve) => resolve({ data: null, error: { message: 'column coaching_sessions.observation_type does not exist' } });
        }
        return () => q;
      },
    });
    return q;
  };
  return { ...mockDb.client, from: (name) => (names.includes(name) ? failing() : mockDb.client.from(name)) };
}

const ended = (status, delivery) => ({ status, debrief_status: 'done', analysis_data: { teacher_delivery: delivery } });

describe('stageOf: completed means the teacher has the report', () => {
  test('only a sent report is completed', () => {
    expect(Coach.stageOf(ended('observer_review_complete', { status: 'sent' }))).toBe('completed');
    expect(Coach.stageOf(ended('completed', { status: 'sent' }))).toBe('completed');
  });

  test('an invite the teacher has not tapped yet is waiting on the teacher, not done', () => {
    expect(Coach.stageOf(ended('observer_review_complete', { status: 'awaiting_teacher_tap', template_sent_at: '2026-03-04T00:00:00Z' })))
      .toBe('awaitingTeacher');
  });

  test('an invite the sweep gave up on goes back to "send the report"', () => {
    expect(Coach.stageOf(ended('observer_review_complete', { status: 'awaiting_teacher_tap', gave_up_at: '2026-03-04T00:00:00Z' })))
      .toBe('report');
  });

  test('a report routed to the review team is with them, not done', () => {
    expect(Coach.stageOf(ended('observer_review_complete', { status: 'operator_review' }))).toBe('withReview');
  });

  test('a failed or missing delivery is still the coach\'s to send', () => {
    expect(Coach.stageOf(ended('observer_review_complete', { status: 'failed' }))).toBe('report');
    expect(Coach.stageOf({ status: 'observer_review_complete', debrief_status: 'done' })).toBe('report');
  });
});

describe('coach role family', () => {
  afterEach(() => { delete process.env.OBSERVE_LEADER_ROLES; });

  test('mirrors the bot gate exactly, default and env-overridden (drift guard)', () => {
    expect(Coach.coachRoles()).toEqual(Gate.leaderRoles());
    process.env.OBSERVE_LEADER_ROLES = ' Mentor , head_teacher ';
    expect(Coach.coachRoles()).toEqual(Gate.leaderRoles());
    for (const role of ['mentor', 'HEAD_TEACHER', 'coach', null, '', 'teacher']) {
      expect(Coach.isCoach({ role })).toBe(Gate.isSchoolLeader({ role }));
    }
  });

  test('the on/off switch mirrors the bot gate, console pause included (drift guard)', () => {
    const overrides = require('../../bot/shared/config/feature-overrides');
    const saved = { e: process.env.OBSERVE_ENABLED, f: process.env.RUMI_FEATURE_OBSERVE };
    try {
      for (const enabled of [undefined, '', 'true', ' TRUE ', '1', 'yes', 'false']) {
        for (const paused of [undefined, 'off', 'OFF', 'on']) {
          if (enabled === undefined) delete process.env.OBSERVE_ENABLED; else process.env.OBSERVE_ENABLED = enabled;
          if (paused === undefined) delete process.env.RUMI_FEATURE_OBSERVE; else process.env.RUMI_FEATURE_OBSERVE = paused;
          overrides.load(process.env);
          expect([enabled, paused, Coach.isObserveEnabled()]).toEqual([enabled, paused, Gate.isObserveEnabled()]);
          expect(Coach.canUseCoachView({ role: 'coach' })).toBe(Gate.isObserveEnabled());
        }
      }
    } finally {
      if (saved.e === undefined) delete process.env.OBSERVE_ENABLED; else process.env.OBSERVE_ENABLED = saved.e;
      if (saved.f === undefined) delete process.env.RUMI_FEATURE_OBSERVE; else process.env.RUMI_FEATURE_OBSERVE = saved.f;
      overrides.load(process.env);
    }
    expect(Coach.canUseCoachView({ role: 'teacher' })).toBe(false);
  });

  test('teachers and missing users are not coaches', () => {
    expect(Coach.isCoach(null)).toBe(false);
    expect(Coach.isCoach({ role: null })).toBe(false);
    expect(Coach.isCoach({ role: ' Coach ' })).toBe(true);
  });
});

describe('getCoachObservations', () => {
  test('upcoming visits are date-ordered, overdue-flagged, and only this coach\'s', async () => {
    const mockDb = seed();
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    expect(ids(out.upcoming)).toEqual(['sc-2', 'sc-1']);
    expect(out.upcoming[0]).toMatchObject({ teacherName: 'Jo Park', schoolName: 'Riverside Primary', scheduledFor: '2026-03-05', overdue: true });
    expect(out.upcoming[1]).toMatchObject({ teacherName: 'Alex Kim', scheduledSlot: 'morning', overdue: false });
  });

  test('sorts each observation into what is waiting on the coach', async () => {
    const mockDb = seed();
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    expect(ids(out.waiting.form)).toEqual(['cs-form']);
    expect(ids(out.waiting.debrief)).toEqual(['cs-debrief']);
    expect(ids(out.waiting.report)).toEqual(['cs-report']);
    expect(ids(out.inProgress)).toEqual(['cs-busy']);
    expect(ids(out.completed)).toEqual(['cs-sent', 'cs-done', 'cs-sched']);
  });

  test('a report on its way (invite untapped, with the review team) is neither waiting on the coach nor completed', async () => {
    const mockDb = seed();
    const row = (id, delivery) => ({ id, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 't-1', status: 'observer_review_complete', debrief_status: 'done', created_at: '2026-03-03T09:00:00Z', analysis_data: { teacher_delivery: delivery } });
    mockDb.tables.coaching_sessions.push(
      row('cs-tap', { status: 'awaiting_teacher_tap', template_sent_at: '2026-03-03T10:00:00Z' }),
      row('cs-gaveup', { status: 'awaiting_teacher_tap', template_sent_at: '2026-03-01T10:00:00Z', gave_up_at: '2026-03-04T00:00:00Z' }),
      row('cs-review', { status: 'operator_review' }),
    );
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    expect(ids(out.delivering)).toEqual(['cs-tap', 'cs-review']);
    expect(out.delivering.map((o) => o.stage)).toEqual(['awaitingTeacher', 'withReview']);
    expect(ids(out.waiting.report)).toEqual(['cs-report', 'cs-gaveup']);
    expect(ids(out.completed)).not.toEqual(expect.arrayContaining(['cs-tap']));
    expect(ids(out.completed)).not.toContain('cs-review');
    expect(ids(out.completed)).not.toContain('cs-gaveup');
  });

  test('never lists cancelled observations, other coaches\' work, or the coach\'s own lessons', async () => {
    const mockDb = seed();
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    const all = [...out.waiting.form, ...out.waiting.debrief, ...out.waiting.report, ...out.inProgress, ...out.completed];
    expect(ids(all)).not.toEqual(expect.arrayContaining(['cs-cancel']));
    expect(ids(all)).not.toContain('cs-other');
    expect(ids(all)).not.toContain('cs-own');
  });

  test('names the observed teacher from the linked visit, and never as the coach', async () => {
    const mockDb = seed();
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    const sched = out.completed.find((o) => o.id === 'cs-sched');
    expect(sched).toMatchObject({ teacherName: 'Jo Park', teacherUserId: 't-3', schoolName: 'Riverside Primary' });
    const busy = out.inProgress[0];
    expect(busy.teacherName).toBeNull();
    expect(busy.teacherUserId).toBeNull();
    expect(out.waiting.form[0]).toMatchObject({ teacherName: 'Sam Taylor', teacherUserId: 't-1' });
    expect(out.completed.find((o) => o.id === 'cs-sent')).toMatchObject({ reportStatus: 'sent', reportSentAt: '2026-03-06T12:00:00Z' });
  });

  test('the payload carries no score and no coach-the-coach feedback', async () => {
    const mockDb = seed();
    const out = await Coach.getCoachObservations(mockDb.client, 'coach-1', { today: TODAY });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/talked over|Private note|observer_debrief|analysis_data|percentage|score/i);
  });

  test('a database failure rejects instead of passing for "nothing waiting"', async () => {
    // An empty answer would tell the coach they are up to date when they may
    // have forms, debriefs and reports pending (e.g. the dashboard deployed
    // before its migration). The route turns the rejection into a 500.
    const failing = failingTables(seed(), ['coaching_sessions']);
    await expect(Coach.getCoachObservations(failing, 'coach-1', { today: TODAY })).rejects.toThrow(/does not exist/);
    const failingSchedules = failingTables(seed(), ['observation_schedules']);
    await expect(Coach.getCoachObservations(failingSchedules, 'coach-1', { today: TODAY })).rejects.toThrow(/does not exist/);
  });
});

describe('roster', () => {
  test('lists the derived roster with each teacher\'s observation count and last visit', async () => {
    const mockDb = seed();
    const teachers = await Coach.listCoachTeachers(mockDb.client, 'coach-1');
    expect(teachers.map((t) => t.id)).toEqual(['t-2', 't-3', 't-1']);
    expect(teachers.find((t) => t.id === 't-1')).toEqual({
      id: 't-1', name: 'Sam Taylor', schoolName: 'Hillside Primary', observationCount: 3, lastObservedAt: '2026-03-09T09:00:00Z',
    });
    expect(teachers.find((t) => t.id === 't-3')).toMatchObject({ observationCount: 1, lastObservedAt: '2026-02-20T09:00:00Z' });
    // A colleague coach at the same school is not a teacher to observe; no phone numbers leave the server.
    expect(JSON.stringify(teachers)).not.toMatch(/coach-2|1555/);
  });

  test('a coach with no schools has no teachers', async () => {
    const mockDb = seed();
    expect(await Coach.listCoachTeachers(mockDb.client, 't-1')).toEqual([]);
  });

  test('one teacher\'s past observations, only when that teacher is on the coach\'s roster', async () => {
    const mockDb = seed();
    const detail = await Coach.getCoachTeacher(mockDb.client, 'coach-1', 't-1');
    expect(detail.teacher).toMatchObject({ id: 't-1', name: 'Sam Taylor', schoolName: 'Hillside Primary' });
    expect(detail.observations.map((o) => [o.id, o.stage])).toEqual([
      ['cs-form', 'form'], ['cs-debrief', 'debrief'], ['cs-done', 'completed'],
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/percentage|score|observer_debrief/i);

    const viaSchedule = await Coach.getCoachTeacher(mockDb.client, 'coach-1', 't-3');
    expect(viaSchedule.observations.map((o) => o.id)).toEqual(['cs-sched']);

    expect(await Coach.getCoachTeacher(mockDb.client, 'coach-1', 't-9')).toBeNull();
    expect(await Coach.getCoachTeacher(mockDb.client, 'coach-1', 'coach-2')).toBeNull();
  });

  test('a database failure on any roster query rejects instead of returning a short or uncounted roster', async () => {
    for (const table of ['leader_schools', 'users', 'coaching_sessions', 'observation_schedules']) {
      const failing = failingTables(seed(), [table]);
      await expect(Coach.listCoachTeachers(failing, 'coach-1')).rejects.toThrow(/does not exist/);
      await expect(Coach.getCoachTeacher(failing, 'coach-1', 't-1')).rejects.toThrow(/does not exist/);
    }
  });
});
