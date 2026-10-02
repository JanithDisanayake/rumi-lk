/**
 * Every observe button / list tap, in one place.
 *
 * The webhook entry point hands each button_reply and list_reply id here
 * first; ids are routed by family to the step that owns them. On channels
 * without native buttons the same ids arrive through pending-options.js (the
 * coach typed "1"), so this one table serves Meta, Baileys, Matrix, Slack and
 * Discord alike.
 *
 *   observe_ok_<id>          capture ack "Okay" — nothing to do
 *   observe_cancel_yes_<id>  cancel confirmed
 *   observe_cancel_<id>      "Cancel observation" — ask first
 *   observe_who_<id>_<n>     who was observed (bare capture)
 *   observe_form_<id>        reopen the coach's rating form (pending list)
 *   observe_debrief_now_<id> "Debrief now" — build the guide, arm the recording
 *   observe_debrief_later_<id> "Later" — leave it pending in the /observe list
 *   observe_debrief_<id>     a pending-debrief row in the /observe list
 *   observe_send_<action>_<id>  send report / later / send now / someone else / cancel
 *   observe_pickt_<n|new|more_n> the report recipient pick list
 *
 * @returns {Promise<boolean>} true when the id was ours and has been handled
 */

const { logToFile } = require('../utils/logger');

const ROUTES = [
  ['observe_ok_', async () => true],
  ['observe_cancel_yes_', (user, from, rest) => require('../services/observe/observe-capture.service').cancelObservation(user, from, rest)],
  ['observe_cancel_', (user, from, rest) => require('../services/observe/observe-capture.service').askCancel(user, from, rest)],
  ['observe_form_', (user, from, rest) => require('../services/observe/observe-form.service').resume(user, from, rest)],
  ['observe_send_', (user, from, rest, id) => require('../services/observe/observe-send.service').handleSendButton(user, from, id)],
  ['observe_pickt_', (user, from, rest, id) => require('../services/observe/observe-send.service').handleTeacherPick(user, from, id)],
  ['observe_who_', (user, from, rest, id) => require('../services/observe/observe-who.service').handleObservedTeacherPick(user, from, id)],
  // Longest prefix first: the two buttons share the list row's prefix.
  ['observe_debrief_now_', (user, from, rest) => require('../services/observe/observe-debrief.service').startDebrief(rest, from, user)],
  ['observe_debrief_later_', (user, from, rest) => require('../services/observe/observe-debrief.service').handleDebriefLater(rest, from, user)],
  ['observe_debrief_', (user, from, rest) => require('../services/observe/observe-debrief.service').startDebrief(rest, from, user)],
];

async function handleObserveInteractive(user, from, id) {
  if (!user || typeof id !== 'string' || !id.startsWith('observe_')) return false;
  const route = ROUTES.find(([prefix]) => id.startsWith(prefix));
  if (!route) return false;
  try {
    return (await route[1](user, from, id.slice(route[0].length), id)) !== false;
  } catch (err) {
    logToFile('❌ observe: tap handling failed', { id, userId: user.id, error: err.message });
    return true;   // ours, even when it failed — never fall through into another feature
  }
}

module.exports = { handleObserveInteractive, ROUTES };
