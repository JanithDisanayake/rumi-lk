/**
 * LLM Client Factory
 *
 * Provides a unified interface to LLM providers using the OpenAI SDK.
 * Default: OpenRouter (one key for 500+ models).
 * Override: Direct OpenAI (set LLM_PROVIDER=openai + OPENAI_API_KEY).
 *
 * When using OpenRouter, model names are auto-prefixed with 'openai/' if no
 * provider prefix is present (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini').
 * This means existing code can use bare OpenAI model names unchanged.
 *
 * Usage:
 *   const { getClient, getDefaultModel } = require('./llm-client');
 *   const client = getClient();
 *   const response = await client.chat.completions.create({
 *     model: 'gpt-4o-mini',  // auto-prefixed to 'openai/gpt-4o-mini' on OpenRouter
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 */

const OpenAI = require('openai');
const endpoint = require('../config/llm-endpoint');

const PROVIDER = endpoint.providerOf(process.env);
const DEFAULT_MODEL = PROVIDER === 'roar' ? endpoint.roarModel(process.env) : (process.env.LLM_MODEL || 'openai/gpt-4o');
const OPENROUTER_BASE_URL = endpoint.OPENROUTER_BASE_URL;

// Request fields only OpenRouter understands. Roar's gateway and direct OpenAI
// reject or ignore them, so they are dropped on those providers.
const GATEWAY_STRIPPED_PARAMS = ['usage', 'reasoning', 'provider'];

let _client = null;

/**
 * Create a new LLM client configured for the current provider.
 * For OpenRouter, wraps chat.completions.create to auto-prefix model names.
 */
function createLLMClient() {
  if (PROVIDER === 'roar') return createRoarClient();

  if (PROVIDER === 'openai') {
    // Direct OpenAI — no baseURL override
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Default: OpenRouter — uses OpenAI-compatible API
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': process.env.APP_URL || '',
      'X-Title': 'Rumi Teaching Assistant',
    },
  });

  // Auto-prefix model names for OpenRouter (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini')
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (params, options) => {
    if (params.model && !params.model.includes('/')) {
      params = { ...params, model: `openai/${params.model}` };
    }
    return originalCreate(params, options);
  };

  return client;
}

/**
 * Roar AI gateway (OpenAI-compatible). Every deployment runs on one in-country
 * model, so whatever model a call site names ('gpt-4o-mini', 'google/gemini-…')
 * is replaced here, at the single choke point: text calls go to LLM_MODEL
 * (default qwen3.8-27b-lk), calls that carry an image go to LLM_VISION_MODEL
 * (default qwen3.8-27b, since image input on the -lk model is not confirmed).
 */
function createRoarClient() {
  const ep = endpoint.resolveEndpoint(process.env);
  const client = new OpenAI({
    apiKey: ep.apiKey,
    baseURL: ep.baseURL,
    defaultHeaders: { 'X-Title': 'Rumi Teaching Assistant' },
  });
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (params, options) => {
    const clean = { ...params };
    for (const k of GATEWAY_STRIPPED_PARAMS) delete clean[k];
    clean.model = endpoint.hasImageInput(clean.messages)
      ? endpoint.roarVisionModel(process.env)
      : endpoint.roarModel(process.env);
    return originalCreate(clean, options);
  };
  return client;
}

/**
 * Get a singleton LLM client instance.
 */
function getClient() {
  if (!_client) {
    _client = createLLMClient();
  }
  return _client;
}

/**
 * Get the default model name.
 */
function getDefaultModel() {
  return DEFAULT_MODEL;
}

// Request fields only OpenRouter understands; direct OpenAI rejects them.
const OPENROUTER_ONLY_PARAMS = ['usage', 'reasoning'];

let _openaiDirectClient = null;

/**
 * The client and model id for one call of a model-registry job.
 *
 * Same client as getClient(), and the same provider: PROVIDER, read once at
 * require time, so an env change at runtime never pairs the OpenRouter client
 * with OpenAI-shaped ids (or the reverse). This only settles WHICH model and,
 * on the direct OpenAI provider, turns an OpenRouter-style request into one
 * OpenAI accepts (`openai/gpt-x` → `gpt-x`, OpenRouter-only fields dropped). An
 * OpenRouter id of another vendor (`anthropic/…`) does not exist there, so it
 * falls back to the job's OpenAI default. A job's default comes from
 * config/model-registry.js when no model is named.
 *
 * @param {string|null} model an OpenRouter model id, or null for the job's default
 * @param {{job?: string}} [opts]
 * @returns {{client: object, model: string, job: string|null}}
 */
function getClientForModel(model, { job = null } = {}) {
  const registry = require('../config/model-registry');
  let id = String(model || '').trim();
  if (!id && job) id = registry.resolveModelForJob(job, {}, { ...process.env, LLM_PROVIDER: PROVIDER }).model;
  if (!id) id = DEFAULT_MODEL;

  if (PROVIDER !== 'openai') return { client: getClient(), model: id, job };

  if (!_openaiDirectClient) {
    const base = getClient();
    const create = base.chat.completions.create.bind(base.chat.completions);
    // Layered over the SDK objects (not spread from them): parse, stream and the
    // rest live on their prototypes and must stay reachable.
    const completions = Object.create(base.chat.completions);
    completions.create = (params, options) => {
      const clean = { ...params };
      for (const k of OPENROUTER_ONLY_PARAMS) delete clean[k];
      return create(clean, options);
    };
    const chat = Object.create(base.chat);
    chat.completions = completions;
    _openaiDirectClient = Object.create(base);
    _openaiDirectClient.chat = chat;
  }
  if (id.includes('/') && !/^openai\//.test(id)) {
    const entry = job && registry.JOBS[job];
    const fallback = (entry && entry.openaiDefault) || DEFAULT_MODEL;
    try {
      require('../utils/logger').logToFile('⚠️ LLM: an OpenRouter model id was asked for on LLM_PROVIDER=openai — using an OpenAI model instead', {
        job, requested: id, model: fallback,
      }, 'warn');
    } catch (_) { /* a log is not worth a failed call */ }
    id = fallback;
  }
  let bare = id.replace(/^openai\//, '');
  // DEFAULT_MODEL comes from LLM_MODEL and could itself name another vendor.
  if (bare.includes('/')) bare = 'gpt-4o';
  return { client: _openaiDirectClient, model: bare, job };
}

/**
 * Get current provider info (for diagnostics/health checks).
 */
function getProviderInfo() {
  return {
    provider: PROVIDER,
    model: DEFAULT_MODEL,
    baseURL: endpoint.resolveEndpoint(process.env).baseURL,
  };
}

module.exports = {
  createLLMClient,
  getClient,
  getClientForModel,
  getDefaultModel,
  getProviderInfo,
};
