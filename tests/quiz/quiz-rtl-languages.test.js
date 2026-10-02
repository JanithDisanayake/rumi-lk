'use strict';
/**
 * The direction of a quiz document comes from the language registry
 * (config/supported-languages isRTL), not from a hand-kept list holding only
 * 'ur'. A quiz in Arabic or Pashto is laid out right to left like an Urdu one;
 * an English one stays left to right.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const teacherSheet = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const classReport = require('../../bot/shared/templates/video-quiz-report.template');

const sheet = (language) => teacherSheet({
  topic: 'دورة حياة النبات', teacherName: 'Teacher Example', date: '2 Oct 2026',
  digest: { slos: [] },
  questions: [{ question_text: 'ما الذي يأتي بعد البذرة؟', option_a: 'البرعم', option_b: 'الثمرة', correct_option: 'A' }],
  language, contentLanguage: language,
});

const report = (language) => classReport({
  topic: 'دورة حياة النبات', teacherName: 'Teacher Example', classes: ['Blue'],
  started: 1, finished: 1, average: 50,
  students: [{ name: 'Child One', correct: 1, total: 2, pct: 50 }],
  hardest: [{ text: 'ما الذي يأتي بعد البذرة؟', correct: 0, total: 1, pct: 0 }],
  unfinished: [], language, contentLanguage: language,
});

describe.each(['ar', 'ps-PK'])('a %s quiz is right to left', (language) => {
  test('the teacher sheet', () => {
    const html = sheet(language);
    expect(html).toContain(`<html dir="rtl" lang="${language}">`);
    expect(html).toMatch(/class="stem content" dir="rtl"/);
  });

  test('the class report', () => {
    const html = report(language);
    expect(html).toMatch(/^<!doctype html><html dir="rtl"/);
  });
});

describe('an English quiz stays left to right', () => {
  test('the teacher sheet', () => {
    expect(sheet('en')).toContain('<html dir="ltr" lang="en">');
  });
  test('the class report', () => {
    expect(report('en')).toMatch(/^<!doctype html><html dir="ltr"/);
  });
});
