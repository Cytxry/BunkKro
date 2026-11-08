// Day Order calendar (day-order.js), run in Node:  node tests/day-order-check.js
'use strict';
const DO = require('../day-order.js');
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const days = (cal, from, to, hol) => {
  const m = DO.range(cal, to, hol);
  return [...m.entries()].filter(([d]) => d >= from).map(([d, n]) => `${d.slice(5)}:${n}`);
};
// 2026-11-02 is a Monday
const cal = { kind: 'day_order', start: '2026-11-02', length: 6, workingDays: [1, 2, 3, 4, 5, 6], overrides: {} };

eq('Day 1 stays Day 1 (never a weekday)', DO.dayFor('2026-11-02', cal), 1);
eq('a 6-day cycle over a Mon-Sat week, Sunday off', days(cal, '2026-11-02', '2026-11-10'),
  ['11-02:1', '11-03:2', '11-04:3', '11-05:4', '11-06:5', '11-07:6', '11-08:0', '11-09:1', '11-10:2']);
eq('before Day 1: no classes', DO.dayFor('2026-11-01', cal), 0);
// a holiday doesn't use up a Day: the next working day takes it
const hol = d => d === '2026-11-04';
eq('holiday shifts the cycle', days(cal, '2026-11-03', '2026-11-06', hol), ['11-03:2', '11-04:0', '11-05:3', '11-06:4']);
// cycle transition across a weekend, 5-day week, 5-day cycle
const five = { ...cal, length: 5, workingDays: [1, 2, 3, 4, 5] };
eq('5 working days, 5-day cycle: Monday is Day 1 again', days(five, '2026-11-06', '2026-11-09'), ['11-06:5', '11-07:0', '11-08:0', '11-09:1']);
// 6-day cycle on a 5-day week: Day 6 falls on the next Monday
const six5 = { ...cal, workingDays: [1, 2, 3, 4, 5] };
eq('6-day cycle on a 5-day week', days(six5, '2026-11-06', '2026-11-10'), ['11-06:5', '11-07:0', '11-08:0', '11-09:6', '11-10:1']);
// the college announces "Thursday follows Day 2": the cycle continues from it
const ov = { ...cal, overrides: { '2026-11-05': 2 } };
eq('an override sets the day and the cycle continues', days(ov, '2026-11-04', '2026-11-07'), ['11-04:3', '11-05:2', '11-06:3', '11-07:4']);
// "no classes" on a working day: doesn't use up a Day
const none = { ...cal, overrides: { '2026-11-03': 0 } };
eq('a no-classes date', days(none, '2026-11-02', '2026-11-04'), ['11-02:1', '11-03:0', '11-04:2']);
// an override on a Sunday makes it a working day
eq('Sunday made a class day', days({ ...cal, overrides: { '2026-11-08': 1 } }, '2026-11-07', '2026-11-09'), ['11-07:6', '11-08:1', '11-09:2']);
// a long run (one pass): 2 Nov 2026 .. 21 May 2027 is 201 days, 28 of them Sundays -> 173 class days
const far = DO.range(cal, '2027-05-21');
eq('long range', [...far.values()].filter(Boolean).length, 173);
// bad calendars are refused, not guessed
eq('bad calendar: no Day', DO.dayFor('2026-11-03', { ...cal, length: 9 }), 0);
eq('problems explain it', DO.problems({ kind: 'day_order', start: '2026-02-30', length: 1, workingDays: [], overrides: { x: 2 } }).length, 4);
eq('a good calendar has none', DO.problems(cal), []);
eq('label', DO.label(3), 'Day 3');
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
