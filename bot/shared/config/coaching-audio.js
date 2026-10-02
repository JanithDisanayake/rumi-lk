/**
 * When is a recording a classroom lesson?
 *
 * Audio at least COACHING_MIN_AUDIO_SECONDS long (default 900, 15 minutes) starts the coaching flow; anything
 * shorter is a voice note. One setting, read by both entry points (a voice message, and audio sent as a document).
 * Values under a minute are refused: a voice note must never start a coaching session.
 */
const DEFAULT_SECONDS = 900;
const MIN_SECONDS = 60;

function classroomAudioThresholdSeconds() {
  const n = Math.floor(Number(process.env.COACHING_MIN_AUDIO_SECONDS));
  return Number.isFinite(n) && n >= MIN_SECONDS ? n : DEFAULT_SECONDS;
}

module.exports = { classroomAudioThresholdSeconds, DEFAULT_SECONDS };
