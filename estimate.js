/* Estimate mode: how many of a subject's classes have really taken place, from the real calendar.
 *
 * A subject's timetable says how many classes it has on each weekday: counts = {1: Mon .. 7: Sun}, so
 * Thursday x2 is counts[4] = 2. Between two dates (both included) every scheduled class is one of:
 *   holiday    the college was shut that day (all of that day's classes for every subject)
 *   cancelled  only this subject's class(es) were called off that day (never more than were scheduled)
 *   held       it happened: the student either attended it or missed it
 * so scheduled = holidays + cancelled + held, and a holiday or cancellation is never an absence.
 *
 * The numbers saved for an estimated subject are held (total) and held - missed (present). When the calendar
 * changes later (a past holiday added or removed, the first day of classes moved), the classes held move by the
 * difference and the classes missed stay as the student entered them: shift() below.
 *
 * Pure date maths in UTC, so a daylight-saving change can never move a day. Used by bunkke.js (window.BunkEstimate)
 * and by tests/estimate-check.js (Node).
 */
(function (root) {
  'use strict';
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, '0');
  const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const valid = s => typeof s === 'string' && DATE.test(s) && iso(toUTC(s)) === s;
  const DAY = 864e5;
  const MAX_DAYS = 1000;          // a semester is far shorter: a runaway range stops here

  // 1 = Monday .. 7 = Sunday
  function weekday(s) { return new Date(toUTC(s)).getUTCDay() || 7; }
  function addDays(s, n) { return iso(toUTC(s) + n * DAY); }

  // Every date from `from` to `to`, both included ([] when either is missing or `to` comes first)
  function dates(from, to) {
    if (!valid(from) || !valid(to) || to < from) return [];
    const out = [];
    for (let t = toUTC(from), i = 0; i < MAX_DAYS; i++, t += DAY) {
      const s = iso(t);
      if (s > to) break;
      out.push(s);
    }
    return out;
  }

  // One subject's classes between start and end (both included).
  //   counts        {1..7: classes that weekday}
  //   isHoliday     ds => true when the whole college was shut
  //   cancelledOn   ds => how many of this subject's classes were cancelled that day
  // -> { scheduled, holidays, cancelled, held }
  function countHeld({ start, end, counts, isHoliday, cancelledOn }) {
    const out = { scheduled: 0, holidays: 0, cancelled: 0, held: 0 };
    if (!counts) return out;
    for (const ds of dates(start, end)) {
      const n = Math.max(0, Math.floor(Number(counts[weekday(ds)]) || 0));
      if (!n) continue;
      out.scheduled += n;
      if (isHoliday && isHoliday(ds)) { out.holidays += n; continue; }
      const c = Math.min(n, Math.max(0, Math.floor(Number(cancelledOn ? cancelledOn(ds) : 0) || 0)));
      out.cancelled += c;
      out.held += n - c;
    }
    return out;
  }

  // The saved numbers after the classes held moved from heldBefore to heldAfter: the change goes to the total and
  // to the classes attended, the classes missed stay. When the student said they missed more classes than are now
  // held, attended stops at 0 and `missedTooHigh` says so.
  function shift(saved, heldBefore, heldAfter) {
    const delta = heldAfter - heldBefore;
    const total = Math.max(0, saved.total + delta);
    const present = Math.min(total, Math.max(0, saved.present + delta));
    return { total, present, delta, missedTooHigh: saved.present + delta < 0 };
  }

  // Dates grouped into stretches of consecutive days: [{ start, end, n }]
  function stretches(list) {
    const out = [];
    for (const ds of [...new Set(list)].filter(valid).sort()) {
      const g = out[out.length - 1];
      if (g && addDays(g.end, 1) === ds) { g.end = ds; g.n++; }
      else out.push({ start: ds, end: ds, n: 1 });
    }
    return out;
  }

  const api = { valid, weekday, addDays, dates, countHeld, shift, stretches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BunkEstimate = api;
})(typeof window !== 'undefined' ? window : globalThis);
