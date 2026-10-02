/**
 * /observe — the coach's entry point, and the coach's typed replies.
 *
 * handleObserveCommand: gates (feature, account, role) → one-time onboarding →
 * the capture prompt with awaiting_audio armed.
 * handleObserveText: the text-handler hook. /observe itself, plus any reply a
 * pending observe step is waiting for (the stepwise rating form, the teacher's
 * details for the report). Returns false for everything else so normal chat is
 * untouched.
 *
 * Both return true when the message was handled (caller stops processing).
 */

const WhatsAppService = require('../services/whatsapp.service');
const ObserveState = require('../services/observe/observe-state.service');
const { evaluateObserveTrigger, OBSERVE_TRIGGER_RX, isObserveEnabled, isSchoolLeader } = require('../services/observe/observe-gate');
const { t, observeLang } = require('../services/observe/observe-strings');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

async function markOnboarded(user) {
  const mergedPrefs = {
    ...(user.preferences || {}),
    observe_onboarded: true,
    observe_onboarded_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('users').update({ preferences: mergedPrefs }).eq('id', user.id);
  if (error) {
    // Non-fatal: they'd see onboarding again next time. Log and continue.
    logToFile('⚠️ observe: failed to persist observe_onboarded flag', { userId: user.id, error: error.message });
  }
}

/** Ask for the recording and arm the slot the audio router reads. */
async function sendCapturePrompt(user, from) {
  await WhatsAppService.sendMessage(from, t(observeLang(user), 'capture_prompt'));
  await ObserveState.setState(user.id, 'awaiting_audio');
  return true;
}

/**
 * @param {object|null} user  users row
 * @param {string} from       sender channel identity
 * @param {string} messageBody the (trimmed) inbound text
 * @returns {Promise<boolean>} handled?
 */
async function handleObserveCommand(user, from, messageBody) {
  const result = evaluateObserveTrigger({ messageBody, user });
  if (!result.match) return false;

  const lang = observeLang(user);
  logToFile('🔭 /observe command', { userId: user && user.id, from, action: result.action });

  switch (result.action) {
    case 'deny_no_user':
      await WhatsAppService.sendMessage(from, t(lang, 'no_account'));
      return true;

    case 'deny_role':
      await WhatsAppService.sendMessage(from, t(lang, 'role_denied'));
      return true;

    case 'onboard':
      // Persist the flag FIRST so a mid-flight crash can't replay the
      // one-time onboarding.
      await markOnboarded(user);
      await WhatsAppService.sendMessage(from, t(lang, 'onboard'));
      return sendCapturePrompt(user, from);

    case 'capture':
    default:
      return sendCapturePrompt(user, from);
  }
}

/**
 * The text-handler hook for coaches.
 * @returns {Promise<boolean>} handled?
 */
async function handleObserveText(user, from, text) {
  const trimmed = String(text || '').trim();
  if (OBSERVE_TRIGGER_RX.test(trimmed)) return handleObserveCommand(user, from, trimmed);
  if (!isObserveEnabled() || !isSchoolLeader(user)) return false;
  return false;
}

module.exports = { handleObserveCommand, handleObserveText, sendCapturePrompt };
