'use strict';
/**
 * llm-endpoint — where the LLM calls go, and with which key.
 *
 * One answer for every file that talks to a model (llm-client, the reflective
 * question router, the Whisper/TTS fallbacks, doctor, test-connections, the
 * console), so the gateway URL is not repeated in each of them.
 *
 *   LLM_PROVIDER=openrouter (default)  https://openrouter.ai/api/v1   OPENROUTER_API_KEY
 *   LLM_PROVIDER=openai                https://api.openai.com/v1      OPENAI_API_KEY
 *   LLM_PROVIDER=roar                  https://api.roar-ai.com/v1     ROAR_API_KEY, else OPENROUTER_API_KEY
 *
 * For `roar`, OPENROUTER_API_KEY is accepted as the key slot so the existing
 * "required variables" checks keep passing; ROAR_API_KEY wins when both are set.
 * LLM_BASE_URL overrides the URL for any provider.
 *
 * No requires, so it is safe to load from `rumi doctor` and the root test suite.
 */

const ROAR_BASE_URL = 'https://api.roar-ai.com/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Roar's in-country model, and the model used when a request carries an image
// (image input on the -lk model is not confirmed).
const ROAR_DEFAULT_MODEL = 'qwen3.8-27b-lk';
const ROAR_DEFAULT_VISION_MODEL = 'qwen3.8-27b';
const ROAR_STT_MODEL = 'whisper-large-v3-turbo';

function providerOf(env = process.env) {
  return String(env.LLM_PROVIDER || 'openrouter').toLowerCase();
}

function resolveEndpoint(env = process.env) {
  const provider = providerOf(env);
  const override = String(env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (provider === 'openai') {
    return { provider, baseURL: override || OPENAI_BASE_URL, keyVar: 'OPENAI_API_KEY', apiKey: env.OPENAI_API_KEY };
  }
  if (provider === 'roar') {
    const useRoarVar = Boolean(env.ROAR_API_KEY);
    return {
      provider,
      baseURL: override || ROAR_BASE_URL,
      keyVar: useRoarVar ? 'ROAR_API_KEY' : 'OPENROUTER_API_KEY',
      apiKey: env.ROAR_API_KEY || env.OPENROUTER_API_KEY,
    };
  }
  return { provider: 'openrouter', baseURL: override || OPENROUTER_BASE_URL, keyVar: 'OPENROUTER_API_KEY', apiKey: env.OPENROUTER_API_KEY };
}

/** The model every text job runs on under `roar` (LLM_MODEL wins). */
function roarModel(env = process.env) {
  return String(env.LLM_MODEL || '').trim() || ROAR_DEFAULT_MODEL;
}

/** The model for requests that carry an image under `roar`. */
function roarVisionModel(env = process.env) {
  return String(env.LLM_VISION_MODEL || '').trim() || ROAR_DEFAULT_VISION_MODEL;
}

/** True when a chat request's messages include an image part. */
function hasImageInput(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => Array.isArray(m && m.content)
    && m.content.some((p) => p && (p.type === 'image_url' || p.type === 'input_image' || p.image_url)));
}

module.exports = {
  ROAR_BASE_URL,
  OPENROUTER_BASE_URL,
  OPENAI_BASE_URL,
  ROAR_DEFAULT_MODEL,
  ROAR_DEFAULT_VISION_MODEL,
  ROAR_STT_MODEL,
  providerOf,
  resolveEndpoint,
  roarModel,
  roarVisionModel,
  hasImageInput,
};
