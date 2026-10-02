/**
 * testpaper-orchestrator — the /testpaper conversation, on any channel.
 *
 * Every pick is an interactive list or reply buttons through the messaging
 * facade: native on WhatsApp/Meta, a numbered menu on Baileys, Matrix, Slack
 * and Discord (whose numeric replies come back as the same list/button ids).
 * Multi-picks ("1,3", "1-4", "all") and typed mixes arrive as plain text.
 *
 * Real: the store, the sources, the session (memory fallback), question types,
 * the renderer and delivery. Mocked at the boundary: the database (in-memory
 * query builder), the channel facade, the queue, Redis, Chromium and the PDF
 * parser.
 */

const { createFakeDb } = require('./helpers/fake-db');

const TEACHER = { id: '00000000-0000-4000-8000-000000000001', preferred_language: 'en' };
const OTHER = '00000000-0000-4000-8000-000000000002';
const FROM = 'matrix:@teacher:example.org';
const TEXT = (s) => `${s} `.repeat(12);

let O;
let db;
let WA;
let queue;
let mockPdfParse;

function seed(extra = {}) {
  return {
    users: [{ id: TEACHER.id }, { id: OTHER }],
    lesson_plans: [
      { id: 'lp-1', user_id: TEACHER.id, topic: 'How plants make food', subject: 'Science', grade: '4', content: { text: TEXT('Plants make food in their leaves using sunlight, water and air.') }, created_at: '2026-09-20T10:00:00Z' },
      { id: 'lp-2', user_id: TEACHER.id, topic: 'Parts of a plant', subject: 'Science', grade: '4', content: { text: TEXT('Roots hold the plant and take in water; the stem carries it up.') }, created_at: '2026-09-21T10:00:00Z' },
      { id: 'lp-3', user_id: TEACHER.id, topic: 'Fractions', subject: 'Math', content: null, created_at: '2026-09-22T10:00:00Z' },
    ],
    textbooks: [{ id: 'tb-1', grade: 2, subject: 'math', curriculum: 'corpus' }],
    textbook_toc: [
      { id: 't1', textbook_id: 'tb-1', chapter_number: 1, chapter_title: 'Numbers up to 999', page_start: 1, page_end: 1 },
      { id: 't2', textbook_id: 'tb-1', chapter_number: 2, chapter_title: 'Adding', page_start: 2, page_end: 2 },
    ],
    textbook_pages: [
      { id: 'p1', textbook_id: 'tb-1', textbook_page_number: 1, page_content: TEXT('A 3-digit number has hundreds, tens and ones.') },
      { id: 'p2', textbook_id: 'tb-1', textbook_page_number: 2, page_content: TEXT('Add the ones first, then the tens, then the hundreds.') },
    ],
    ...extra,
  };
}

function load(seedData = seed(), env = {}) {
  jest.resetModules();
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.RUMI_FEATURE_TEST_PAPER;
  Object.assign(process.env, env);
  db = createFakeDb(seedData);
  jest.doMock('../../bot/shared/config/supabase', () => db);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    set: jest.fn().mockResolvedValue(false), get: jest.fn().mockResolvedValue(null), delete: jest.fn().mockResolvedValue(true),
  }));
  WA = {
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendDocument: jest.fn().mockResolvedValue(true),
    downloadMedia: jest.fn(),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => WA);
  queue = { queueJob: jest.fn().mockResolvedValue('job-1') };
  jest.doMock('../../bot/shared/services/queue', () => queue);
  mockPdfParse = jest.fn();
  jest.doMock('pdf-parse', () => mockPdfParse, { virtual: true });
  const page = { setContent: jest.fn(), evaluate: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
  const context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue() };
  jest.doMock('playwright-core', () => ({ chromium: { launch: jest.fn().mockResolvedValue({ isConnected: () => true, newContext: jest.fn().mockResolvedValue(context), on: jest.fn(), close: jest.fn() }) } }), { virtual: true });
  // As whatsapp-bot.js does at startup: the operator's RUMI_FEATURE_* switches.
  require('../../bot/shared/config/feature-availability').overrides.load(process.env);
  O = require('../../bot/shared/services/testpaper/testpaper-orchestrator.service');
}

afterEach(() => {
  delete process.env.RUMI_FEATURE_TEST_PAPER;
  jest.resetModules();
});

