/**
 * getClientForModel — the per-job entry the lesson quiz calls (one OpenRouter key
 * runs every quiz pass). The shim sits over the same OSS client; no second
 * provider lane.
 */

const mockCreate = jest.fn(async (params) => ({ choices: [{ message: { content: '{}' } }], params }));
jest.mock('openai', () => jest.fn((config) => ({
  _config: config,
  chat: { completions: { create: mockCreate } },
})));

describe('llm-client getClientForModel', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    jest.resetModules();
    mockCreate.mockClear();
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    delete process.env.TRANSCRIPT_QUIZ_MODEL;
    delete process.env.TRANSCRIPT_QUIZ_VERIFY_MODEL;
    delete process.env.QUIZ_REPORT_MODEL;
  });
  afterAll(() => { process.env = originalEnv; });

  it('returns the shared OpenRouter client and the requested model, untouched', () => {
    const { getClientForModel, getClient } = require('../../bot/shared/services/llm-client');
    const out = getClientForModel('google/gemini-2.5-flash', { job: 'quiz.transcript' });
    expect(out.model).toBe('google/gemini-2.5-flash');
    expect(out.client).toBe(getClient());
  });

  it('falls back to the job default when no model is named', () => {
    const { getClientForModel } = require('../../bot/shared/services/llm-client');
    expect(getClientForModel(null, { job: 'quiz.keyVerify' }).model).toBe('anthropic/claude-sonnet-5');
    expect(getClientForModel('', { job: 'quiz.videoReport' }).model).toBe('openai/gpt-5.4-mini');
  });

  it('on LLM_PROVIDER=openai, strips the openai/ prefix and the OpenRouter-only params', async () => {
    process.env.LLM_PROVIDER = 'openai';
    const { getClientForModel } = require('../../bot/shared/services/llm-client');
    const { client, model } = getClientForModel('openai/gpt-5.4-mini', { job: 'quiz.videoReport' });
    expect(model).toBe('gpt-5.4-mini');
    await client.chat.completions.create({
      model, messages: [], usage: { include: true }, reasoning: { effort: 'low' },
    });
    const sent = mockCreate.mock.calls[0][0];
    expect(sent.usage).toBeUndefined();
    expect(sent.reasoning).toBeUndefined();
    expect(sent.model).toBe('gpt-5.4-mini');
  });
});

describe('model-registry (quiz jobs)', () => {
  it('each quiz job keeps its own env var and a default that runs on one OpenRouter key, read per call', () => {
    const { resolveModelForJob, JOBS } = require('../../bot/shared/config/model-registry');
    expect(Object.keys(JOBS)).toEqual(expect.arrayContaining(['quiz.keyVerify', 'quiz.transcript', 'quiz.videoReport']));
    expect(resolveModelForJob('quiz.transcript', {}, {}).model).toBe('google/gemini-2.5-flash');
    expect(resolveModelForJob('quiz.transcript', {}, { TRANSCRIPT_QUIZ_MODEL: 'openai/gpt-4.1-mini' }).model).toBe('openai/gpt-4.1-mini');
    expect(resolveModelForJob('quiz.keyVerify', {}, { TRANSCRIPT_QUIZ_VERIFY_MODEL: '  ' }).model).toBe('anthropic/claude-sonnet-5');
    expect(resolveModelForJob('quiz.videoReport', {}, {}).model).toBe('openai/gpt-5.4-mini');
  });

  it('under LLM_PROVIDER=openai a quiz job gets an OpenAI model', () => {
    const { resolveModelForJob } = require('../../bot/shared/config/model-registry');
    for (const job of ['quiz.transcript', 'quiz.keyVerify', 'quiz.videoReport']) {
      expect(resolveModelForJob(job, {}, { LLM_PROVIDER: 'openai' }).model).not.toMatch(/\//);
    }
  });
});
