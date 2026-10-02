/**
 * testpaper-delivery — a stored paper version becomes two PDFs in the chat
 * (the paper, then its answer key) and a follow-up offering an edit.
 *
 * The real renderer and the real html-to-pdf run; Chromium is mocked at
 * playwright-core and the channel at the messaging facade, so whatever channel
 * the teacher is on, the same calls are made.
 */

const fs = require('fs');

let Delivery;
let WA;
let pdfHtml;
let launch;

const PAPER = {
  id: 'paper-2', version: 2, title: 'Numbers up to 999 — Chapter Test', question_count: 2, total_marks: 3,
  exam_json: {
    unseen: {
      objective: { MCQs: [{ main_question: 'Choose', question: 'Which number comes after 99?', options: ['a) 98', 'b) 100'], marks: 1, answer: 'b) 100' }] },
      subjective: { 'Short Questions': [{ question: 'Write 456 in words.', marks: 2, answer: 'Four hundred fifty-six' }] },
    },
  },
};
const REQUEST = { id: 'req-1', subject: 'math', grade: '2', language: 'en', source_label: 'Math · Chapter 1: Numbers up to 999' };

function setup({ pdfFails = false } = {}) {
  jest.resetModules();
  pdfHtml = [];
  const page = {
    setContent: jest.fn(async (html) => { pdfHtml.push(html); }),
    evaluate: jest.fn().mockResolvedValue(),
    pdf: pdfFails ? jest.fn().mockRejectedValue(new Error('Executable doesn\'t exist')) : jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  };
  const context = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue() };
  launch = jest.fn().mockResolvedValue({ isConnected: () => true, newContext: jest.fn().mockResolvedValue(context), on: jest.fn(), close: jest.fn() });
  jest.doMock('playwright-core', () => ({ chromium: { launch } }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  WA = {
    sendDocument: jest.fn(async (to, filePath) => {
      // The file must exist when the channel reads it.
      expect(fs.existsSync(filePath)).toBe(true);
      return true;
    }),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => WA);
  Delivery = require('../../bot/shared/services/testpaper/testpaper-delivery.service');
}

it('sends the paper, then the key, then an edit offer naming this version', async () => {
  setup();
  const ok = await Delivery.deliverPaper({ to: 'matrix:@teacher:example.org', paper: PAPER, request: REQUEST, chatLanguage: 'en' });
  expect(ok).toBe(true);

  const [paperCall, keyCall] = WA.sendDocument.mock.calls;
  expect(paperCall[0]).toBe('matrix:@teacher:example.org');
  expect(paperCall[2]).toBe('TestPaper_Math_Numbers_up_to_999_Chapter_Test_v2.pdf');
  expect(paperCall[3]).toMatch(/Numbers up to 999 — Chapter Test \(version 2\)/);
  expect(keyCall[2]).toBe('TestPaper_Math_Numbers_up_to_999_Chapter_Test_v2_AnswerKey.pdf');
  expect(keyCall[3]).toMatch(/Answer key/);

  // The paper HTML carries no answers; the key's does.
  expect(pdfHtml[0]).not.toContain('Four hundred fifty-six');
  expect(pdfHtml[1]).toContain('Four hundred fifty-six');
  expect(pdfHtml[0]).toContain('Version 2');

  const buttons = WA.sendInteractiveButtons.mock.calls[0][1].buttons.map((b) => b.id);
  expect(buttons).toEqual(['tp_edit_paper-2', 'tp_new', 'tp_mine']);
});

it('removes its temporary files after sending', async () => {
  setup();
  await Delivery.deliverPaper({ to: '15550100001', paper: PAPER, request: REQUEST, chatLanguage: 'en' });
  for (const call of WA.sendDocument.mock.calls) expect(fs.existsSync(call[1])).toBe(false);
});

it('an Urdu paper is printed right to left', async () => {
  setup();
  await Delivery.deliverPaper({ to: '15550100001', paper: PAPER, request: { ...REQUEST, language: 'ur' }, chatLanguage: 'ur' });
  expect(pdfHtml[0]).toContain('<html lang="ur" dir="rtl">');
});

it('a non-Latin title still gives a usable file name', async () => {
  setup();
  await Delivery.deliverPaper({ to: '15550100001', paper: { ...PAPER, title: 'اعداد — امتحان' }, request: { ...REQUEST, language: 'ur' }, chatLanguage: 'ur' });
  expect(WA.sendDocument.mock.calls[0][2]).toMatch(/^TestPaper_Math_.*v2\.pdf$/);
});

it('no Chromium: says so plainly, sends no document, reports failure', async () => {
  setup({ pdfFails: true });
  const ok = await Delivery.deliverPaper({ to: '15550100001', paper: PAPER, request: REQUEST, chatLanguage: 'en' });
  expect(ok).toBe(false);
  expect(WA.sendDocument).not.toHaveBeenCalled();
  expect(WA.sendMessage.mock.calls[0][1]).toMatch(/cannot print PDFs/);
});

it('a channel that fails the document send reports failure', async () => {
  setup();
  WA.sendDocument.mockResolvedValue(false);
  expect(await Delivery.deliverPaper({ to: '15550100001', paper: PAPER, request: REQUEST, chatLanguage: 'en' })).toBe(false);
});
