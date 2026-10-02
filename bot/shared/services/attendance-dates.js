/**
 * Attendance dates — which day a mark belongs to, and which month a register holds.
 *
 * Every date here is a plain 'YYYY-MM-DD' string, and the arithmetic is done on the
 * string. `new Date('2026-09-30').getDate()` is the 29th west of UTC, and
 * `toISOString()` of a local midnight is the day before east of it — both shipped as
 * bugs in this feature (a register a column off; a month whose last day fell out of
 * the query). A date string has no timezone to get wrong.
 *
 * "Today" is the school's today, in ATTENDANCE_TZ (an IANA zone, default UTC): a
 * teacher marking at 08:00 must not be filed under yesterday because the server
 * runs on UTC.
 */

const DEFAULT_TZ = 'UTC';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

/** The configured timezone, or UTC when it is unset or not a real zone. */
function attendanceTimeZone() {
  const tz = (process.env.ATTENDANCE_TZ || '').trim() || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** The calendar day an instant falls on in the school's timezone. */
function localDateString(instant = new Date(), timeZone = attendanceTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today, for the school. */
function todayString(now = new Date()) {
  return localDateString(now);
}

function isValidDateString(value) {
  const m = ISO_DATE.exec(String(value || ''));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Whatever a caller holds — a 'YYYY-MM-DD' string, a Date, nothing — as the day it
 * means. A string is trusted as written; a Date is read in the school's timezone.
 */
function toDateString(value, now = new Date()) {
  if (typeof value === 'string' && isValidDateString(value.slice(0, 10))) return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateString(value);
  return todayString(now);
}

/** First and last calendar day of the month a date falls in. */
function monthBounds(dateString) {
  const [year, month] = String(dateString).split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(last)}`,
  };
}

function shiftDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The day named in an attendance request, or null when none is named.
 *
 *   "attendance yesterday"         → yesterday
 *   "attendance 2026-09-30"        → that day
 *   "attendance 30 sep" / "sep 30" → that day this year (last year if it would be ahead)
 *   "attendance 30/9"              → day/month, this year (same rule)
 *
 * Returns { date } or { error } — a future day, or one too far back to be a
 * correction (ATTENDANCE_MAX_BACKDATE_DAYS, default 62), is refused rather than guessed.
 */
function parseRequestedDate(text, now = new Date()) {
  const lower = String(text || '').toLowerCase();
  const today = todayString(now);
  let date = null;

  if (/\byesterday\b|\bkal\b/.test(lower)) date = shiftDays(today, -1);
  else if (/\btoday\b|\baaj\b/.test(lower)) date = today;

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(lower);
  if (!date && iso) date = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const thisYear = Number(today.slice(0, 4));
  const inPast = (m, d) => {
    const candidate = `${thisYear}-${pad(m)}-${pad(d)}`;
    return candidate > today ? `${thisYear - 1}-${pad(m)}-${pad(d)}` : candidate;
  };

  if (!date) {
    const named = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})[a-z]*\\b`).exec(lower)
      || new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(lower);
    if (named) {
      const dayFirst = /^\d/.test(named[1]);
      const d = Number(dayFirst ? named[1] : named[2]);
      const m = MONTHS.indexOf((dayFirst ? named[2] : named[1]).slice(0, 3)) + 1;
      date = inPast(m, d);
    }
  }

  if (!date) {
    const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
    if (slash) {
      const [, d, m, y] = slash;
      if (y) date = `${y.length === 2 ? `20${y}` : y}-${pad(m)}-${pad(d)}`;
      else date = inPast(Number(m), Number(d));
    }
  }

  if (!date) return null;
  if (!isValidDateString(date)) return { error: 'invalid' };
  if (date > today) return { error: 'future' };

  const maxBack = Number(process.env.ATTENDANCE_MAX_BACKDATE_DAYS) || 62;
  if (date < shiftDays(today, -maxBack)) return { error: 'too_old', maxBack };
  return { date };
}

/** "Wednesday 30 September 2026" — what a teacher reads back. */
function formatDisplayDate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  // Built by hand rather than toLocaleDateString: ICU versions disagree on the comma.
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

module.exports = {
  attendanceTimeZone,
  localDateString,
  todayString,
  toDateString,
  isValidDateString,
  monthBounds,
  shiftDays,
  parseRequestedDate,
  formatDisplayDate,
};
