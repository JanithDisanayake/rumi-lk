'use strict';
/**
 * How long a recording must be before Rumi treats it as a classroom lesson (and starts coaching) rather than a voice
 * note was a 15-minute constant written in two places. It is now one setting, COACHING_MIN_AUDIO_SECONDS, default
 * 900 (unchanged): a deployment whose teachers record shorter segments can lower it, and short synthetic lessons can
 * exercise the coaching flow end to end.
 */
const { classroomAudioThresholdSeconds } = require('../../../bot/shared/config/coaching-audio');
const fs = require('fs');
const path = require('path');

describe('classroomAudioThresholdSeconds', () => {
  const saved = process.env.COACHING_MIN_AUDIO_SECONDS;
  afterEach(() => { if (saved === undefined) delete process.env.COACHING_MIN_AUDIO_SECONDS; else process.env.COACHING_MIN_AUDIO_SECONDS = saved; });

  test('unset → 900 seconds, as before', () => {
    delete process.env.COACHING_MIN_AUDIO_SECONDS;
    expect(classroomAudioThresholdSeconds()).toBe(900);
  });

  test('a deployment can lower or raise it', () => {
    process.env.COACHING_MIN_AUDIO_SECONDS = '180';
    expect(classroomAudioThresholdSeconds()).toBe(180);
  });

  test('junk, or anything under a minute, falls back to 900 (a voice note must never start a coaching session)', () => {
    for (const v of ['abc', '-5', '0', '30']) {
      process.env.COACHING_MIN_AUDIO_SECONDS = v;
      expect(classroomAudioThresholdSeconds()).toBe(900);
    }
  });

  test('both classroom-audio checks read the setting (voice note and audio sent as a document)', () => {
    const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
    for (const p of ['bot/shared/handlers/voice-message.handler.js', 'bot/whatsapp-bot.js']) {
      const src = read(p);
      expect(src).toContain('classroomAudioThresholdSeconds()');
      expect(src).not.toMatch(/CLASSROOM_AUDIO_THRESHOLD = 900/);
    }
  });
});
