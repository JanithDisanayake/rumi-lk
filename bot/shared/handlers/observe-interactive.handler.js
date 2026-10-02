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
 *   observe_menu_* / observe_pend_*      the /observe menu (observe-menu.service)
 *   observe_v* / observe_sched* / observe_s{start,move,cancel}_
 *                            visit picker, dates, my schedule (observe-visit.service)
 *   observe_retry_<id>       run a stopped observation again (observe-resume.service)
 *   observe_bind_<token>_*   whose recording is this? (observe-binding.service)
 *
 * The table is matched LONGEST prefix first (sorted below), so a family whose
 * prefix extends another's can be added anywhere in the list.
 *
 * @returns {Promise<boolean>} true when the id was ours and has been handled
 */

const { logToFile } = require('../utils/logger');

const ROUTES = [
  ['observe_ok_', async () => true],
  ['observe_cancel_yes_', (user, from, rest) => require('../services/observe/observe-capture.service').cancelObservation(user, from, rest)],
  ['observe_cancel_', (user, from, rest) => require('../services/observe/observe-capture.service').askCancel(user, from, rest)],
  ['observe_who_', (user, from, rest, id) => require('../services/observe/observe-who.service').handleObservedTeacherPick(user, from, id)],
  // ── the menu ──
  ['observe_menu_new', (user, from) => menu().onNewTap(user, from)],
  ['observe_menu_sched', (user, from) => visit().sendMySchedule(user, from, 0)],
  ['observe_menu_plan', (user, from) => visit().startPicker(user, from, 'p')],
  ['observe_menu_more_', (user, from, rest) => menu().onMoreTap(user, from, rest)],
  ['observe_pend_', (user, from, rest) => menu().onPendingTap(user, from, rest)],
  ['observe_retry_', (user, from, rest) => require('../services/observe/observe-resume.service').runRetry(rest, from, user)],
  // ── picker, dates, schedule ──
  ['observe_vs_', (user, from, rest) => visit().onSchoolTap(user, from, rest)],
  ['observe_vsmore_', (user, from, rest) => visit().onSchoolMoreTap(user, from, rest)],
  ['observe_vt_', (user, from, rest) => visit().onTeacherTap(user, from, rest)],
  ['observe_vtmore_', (user, from, rest) => visit().onTeacherMoreTap(user, from, rest)],
  ['observe_vskip', (user, from) => visit().onSkipTap(user, from)],
  ['observe_vd_', (user, from, rest) => visit().onDateTap(user, from, rest)],
  ['observe_vdtype_', (user, from, rest) => visit().onTypeDateTap(user, from, rest)],
  ['observe_sched_', (user, from, rest) => visit().onScheduleRowTap(user, from, rest)],
  ['observe_schedmore_', (user, from, rest) => visit().onScheduleMoreTap(user, from, rest)],
  ['observe_sstart_', (user, from, rest) => visit().onScheduleStartTap(user, from, rest)],
  ['observe_smove_', (user, from, rest) => visit().onScheduleMoveTap(user, from, rest)],
  ['observe_scancel_', (user, from, rest) => visit().onScheduleCancelTap(user, from, rest)],
  // ── whose recording is this? ("another teacher" opens the picker in bind mode) ──
  ['observe_bind_', (user, from, rest) => {
    const Binding = require('../services/observe/observe-binding.service');
    const otherToken = Binding.parseOtherTap(rest);
    if (otherToken) return visit().startBindPicker(user, from, otherToken);
    return Binding.onBindTap(user, from, rest);
  }],
].sort((a, b) => b[0].length - a[0].length);

function menu() { return require('../services/observe/observe-menu.service'); }
function visit() { return require('../services/observe/observe-visit.service'); }

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
