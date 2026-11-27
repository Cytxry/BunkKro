/* Estimate mode with past holidays: the real flows, end to end, in the browser.
 *
 * Run on a local copy, SIGNED OUT, in the console (nothing reaches Supabase: the client is swapped for an in-memory
 * stand-in that records what would be written, and everything is put back afterwards):
 *     const s = document.createElement('script'); s.src = 'tests/estimate-workflow.js'; document.body.append(s);
 *     await new Promise(r => s.onload = r); await window.__estimateWorkflow
 * Returns { passed, failed, failures, writes }.
 */
window.__estimateWorkflow = (async () => {
  if (currentUser) return { error: 'sign out first: this test swaps in its own data' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const eq = (name, got, want) => results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const saved = { subjects, timetable, semStart, semEnd, semWeeks, globalTarget, dateExceptions, dailyPeriodLogs, countedUpTo,
                  roundMode, supabaseClient, currentUser, ls: { ...localStorage } };

  // ── an in-memory Supabase that records writes ──
  const writes = [];
  const q = table => {
    const op = { table, kind: 'select', filters: {} };
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; }, single() { return api; },
      eq(k, v) { op.filters[k] = v; return api; }, in(k, v) { op.filters[k] = v; return api; },
      insert(rows) { op.kind = 'insert'; op.rows = rows; writes.push(op); return api; },
      upsert(rows) { op.kind = 'upsert'; op.rows = rows; writes.push(op); return api; },
      update(row) { op.kind = 'update'; op.rows = row; writes.push(op); return api; },
      delete() { op.kind = 'delete'; writes.push(op); return api; },
      then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
    };
    return api;
  };
  supabaseClient = { from: q, auth: { updateUser: async () => ({ data: { user: currentUser }, error: null }) } };
  currentUser = { id: 'test-user', user_metadata: {} };

  // ── the dates: a semester that started on the Monday four weeks before this week's Monday ──
  const iso = d => getLocalDateString(d);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const day = (weeksBack, wd) => { const d = new Date(monday); d.setDate(monday.getDate() - weeksBack * 7 + (wd - 1)); return iso(d); };
  const start = day(4, 1), yest = dayOffset(-1);
  // independent count (plain local dates, no estimate.js): classes from start to end on the given weekdays
  const brute = (counts, from, to, skip = []) => {
    let n = 0;
    for (const d = new Date(from + 'T12:00:00'); iso(d) <= to; d.setDate(d.getDate() + 1)) {
      if (skip.includes(iso(d))) continue;
      n += counts[d.getDay() || 7] || 0;
    }
    return n;
  };
  const C = { maths: { 1: 1, 3: 1, 5: 1 }, physics: { 2: 1, 4: 1 }, prog: { 1: 1, 2: 1, 4: 1 }, dbl: { 1: 1, 2: 1, 3: 1, 4: 2 } };
  const tt = [];
  for (const [id, c] of Object.entries(C)) for (const [wd, n] of Object.entries(c)) for (let k = 0; k < n; k++)
    tt.push({ id: `tt-${id}-${wd}-${k}`, day: +wd, period: tt.length + 1, startTime: '', endTime: '', subjectId: id, subjectName: id, isBreak: false });
  timetable = tt;
  semStart = start; semEnd = ''; semWeeks = 16; globalTarget = 75; roundMode = 'down'; dateExceptions = {}; dailyPeriodLogs = {};
  countedUpTo = {};
  const est = (id, missed) => { const h = brute(C[id], start, yest); return { id, name: id, code: '', total: h, present: h - missed, perWeek: 0, target: null, semTotal: null, mode: 'estimate' }; };
  subjects = [est('maths', 2), est('physics', 1), est('prog', 3), est('dbl', 0),
              { id: 'exact', name: 'exact', code: '', total: 20, present: 17, perWeek: 0, target: null, semTotal: 40, mode: 'exact' }];
  subjects.forEach(s => { countedUpTo[s.id] = yest; });
  const S = id => subjects.find(s => s.id === id);
  const snap = () => Object.fromEntries(subjects.map(s => [s.id, [s.present, s.total - s.present, s.total]]));
  const base = snap();

  // 1. the form works out the same held count as the saved numbers (no holidays)
  for (const id of Object.keys(C)) {
    const r = checkSubjectForm({ mode: 'estimate', name: id + 'x', semStart: start, perWeek: 3, days: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, ...C[id] }, missed: 1 }, id);
    eq(`1 form held = timetable count (${id})`, r.values?.total, brute(C[id], start, yest));
  }

  // pick two past holidays: last week's Wednesday and Thursday
  const wed = day(1, 3), thu = day(1, 4);
  goPage('subject', 'maths'); await wait(250);
  document.getElementById('edit-card').open = true;
  setEditMode('estimate');
  openPastDays('edit'); await wait(50);
  eq('2 calendar opens on the semester so far', [pastCal.start, pastCal.end], [start, (semEnd && semEnd < yest) ? semEnd : yest]);
  eq('2 today is not pickable', pastBlocked(iso(today)), 'outside');
  eq('2 the day before the semester is not pickable', pastBlocked(day(5, 7)), 'outside');
  pastCal.sel.college.add(wed); pastCal.sel.college.add(thu); pastCal.sel.college.add(wed);   // duplicate pick
  pastPreview();
  eq('2 preview counts Maths classes on the picked days', /1 class of maths/.test(document.getElementById('past-preview').textContent), true);
  await savePastDays(); await wait(50);
  const h1 = snap();
  // Wed: maths, dbl.  Thu: physics, prog, dbl x2
  eq('3 college holidays: each subject loses only its own classes (missed unchanged)', h1, {
    maths: [base.maths[0] - 1, 2, base.maths[2] - 1], physics: [base.physics[0] - 1, 1, base.physics[2] - 1],
    prog: [base.prog[0] - 1, 3, base.prog[2] - 1], dbl: [base.dbl[0] - 3, 0, base.dbl[2] - 3], exact: base.exact });
  eq('3 holidays stored where Daily Classes keeps them', [isHolidayDate(wed), isHolidayDate(thu)], [true, true]);
  eq('3 written to timetable_exceptions', writes.filter(w => w.table === 'timetable_exceptions' && w.kind === 'upsert').map(w => w.rows.date).sort(), [wed, thu].sort());
  eq('3 a held count recomputed from scratch matches the moved numbers', estimateHeldFor(S('dbl')), brute(C.dbl, start, yest, [wed, thu]));

  // 4. a subject-only cancellation: dbl on a Thursday two weeks back (both of its Thursday classes)
  const thu2 = day(2, 4);
  goPage('subject', 'dbl'); await wait(250);
  document.getElementById('edit-card').open = true; setEditMode('estimate');
  openPastDays('edit'); pastKind('subject');
  eq('4 subject mode: a non-dbl day is blocked', pastBlocked(day(2, 5)), 'No class that day');
  eq('4 subject mode: a college holiday is blocked', pastBlocked(thu), 'College holiday');
  pastCal.sel.subject.add(thu2);
  await savePastDays(); await wait(50);
  eq('4 cancellation: only dbl moves, by its 2 Thursday classes', snap(), { ...h1, dbl: [h1.dbl[0] - 2, 0, h1.dbl[2] - 2] });
  eq('4 Daily Classes shows the cancellations', getAllClassesForDate(thu2).filter(c => c.subjectId === 'dbl').map(c => c.status), ['cancelled', 'cancelled']);
  eq('4 physics on that day is untouched', getAllClassesForDate(thu2).filter(c => c.subjectId === 'physics').map(c => c.status), [null]);
  // 5. holiday on top of a cancellation day: deducted once
  selectedTrackerDate = thu2;
  const before5 = snap();
  setTimeout(() => closeAsk(true), 80);              // "This day has 2 marked classes" -> Mark as holiday
  await toggleDateHoliday(); await wait(50);
  eq('5 Daily Classes holiday on a cancelled day: dbl not deducted again', snap().dbl, before5.dbl);
  eq('5 ...the other Thursday subjects lose that day', [snap().physics[2], snap().prog[2]], [before5.physics[2] - 1, before5.prog[2] - 1]);
  // and back. Making a day a holiday on Daily Classes clears that day's marks (its cancellations too), so with the
  // holiday gone dbl's two Thursday classes count again
  await toggleDateHoliday(); await wait(50);
  eq('5 holiday removed again: the others as before, dbl gets its 2 classes back', snap(),
    { ...before5, dbl: [before5.dbl[0] + 2, 0, before5.dbl[2] + 2] });

  // 6. removing a holiday from the calendar puts the classes back
  goPage('subject', 'maths'); await wait(250);
  document.getElementById('edit-card').open = true; setEditMode('estimate');
  openPastDays('edit');
  pastDrop(thu, thu);
  await savePastDays(); await wait(50);
  eq('6 Thursday removed: physics, prog and dbl get it back', [S('physics').total, S('prog').total, S('dbl').total],
    [h1.physics[2] + 1, h1.prog[2] + 1, h1.dbl[2] + 2]);

  // 7. the first day of classes moves a week later: every estimate loses that week, missed stays, exact stays
  const b7 = snap();
  document.getElementById('sem-start').value = day(3, 1); document.getElementById('sem-end').value = '';
  await saveSemesterDialog(); await wait(50);
  const firstWeek = id => brute(C[id], start, day(4, 7), [wed, thu2].filter(d => d <= day(4, 7)));
  eq('7 semester start +1 week', snap(), Object.fromEntries(Object.entries(b7).map(([id, [p, a, t]]) =>
    [id, id === 'exact' ? [p, a, t] : [p - firstWeek(id), a, t - firstWeek(id)]])));
  document.getElementById('sem-start').value = start;
  await saveSemesterDialog(); await wait(50);
  eq('7 and back', snap(), b7);

  // 8. more missed than held after holidays: flagged, attended stops at 0
  subjects.push({ id: 'tiny', name: 'tiny', code: '', total: 0, present: 0, perWeek: 0, target: null, semTotal: null, mode: 'estimate' });
  timetable.push({ id: 'tt-tiny', day: 5, period: 99, startTime: '', endTime: '', subjectId: 'tiny', subjectName: 'tiny', isBreak: false });
  const tinyHeld = brute({ 5: 1 }, start, yest); S('tiny').total = tinyHeld; S('tiny').present = 1; countedUpTo.tiny = yest;
  const fridays = Array.from({ length: 4 }, (_, i) => day(i + 1, 5)).filter(d => d >= start && d <= yest);
  await keepEstimatesInStep(() => { fridays.forEach(d => { dateExceptions[d] = { type: 'holiday', note: 'x' }; }); });
  eq('8 missed > held: attended stops at 0, total = held', [S('tiny').present, S('tiny').total], [0, tinyHeld - fridays.length]);
  eq('8 the toast says so', /tiny: fewer classes held/.test(document.getElementById('toast').textContent), true);
  await keepEstimatesInStep(() => { fridays.forEach(d => { delete dateExceptions[d]; }); });
  subjects = subjects.filter(s => s.id !== 'tiny'); timetable = timetable.filter(t => t.subjectId !== 'tiny');
  // undo the maths/dbl Friday losses from the shared Fridays too
  const b8 = snap();

  // 9. validation: missed > held, semester total < held
  const f9 = { mode: 'estimate', name: 'v', semStart: start, perWeek: 3, days: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0, 7: 0 } };
  const held9 = checkSubjectForm({ ...f9, missed: 0 }, 'maths').values.total;
  eq('9 missed = held is allowed (0%)', checkSubjectForm({ ...f9, missed: held9 }, 'maths').values?.present, 0);
  eq('9 missed > held is refused', /only about/.test(checkSubjectForm({ ...f9, missed: held9 + 1 }, 'maths').error || ''), true);
  eq('9 semester total < held is refused', /can't be fewer/.test(checkSubjectForm({ ...f9, missed: 0, semTotal: held9 - 1 }, 'maths').error || ''), true);
  eq('9 no days picked is refused', /Pick the days/.test(checkSubjectForm({ ...f9, perWeek: 0, days: null, missed: 0 }, 'maths').error || ''), true);

  // 10. a typed semester total is the final total: a holiday moves held and left, never the total
  S('maths').semTotal = 60;
  const t10 = S('maths').total;
  await keepEstimatesInStep(() => { dateExceptions[day(1, 1)] = { type: 'holiday', note: 'x' }; });
  const r10 = remainingInfo(S('maths'));
  eq('10 typed total: total stays 60 = present + absent + left', [S('maths').semTotal, S('maths').present + (S('maths').total - S('maths').present) + r10.n], [60, 60]);
  eq('10 held moved by one', S('maths').total, t10 - 1);
  await keepEstimatesInStep(() => { delete dateExceptions[day(1, 1)]; });
  S('maths').semTotal = null;

  // 11. no typed total: left comes from the timetable to the last day, skipping a future holiday
  semEnd = day(-3, 7);                      // three weeks after this week
  const left0 = remainingInfo(S('maths')).n;
  const nextWed = day(-1, 3);
  dateExceptions[nextWed] = { type: 'holiday', note: 'x' };
  remainingMemo = null;
  eq('11 future holiday: one Maths class fewer left, held unchanged', [remainingInfo(S('maths')).n, S('maths').total], [left0 - 1, b8.maths[2]]);
  delete dateExceptions[nextWed]; remainingMemo = null;
  // the identity on every view: total = present + absent + left
  for (const s of subjects) {
    const b = bunkPlan(s, getTarget(s));
    if (b.left === null) continue;
    eq(`11 identity ${s.id}: total = present + absent + left`, s.total + b.left, s.present + (s.total - s.present) + b.left);
  }

  // 12. every view agrees
  goPage('home'); await wait(300);
  const sum = subjects.reduce((a, s) => a + bunkable(s), 0);
  eq('12 home Safe bunks = sum of subjects', document.querySelector('#safe-card .sc-val')?.textContent.trim(), String(sum));
  goPage('subject', 'maths'); await wait(300);
  const b12 = bunkPlan(S('maths'), 75);
  eq('12 subject card line', document.getElementById('sp-held').textContent.startsWith(`${S('maths').total} classes held so far`), true);
  const tiles = [...document.querySelectorAll('#adv-text .chip.mini')].map(c => [c.querySelector('.chip-lbl').textContent.trim(), c.querySelector('.cv').textContent.trim()]);
  const sem = tiles.find(t => t[0] === 'Bunks this sem'), left = tiles.find(t => t[0] === 'Classes left');
  if (sem) eq('12 advisor tile = bunkPlan', sem[1].replace('~', ''), String(b12.semBunks));
  if (left) eq('12 advisor classes left = bunkPlan', left[1].replace('~', ''), String(b12.left));
  // 13. no tile label runs out of its tile, even at phone width
  const over = () => [...document.querySelectorAll('.chip.mini')].filter(c => {
    const l = c.querySelector('.chip-lbl').getBoundingClientRect(), r = c.getBoundingClientRect();
    return l.right > r.right + 0.5 || l.left < r.left - 0.5;
  }).length;
  eq('13 tile labels stay inside their tiles', over(), 0);

  // 14. exact subject never moved
  eq('14 exact subject untouched by everything above', snap().exact, base.exact);

  // 15. switching the edit form between Exact and Estimate: Exact keeps the saved numbers as they are
  goPage('subject', 'maths'); await wait(250);
  document.getElementById('edit-card').open = true;
  setEditMode('exact');
  const ex = checkSubjectForm(readEditForm(S('maths')), 'maths').values;
  eq('15 Exact mode: the saved numbers, untouched by holidays', [ex.mode, ex.total, ex.present], ['exact', S('maths').total, S('maths').present]);
  setEditMode('estimate');
  eq('15 back to Estimate: worked out from the calendar', checkSubjectForm(readEditForm(S('maths')), 'maths').values.total, estimateHeldByDays(semStart, C.maths, 'maths').held);

  // 16. a picked college holiday blocks that day under "only this subject" (no double deduction)
  openPastDays('edit');
  const mon2 = day(2, 1);
  pastCal.sel.college.add(mon2);
  pastKind('subject');
  eq('16 a day just picked as a holiday is not a cancellation too', pastBlocked(mon2), 'College holiday');
  closePastDays();

  // 17. the Add Subject form (no subject yet): only college holidays, and its preview follows them
  openAddModal(); await wait(50);
  selAddMode('estimate');
  document.getElementById('as-name').value = 'Newsub';
  document.getElementById('as-semstart').value = start;
  setDayPicker('as-days', { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1, 6: 0, 7: 0 });
  document.getElementById('as-missed').value = '0';
  const t0 = checkSubjectForm(readAddForm(), null).values.total;
  openPastDays('add');
  eq('17 add form: no "only this subject" option', document.getElementById('past-kind-subject').hidden, true);
  const fri3 = day(3, 5);
  pastCal.sel.college.add(fri3);
  await savePastDays(); await wait(50);
  eq('17 add form preview: one class fewer after a Friday holiday', checkSubjectForm(readAddForm(), null).values.total, t0 - 1);
  eq('17 ...and the saved Maths estimate moved with it', S('maths').total, b8.maths[2] - 1);
  openPastDays('add'); pastCal.sel.college.delete(fri3); await savePastDays(); await wait(50);
  closeAddModal();

  // put everything back
  Object.assign(window, {});
  subjects = saved.subjects; timetable = saved.timetable; semStart = saved.semStart; semEnd = saved.semEnd; semWeeks = saved.semWeeks;
  globalTarget = saved.globalTarget; dateExceptions = saved.dateExceptions; dailyPeriodLogs = saved.dailyPeriodLogs;
  countedUpTo = saved.countedUpTo; roundMode = saved.roundMode; supabaseClient = saved.supabaseClient; currentUser = saved.currentUser;
  localStorage.clear(); Object.entries(saved.ls).forEach(([k, v]) => localStorage.setItem(k, v));
  closePastDays(); goPage('home');
  const failed = results.filter(r => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, failures: failed, writes: writes.length };
})();