const lastList = () => WA.sendInteractiveMessage.mock.calls[WA.sendInteractiveMessage.mock.calls.length - 1][1];
const rowsOf = (list) => list.action.sections.flatMap((s) => s.rows);
const lastText = () => WA.sendMessage.mock.calls[WA.sendMessage.mock.calls.length - 1][1];
const pick = (id) => O.handleSelection({ user: TEACHER, from: FROM, id, language: 'en' });
const say = (text) => O.handleText({ user: TEACHER, from: FROM, text, language: 'en' });
const start = (args = '') => O.start({ user: TEACHER, from: FROM, args, language: 'en' });

describe('start', () => {
  it('offers every source the teacher has, an upload, and my papers', async () => {
    load();
    await start();
    const rows = rowsOf(lastList());
    expect(rows.map((r) => r.id)).toEqual(['tp_src_tb_0', 'tp_src_lp', 'tp_src_up', 'tp_mine']);
    expect(rows[0].title).toBe('Grade 2 · Math (2 ch.)');
    expect(rows[1].title).toBe('My lesson plans (3)');
    // Meta's list limits: titles ≤ 24 characters, ≤ 10 rows.
    for (const r of rows) expect(r.title.length).toBeLessThanOrEqual(24);
  });

  it('with no material at all: an honest message, and an upload is welcome', async () => {
    load({ users: [{ id: TEACHER.id }] });
    await start();
    expect(WA.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(lastText()).toMatch(/I don't have any material to build a test paper from yet/);
    expect(lastText()).toMatch(/won't make one up/);
    expect(queue.queueJob).not.toHaveBeenCalled();
  });

  it('a named subject with no material gets an honest message naming it', async () => {
    load();
    await start('history');
    expect(lastText()).toMatch(/for \*history\*/);
    expect(queue.queueJob).not.toHaveBeenCalled();
  });

  it('a named subject narrows the menu to its material', async () => {
    load();
    await start('science');
    expect(rowsOf(lastList()).map((r) => r.id)).toEqual(['tp_src_lp', 'tp_src_up', 'tp_mine']);
  });

  it('"my papers" as the argument goes straight to the list', async () => {
    load();
    await start('my papers');
    expect(lastText()).toMatch(/no test papers yet/);
  });

  it('switched off by the operator: says so, does nothing else', async () => {
    load(seed(), { RUMI_FEATURE_TEST_PAPER: 'off' });
    await start();
    expect(lastText()).toMatch(/not switched on/);
    expect(WA.sendInteractiveMessage).not.toHaveBeenCalled();
  });
});

describe('a one-chapter paper from a textbook', () => {
  it('book → chapter → size → language → queued, with the chapter\'s text stored', async () => {
    load();
    await start();
    expect(await pick('tp_src_tb_0')).toBe(true);
    expect(rowsOf(lastList()).map((r) => r.id)).toEqual(['tp_ch_1', 'tp_ch_2', 'tp_ch_all']);

    expect(await pick('tp_ch_1')).toBe(true);
    expect(rowsOf(lastList()).map((r) => r.id)).toEqual(['tp_mix_quick', 'tp_mix_standard', 'tp_mix_full']);

    expect(await pick('tp_mix_quick')).toBe(true);
    const langs = rowsOf(lastList()).map((r) => r.id);
    expect(langs[0]).toBe('tp_lang_en');
    expect(langs).toContain('tp_lang_ur');

    expect(await pick('tp_lang_en')).toBe(true);

    const [request] = db.tables.test_paper_requests;
    expect(request).toMatchObject({
      user_id: TEACHER.id, source_kind: 'textbook', subject: 'math', grade: '2', language: 'en', question_count: 10,
      source_ref: { textbookId: 'tb-1', chapterNumbers: [1] },
    });
    expect(request.source_text).toContain('=== Page 1 ===');
    expect(request.source_text).not.toContain('Add the ones first');
    const [paper] = db.tables.test_papers;
    expect(paper).toMatchObject({ request_id: request.id, version: 1, status: 'generating' });
    expect(queue.queueJob).toHaveBeenCalledWith(TEACHER.id, 'testpaper_generate',
      { paperId: paper.id, userId: TEACHER.id, to: FROM, chatLanguage: 'en' });
    expect(lastText()).toMatch(/Making your test paper — .*Numbers up to 999 · 10 questions · English/);
  });
});

describe('a whole-unit paper', () => {
  it('"all" (or 1-2 typed) covers every chapter, in order', async () => {
    load();
    await start();
    await pick('tp_src_tb_0');
    expect(await say('1-2')).toBe(true);
    await pick('tp_mix_standard');
    await pick('tp_lang_en');
    const [request] = db.tables.test_paper_requests;
    expect(request.source_ref.chapterNumbers).toEqual([1, 2]);
    expect(request.source_text).toMatch(/Page 1[\s\S]*Page 2/);
    expect(request.question_count).toBe(20);
  });

  it('a reply that is not a pick asks again rather than guessing', async () => {
    load();
    await start();
    await pick('tp_src_tb_0');
    expect(await say('9')).toBe(true);
    expect(lastText()).toMatch(/Reply with the numbers from the list/);
  });
});

describe('from the teacher\'s own lesson plans', () => {
  it('two plans and a typed mix', async () => {
    load();
    await start();
    await pick('tp_src_lp');
    expect(rowsOf(lastList()).map((r) => r.id)).toEqual(['tp_lp_0', 'tp_lp_1', 'tp_lp_2', 'tp_lp_all']);
    expect(await say('2,3')).toBe(true); // newest first: lp-2, lp-1
    expect(await say('5 MCQs, 3 true/false, 2 short questions')).toBe(true);
    await pick('tp_lang_en');
    const [request] = db.tables.test_paper_requests;
    expect(request).toMatchObject({ source_kind: 'lesson_plan', subject: 'Science', question_count: 10 });
    expect(request.source_ref.lessonPlanIds.sort()).toEqual(['lp-1', 'lp-2']);
    expect(request.question_types.map((q) => [q.id, q.count])).toEqual([['MCQs', 5], ['True/False', 3], ['Short Questions', 2]]);
  });

  it('a plan saved without content: honest message, nothing queued', async () => {
    load();
    await start();
    await pick('tp_src_lp');
    await pick('tp_lp_0'); // lp-3, "Fractions", no content
    await pick('tp_mix_quick');
    await pick('tp_lang_en');
    expect(queue.queueJob).not.toHaveBeenCalled();
    expect(db.tables.test_paper_requests || []).toHaveLength(0);
    expect(lastText()).toMatch(/saved without their content \(Fractions\)/);
  });
});

describe('from an uploaded chapter', () => {
  it('a PDF sent after "Send a chapter" becomes the source', async () => {
    load();
    await start();
    await pick('tp_src_up');
    expect(lastText()).toMatch(/Send me the chapter/);
    WA.downloadMedia.mockResolvedValue(Buffer.from('%PDF'));
    mockPdfParse.mockResolvedValue({ text: TEXT('The water cycle: evaporation, condensation, precipitation.') });
    const consumed = await O.handleDocument({ user: TEACHER, from: FROM, language: 'en', message: { document: { id: 'm1', mime_type: 'application/pdf', filename: 'water-cycle.pdf' } } });
    expect(consumed).toBe(true);
    await pick('tp_mix_quick');
    await pick('tp_lang_en');
    const [request] = db.tables.test_paper_requests;
    expect(request).toMatchObject({ source_kind: 'upload', source_ref: { filename: 'water-cycle.pdf' } });
    expect(request.source_text).toContain('The water cycle');
  });

  it('pasted text works the same way', async () => {
    load({ users: [{ id: TEACHER.id }] });
    await start();
    expect(await say(TEXT('Magnets attract iron and steel. Like poles repel and unlike poles attract.'))).toBe(true);
    expect(rowsOf(lastList())[0].id).toBe('tp_mix_quick');
  });

  it('after a refused subject, an uploaded chapter does not inherit that subject', async () => {
    load();
    await start('history'); // nothing for history → the upload is welcome
    WA.downloadMedia.mockResolvedValue(Buffer.from('%PDF'));
    mockPdfParse.mockResolvedValue({ text: TEXT('The water cycle: evaporation, condensation, precipitation.') });
    await O.handleDocument({ user: TEACHER, from: FROM, language: 'en', message: { document: { id: 'm1', mime_type: 'application/pdf', filename: 'water.pdf' } } });
    await pick('tp_mix_quick');
    await pick('tp_lang_en');
    // The model reads the subject from the chapter itself.
    expect(db.tables.test_paper_requests[0].subject).toBeNull();
  });

  it('a document nobody asked for is left to the other handlers', async () => {
    load();
    expect(await O.handleDocument({ user: TEACHER, from: FROM, language: 'en', message: { document: { id: 'm1', mime_type: 'application/pdf' } } })).toBe(false);
  });

  it('a scan with no text says so instead of making a paper', async () => {
    load();
    await start();
    await pick('tp_src_up');
    WA.downloadMedia.mockResolvedValue(Buffer.from('%PDF'));
    mockPdfParse.mockResolvedValue({ text: '  ' });
    await O.handleDocument({ user: TEACHER, from: FROM, language: 'en', message: { document: { id: 'm1', mime_type: 'application/pdf', filename: 'scan.pdf' } } });
    expect(lastText()).toMatch(/could not find enough text/);
  });
});

describe('the paper language', () => {
  it('an Urdu paper is requested in Urdu', async () => {
    load();
    await start();
    await pick('tp_src_tb_0');
    await pick('tp_ch_1');
    await pick('tp_mix_quick');
    await pick('tp_lang_ur');
    expect(db.tables.test_paper_requests[0].language).toBe('ur');
  });
});

describe('my papers and editing', () => {
  async function withReadyPaper() {
    load();
    const Store = require('../../bot/shared/services/testpaper/testpaper-store.service');
    const request = await Store.createRequest({ userId: TEACHER.id, sourceKind: 'textbook', sourceText: TEXT('x'), sourceLabel: 'Math · Chapter 1: Numbers up to 999', subject: 'math', grade: '2', language: 'en' });
    const paper = await Store.createPaper({ requestId: request.id });
    await Store.markReady(paper.id, { title: 'Numbers — Chapter Test', examJson: { unseen: { objective: { MCQs: [{ question: 'q', options: ['a) 1'], marks: 1 }] } } }, questionCount: 1, totalMarks: 1 });
    return { Store, request, paper };
  }

  it('lists ready papers and re-sends the one picked, as stored', async () => {
    const { paper } = await withReadyPaper();
    await pick('tp_mine');
    const rows = rowsOf(lastList());
    expect(rows).toEqual([expect.objectContaining({ id: `tp_open_${paper.id}`, title: 'Numbers — Chapter Test' })]);
    await pick(`tp_open_${paper.id}`);
    expect(WA.sendDocument).toHaveBeenCalledTimes(2);
    expect(queue.queueJob).not.toHaveBeenCalled();
  });

  it('an edit request makes the next version and queues a revision', async () => {
    const { paper } = await withReadyPaper();
    await pick(`tp_edit_${paper.id}`);
    expect(lastText()).toMatch(/What should change\?/);
    expect(await say('make it easier and add two true/false questions')).toBe(true);
    const v2 = db.tables.test_papers.find((p) => p.version === 2);
    expect(v2).toMatchObject({ edited_from: paper.id, edit_instruction: 'make it easier and add two true/false questions', status: 'generating' });
    expect(queue.queueJob).toHaveBeenCalledWith(TEACHER.id, 'testpaper_revise', { paperId: v2.id, userId: TEACHER.id, to: FROM, chatLanguage: 'en' });
    expect(lastText()).toMatch(/version 2/);
  });

  it('a bare number or "ok" is not an edit request: asks again, makes no version', async () => {
    const { paper } = await withReadyPaper();
    await pick(`tp_edit_${paper.id}`);
    for (const stray of ['1', 'ok']) {
      expect(await say(stray)).toBe(true);
      expect(lastText()).toMatch(/Tell me what to change/);
    }
    expect(db.tables.test_papers.filter((p) => p.version === 2)).toHaveLength(0);
    expect(queue.queueJob).not.toHaveBeenCalled();
    // A real one-word request still goes through.
    expect(await say('easier')).toBe(true);
    expect(db.tables.test_papers.filter((p) => p.version === 2)).toHaveLength(1);
  });

  it('another teacher\'s paper id is refused', async () => {
    const { paper } = await withReadyPaper();
    await O.handleSelection({ user: { id: OTHER }, from: '15550100002', id: `tp_open_${paper.id}`, language: 'en' });
    expect(WA.sendDocument).not.toHaveBeenCalled();
    expect(lastText()).toMatch(/could not find that paper/);
  });
});

describe('text outside the conversation', () => {
  it('is not consumed when no pick is pending', async () => {
    load();
    expect(await say('hello')).toBe(false);
  });

  it('a slash command always passes through', async () => {
    load();
    await start();
    await pick('tp_src_tb_0');
    expect(await say('/menu')).toBe(false);
  });

  it('"cancel" ends the conversation', async () => {
    load();
    await start();
    await pick('tp_src_tb_0');
    expect(await say('cancel')).toBe(true);
    expect(lastText()).toMatch(/no paper made/);
    expect(await say('1')).toBe(false);
  });

  it('owns only tp_ ids', () => {
    load();
    expect(O.isTestPaperId('tp_mix_quick')).toBe(true);
    expect(O.isTestPaperId('quiz_class_1')).toBe(false);
  });
});
