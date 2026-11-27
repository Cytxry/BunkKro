// Estimate mode with past holidays (estimate.js), run in Node:  node tests/estimate-check.js
'use strict';
const E = require('../estimate.js');
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const days = (o = {}) => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, ...o });
const set = list => ds => new Set(list).has(ds);
const held = (start, end, counts, hol = [], cancel = {}) =>
  E.countHeld({ start, end, counts, isHoliday: set(hol), cancelledOn: ds => cancel[ds] || 0 });
// The rule everything must keep: total = present + absent + left, and held = present + absent
const identity = (name, { held: h, missed, left }) => {
  const present = h - missed, total = h + left;
  eq(name + ': total = present + absent + left', total, present + missed + left);
};

// 2026-11-02 is a Monday. Two weeks: 2 Nov (Mon) .. 15 Nov (Sun)
const S = '2026-11-02', T = '2026-11-15';
const maths = days({ 1: 1, 3: 1, 5: 1 });             // Mon, Wed, Fri
const physics = days({ 2: 1, 4: 1 });                 // Tue, Thu
const prog = days({ 1: 1, 2: 1, 4: 1 });              // Mon, Tue, Thu
const double = days({ 1: 1, 2: 1, 3: 1, 4: 2 });      // Thursday x2

eq('weekday: 2 Nov 2026 is a Monday', E.weekday('2026-11-02'), 1);
eq('weekday: 8 Nov 2026 is a Sunday', E.weekday('2026-11-08'), 7);

// 1. no holidays
eq('1 no holidays: Maths 6 in two weeks', held(S, T, maths), { scheduled: 6, holidays: 0, cancelled: 0, held: 6 });
// 2. one holiday on a scheduled weekday (Wed 4 Nov)
eq('2 holiday on a Maths day', held(S, T, maths, ['2026-11-04']).held, 5);
// 3. one holiday on an unscheduled weekday (Tue 3 Nov is not a Maths day)
eq('3 holiday on a non-Maths day', held(S, T, maths, ['2026-11-03']).held, 6);
// 4/6. multiple college-wide holidays, judged per subject: Mon 2, Tue 3, Fri 6, Sat 7, Sun 8
const five = ['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-07', '2026-11-08'];
eq('4 five holidays: Maths loses 2 (Mon, Fri), not 5', held(S, T, maths, five).held, 4);
eq('4 five holidays: Physics loses 1 (Tue)', held(S, T, physics, five).held, 3);
eq('4 five holidays: Programming loses 2 (Mon, Tue)', held(S, T, prog, five).held, 4);
// 5. consecutive range Wed 4 .. Fri 6
eq('5 range Wed-Fri', held(S, T, maths, E.dates('2026-11-04', '2026-11-06')), { scheduled: 6, holidays: 2, cancelled: 0, held: 4 });
// 7. subject-specific cancellation: only that subject
eq('7 Maths cancelled Wed 4 Nov', held(S, T, maths, [], { '2026-11-04': 1 }), { scheduled: 6, holidays: 0, cancelled: 1, held: 5 });
eq('7 Physics untouched by a Maths cancellation', held(S, T, physics).held, 4);
// 8. double classes: a Thursday holiday removes both
eq('8 Thursday x2: 10 a fortnight', held(S, T, double).held, 10);
eq('8 Thursday holiday removes 2', held(S, T, double, ['2026-11-05']), { scheduled: 10, holidays: 2, cancelled: 0, held: 8 });
eq('8 one of two Thursday classes cancelled', held(S, T, double, [], { '2026-11-05': 1 }).held, 9);
eq('8 cancellations never exceed what was scheduled', held(S, T, double, [], { '2026-11-05': 5 }).held, 8);
// 9. duplicate dates count once
eq('9 duplicate holiday dates', held(S, T, maths, ['2026-11-04', '2026-11-04']).held, 5);
eq('9 holiday + cancellation on the same day: deducted once', held(S, T, maths, ['2026-11-04'], { '2026-11-04': 1 }),
  { scheduled: 6, holidays: 1, cancelled: 0, held: 5 });
eq('9 overlapping ranges', held(S, T, maths, [...E.dates('2026-11-02', '2026-11-04'), ...E.dates('2026-11-04', '2026-11-06')]).held, 3);
// 10. removing a holiday puts the class back
eq('10 remove: back to 6', held(S, T, maths, []).held, 6);
// 11/12. holidays after the counted range, or before the semester, change nothing
eq('11 future holiday ignored for held', held(S, T, maths, ['2026-11-18']).held, 6);
eq('12 holiday before the semester ignored', held(S, T, maths, ['2026-10-30']).held, 6);
// 13. no classes scheduled
eq('13 no days', held(S, T, days()).held, 0);
eq('13 no counts at all', held(S, T, null).held, 0);
eq('13 end before start', held(T, S, maths).held, 0);
eq('13 bad dates', held('2026-02-30', T, maths).held, 0);
// 17. semester start moved
eq('17 start a week later', held('2026-11-09', T, maths).held, 3);

// shift(): the saved numbers move with the classes held, the classes missed stay
// 6 held, 2 missed -> 6/4; a holiday takes one away -> 5 held, still 2 missed, 3 present
eq('shift: holiday added', E.shift({ total: 6, present: 4 }, 6, 5), { total: 5, present: 3, delta: -1, missedTooHigh: false });
eq('shift: holiday removed', E.shift({ total: 5, present: 3 }, 5, 6), { total: 6, present: 4, delta: 1, missedTooHigh: false });
// classes marked later on Daily Classes (10/12 now) are kept
eq('shift: later marks kept', E.shift({ total: 12, present: 10 }, 6, 5), { total: 11, present: 9, delta: -1, missedTooHigh: false });
// 14. missed = held: 0% and fine
eq('14 missed equals held', E.shift({ total: 5, present: 0 }, 5, 5), { total: 5, present: 0, delta: 0, missedTooHigh: false });
// 15. holidays leave fewer held than missed: flagged, present stops at 0
eq('15 missed more than held', E.shift({ total: 5, present: 1 }, 5, 3), { total: 3, present: 0, delta: -2, missedTooHigh: true });

// the rule, after every kind of change
for (const [name, h] of [['no holidays', 6], ['one holiday', 5], ['range', 4], ['double + holiday', 8]]) {
  identity(name, { held: h, missed: 2, left: 30 });
}
{ // a timetable-derived semester: Maths over 4 weeks (12 classes), 1 past + 1 future holiday, 2 missed
  const all = held('2026-11-02', '2026-11-29', maths, ['2026-11-04', '2026-11-20']);
  const past = held('2026-11-02', '2026-11-15', maths, ['2026-11-04', '2026-11-20']);
  const left = held('2026-11-16', '2026-11-29', maths, ['2026-11-04', '2026-11-20']);
  eq('semester: 12 scheduled, 2 on holidays', [all.scheduled, all.holidays, all.held], [12, 2, 10]);
  eq('semester: adjusted total = held so far + left', all.held, past.held + left.held);
  identity('semester', { held: past.held, missed: 2, left: left.held });
}

// stretches(): the picked list shown as ranges
eq('stretches', E.stretches(['2026-11-06', '2026-11-04', '2026-11-05', '2026-11-09', '2026-11-05']),
  [{ start: '2026-11-04', end: '2026-11-06', n: 3 }, { start: '2026-11-09', end: '2026-11-09', n: 1 }]);
// dates across a daylight-saving change and a month/year end stay one per day
eq('dates across DST (Europe/US late Oct, early Nov)', E.dates('2026-10-24', '2026-11-03').length, 11);
eq('dates across a year end', E.dates('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
eq('leap day', E.dates('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
