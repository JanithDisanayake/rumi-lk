/**
 * LLM_PROVIDER=roar — Roar AI gateway: base URL, key slot, and the one-model mapping.
 */
const path = require('path');
const llmClientPath = path.resolve(__dirname, '../../../bot/shared/services/llm-client.js');
const endpointPath = path.resolve(__dirname, '../../../bot/shared/config/llm-endpoint.js');

describe('llm-endpoint', () => {
  const ep = require(endpointPath);

  test('roar resolves to the Roar gateway and prefers ROAR_API_KEY', () => {
    const r = ep.resolveEndpoint({ LLM_PROVIDER: 'roar', ROAR_API_KEY: 'roar_live_a', OPENROUTER_API_KEY: 'x' });
    expect(r).toMatchObject({ provider: 'roar', baseURL: 'https://api.roar-ai.com/v1', keyVar: 'ROAR_API_KEY', apiKey: 'roar_live_a' });
  });

  test('roar falls back to the OPENROUTER_API_KEY slot', () => {
    const r = ep.resolveEndpoint({ LLM_PROVIDER: 'roar', OPENROUTER_API_KEY: 'roar_live_b' });
    expect(r.apiKey).toBe('roar_live_b');
    expect(r.keyVar).toBe('OPENROUTER_API_KEY');
  });

  test('default stays OpenRouter; LLM_BASE_URL overrides', () => {
    expect(ep.resolveEndpoint({}).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(ep.resolveEndpoint({ LLM_PROVIDER: 'roar', LLM_BASE_URL: 'https://x.test/v1/' }).baseURL).toBe('https://x.test/v1');
  });

  test('default models and image detection', () => {
    expect(ep.roarModel({})).toBe('qwen3.8-27b-lk');
    expect(ep.roarVisionModel({})).toBe('qwen3.8-27b');
    expect(ep.hasImageInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'u' } }] }])).toBe(true);
    expect(ep.hasImageInput([{ role: 'user', content: 'hi' }])).toBe(false);
  });
});

describe('llm-client with LLM_PROVIDER=roar', () => {
  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    jest.resetModules();
    process.env.LLM_PROVIDER = 'roar';
    process.env.ROAR_API_KEY = 'roar_live_test_key_000000';
    delete process.env.LLM_MODEL;
    delete process.env.LLM_VISION_MODEL;
  });
  afterEach(() => { process.env = saved; });

  test('client points at the Roar gateway', () => {
    const client = require(llmClientPath).createLLMClient();
    expect(client.baseURL).toBe('https://api.roar-ai.com/v1');
    expect(client.apiKey).toBe('roar_live_test_key_000000');
  });

  test('every named model is replaced; image calls use the vision model; OpenRouter-only fields are dropped', async () => {
    const openaiPath = require.resolve('openai', { paths: [path.resolve(__dirname, '../../../bot')] });
    jest.doMock(openaiPath, () => {
      const calls = [];
      function OpenAI(config) {
        this._config = config;
        this.chat = { completions: { create: async (params) => { calls.push(params); return { choices: [] }; } } };
      }
      OpenAI.calls = calls;
      return OpenAI;
    });
    const OpenAI = require(openaiPath);
    const client = require(llmClientPath).createLLMClient();
    await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], usage: { include: true }, reasoning: { effort: 'high' }, provider: { sort: 'price' } });
    await client.chat.completions.create({ model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'u' } }] }] });
    expect(OpenAI.calls[0].model).toBe('qwen3.8-27b-lk');
    expect(OpenAI.calls[0]).not.toHaveProperty('usage');
    expect(OpenAI.calls[0]).not.toHaveProperty('reasoning');
    expect(OpenAI.calls[0]).not.toHaveProperty('provider');
    expect(OpenAI.calls[1].model).toBe('qwen3.8-27b');
  });
});
