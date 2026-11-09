/* Day Order calendars (Option A): a college whose timetable is "Day 1 .. Day N" in rotation, not Monday .. Friday.
 *
 * A Day Order is never turned into a weekday. The timetable keeps its days as Day 1 .. Day N (slot.day = N), and
 * which Day a date is comes from the college's own calendar:
 *   cal = { kind: 'day_order',
 *           start: '2026-07-01',        the date that was Day 1
 *           length: 6,                  days in the cycle (2 .. 7)
 *           workingDays: [1,2,3,4,5,6], weekdays the college works (1 = Monday .. 7 = Sunday)
 *           overrides: { '2026-08-14': 3, '2026-09-02': 0 } }
 *                                       a date the college announced: "follows Day 3", or 0 = no classes
 * The cycle moves on by one on every working day that isn't a holiday. A holiday or a "no classes" date doesn't
 * use up a Day: the next working day takes it. An override sets that date's Day; the cycle continues after it.
 */
(function (root) {
  'use strict';
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  // what is wrong with a calendar, in plain words ([] when it is fine)
  function problems(cal) {
    const out = [];
    if (!cal || cal.kind !== 'day_order') return ['not a Day Order calendar'];
    if (!DATE.test(cal.start || '') || iso(parse(cal.start)) !== cal.start) out.push('the date of Day 1 is missing or not a real date');
    if (!Number.isInteger(cal.length) || cal.length < 2 || cal.length > 7) out.push('the cycle must have 2 to 7 days');
    const wd = cal.workingDays || [];
    if (!wd.length || wd.some(d => !Number.isInteger(d) || d < 1 || d > 7)) out.push('pick the weekdays your college works');
    for (const [date, n] of Object.entries(cal.overrides || {})) {
      if (!DATE.test(date) || iso(parse(date)) !== date) out.push(`${date} is not a date`);
      else if (!Number.isInteger(n) || n < 0 || n > (cal.length || 7)) out.push(`${date}: Day ${n} is not in the cycle`);
    }
    return out;
  }

  // date -> Day (1 .. N, or 0: no classes) for every date from Day 1 up to `until`, in one pass
  function range(cal, until, isHoliday) {
    const out = new Map();
    if (problems(cal).length || !DATE.test(until || '') || until < cal.start) return out;
    const work = new Set(cal.workingDays);
    const own = Object.prototype.hasOwnProperty;
    let next = 1;
    for (const d = parse(cal.start), end = parse(until); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = iso(d);
      let day = 0;
      if (cal.overrides && own.call(cal.overrides, ds)) {
        day = cal.overrides[ds];                          // announced by the college: Day N, or 0
        if (day) next = day % cal.length + 1;
      } else if (work.has(d.getDay() || 7) && !(isHoliday && isHoliday(ds))) {
        day = next;
        next = next % cal.length + 1;
      }
      out.set(ds, day);
    }
    return out;
  }

  // the Day of one date (0: no classes that day, or before Day 1)
  function dayFor(dateStr, cal, isHoliday) {
    return range(cal, dateStr, isHoliday).get(dateStr) || 0;
  }

  const api = { dayFor, range, problems, label: n => `Day ${n}` };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BunkDayOrder = api;
})(typeof window !== 'undefined' ? window : this);
