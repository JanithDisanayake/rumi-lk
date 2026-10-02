'use strict';
/**
 * WHAT A PLAN OR TOPIC QUIZ IS WRITTEN FROM — resolveLessonSource.
 *
 * lp_generated: the platform's own `lesson_plans` row (quiz.lesson_plan_id, or
 * meta.lessons[0].lesson_plan_id). The plan text comes from content.plan_text,
 * else from the content JSON itself, else from the plan's PDF; a plan with none
 * of those is written from its topic. A plan row that is gone is nothing to
 * write from (null → source_missing); a database ERROR throws so the job is
 * redelivered rather than the teacher being told the plan is gone.
 *
 * topic: no source text at all — the quiz's own topic, grade and subject.
 *
 * Only the database client and the PDF fetch (the network boundary) are doubled.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const PlanDigest = require('../../bot/shared/services/quiz/plan-quiz-digest.service');
const LessonPlanText = require('../../bot/shared/services/coaching/fidelity/lesson-plan-text');

const PLAN_ID = '66666666-6666-4666-8666-666666666666';
const PLAN_TEXT = 'Lesson objective: compare two fractions with the same denominator. '.repeat(10);
const quizFor = (over = {}) => ({
  id: 'q-1', teacher_id: 'u-1', quiz_source: 'lp_generated', lesson_plan_id: PLAN_ID,
  topic: 'Comparing fractions', grade: '4', subject: 'maths', meta: {}, ...over,
});

function wirePlan(row, error = null) {
  installFrom(supabase.from, { lesson_plans: error ? { data: null, error } : { data: row ? [row] : [] } });
}

beforeEach(() => {
  jest.restoreAllMocks();
  supabase.from.mockReset();
});

describe('lp_generated', () => {
  test('content.plan_text is the plan', async () => {
    wirePlan({ id: PLAN_ID, topic: 'Comparing fractions', grade: '4', subject: 'Mathematics', content: { plan_text: PLAN_TEXT, source: 'gamma_pdf' }, pdf_url: 'https://cdn.test/p.pdf' });
    const pdf = jest.spyOn(PlanDigest, 'planTextFromPdf');
    const src = await Gen.resolveLessonSource(quizFor());
    expect(src).toEqual(expect.objectContaining({
      kind: 'plan', from: 'plan_text', title: 'Comparing fractions', grade: '4', lessonPlanId: PLAN_ID,
    }));
    expect(src.text).toContain(PLAN_TEXT.trim());
    expect(pdf).not.toHaveBeenCalled();
    const sel = supabase.from.callsFor('lesson_plans')[0];
    expect(sel).toEqual(expect.arrayContaining([['eq', 'id', PLAN_ID]]));
  });

  test('the stored plan is read through the shared lesson-plan text helper (one reader for every feature)', async () => {
    const row = { id: PLAN_ID, topic: 'Comparing fractions', grade: '4', subject: 'Mathematics', content: { plan_text: PLAN_TEXT }, pdf_url: null };
    wirePlan(row);
    const shared = jest.spyOn(LessonPlanText, 'planTextFromRow');
    const src = await Gen.resolveLessonSource(quizFor());
    expect(shared).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID, content: row.content }));
    expect(src.text).toBe(shared.mock.results[0].value);
  });

  test('the plan id may come from meta.lessons[0]', async () => {
    wirePlan({ id: PLAN_ID, topic: 'T', content: { plan_text: PLAN_TEXT } });
    const src = await Gen.resolveLessonSource(quizFor({ lesson_plan_id: null, meta: { lessons: [{ lesson_plan_id: PLAN_ID }] } }));
    expect(src.lessonPlanId).toBe(PLAN_ID);
    expect(src.from).toBe('plan_text');
  });

  test('content without plan_text is read as the plan itself, flattened to its text', async () => {
    const content = { objective: 'Compare fractions with like denominators', activities: ['Fold paper strips into quarters', 'Shade 3/4 and 1/4 and compare'], assessment: { exit: 'Which is bigger, 2/5 or 4/5?' } };
    wirePlan({ id: PLAN_ID, topic: 'Comparing fractions', content, pdf_url: null });
    const src = await Gen.resolveLessonSource(quizFor());
    expect(src.from).toBe('content');
    expect(src.text).toMatch(/Fold paper strips into quarters/);
    expect(src.text).toMatch(/Which is bigger, 2\/5 or 4\/5\?/);
    expect(src.text).not.toMatch(/[{}"]/);
  });

  test('no content: the PDF is downloaded and its text extracted', async () => {
    wirePlan({ id: PLAN_ID, topic: 'Comparing fractions', content: null, pdf_url: 'https://cdn.test/plan.pdf' });
    const pdf = jest.spyOn(PlanDigest, 'planTextFromPdf').mockResolvedValue(PLAN_TEXT);
    const src = await Gen.resolveLessonSource(quizFor());
    expect(pdf).toHaveBeenCalledWith('https://cdn.test/plan.pdf');
    expect(src).toEqual(expect.objectContaining({ kind: 'plan', from: 'pdf', text: PLAN_TEXT.trim() }));
  });

  test('a PDF that cannot be read falls back to the plan\'s topic', async () => {
    wirePlan({ id: PLAN_ID, topic: 'Comparing fractions', grade: '4', subject: 'maths', content: null, pdf_url: 'https://cdn.test/plan.pdf' });
    jest.spyOn(PlanDigest, 'planTextFromPdf').mockRejectedValue(new Error('404'));
    const src = await Gen.resolveLessonSource(quizFor());
    expect(src).toEqual(expect.objectContaining({ kind: 'plan', from: 'topic', text: null, title: 'Comparing fractions' }));
  });

  test('a plan row that is gone is nothing to write from', async () => {
    wirePlan(null);
    expect(await Gen.resolveLessonSource(quizFor())).toBeNull();
  });

  test('a quiz that names no plan is nothing to write from', async () => {
    wirePlan(null);
    expect(await Gen.resolveLessonSource(quizFor({ lesson_plan_id: null }))).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('a database error throws (the job is redelivered)', async () => {
    wirePlan(null, { message: 'timeout' });
    await expect(Gen.resolveLessonSource(quizFor())).rejects.toThrow(/timeout/);
  });
});

describe('topic', () => {
  test('the quiz\'s own topic, grade and subject — no source text, no database read', async () => {
    const src = await Gen.resolveLessonSource(quizFor({ quiz_source: 'topic', lesson_plan_id: null, topic: 'The water cycle', subject: 'science', grade: '5' }));
    expect(src).toEqual(expect.objectContaining({
      kind: 'topic', from: 'topic', text: null, title: 'The water cycle', subject: 'science', grade: '5',
    }));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('a topic quiz with no topic is nothing to write from', async () => {
    expect(await Gen.resolveLessonSource(quizFor({ quiz_source: 'topic', topic: '  ' }))).toBeNull();
  });
});
