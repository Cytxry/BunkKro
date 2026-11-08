/* BunkKro attendance-calculation regression tests.
 *
 * Run on the site (local copy is fine), signed out, in the browser console:
 *     await (0, eval)(await (await fetch('tests/calc-regression.js')).text())
 * It swaps in test subjects (your real data is not touched: nothing is saved while signed out), checks the shared
 * calculation (bunkPlan) against hand-worked answers, then renders every view and checks they all agree.
 * Returns { passed, failed, failures }.
 * Under the site's Content-Security-Policy (no eval), load it as a script instead; the result is then in
 * window.__calcRegression:
 *     const s = document.createElement('script'); s.src = 'tests/calc-regression.js'; document.body.append(s);
 *     await new Promise(r => s.onload = r); await window.__calcRegression
 *
 * Model under test (bunkke.js, bunkPlan): P attended, H held (P + missed), S = classes in the whole semester,
 * L = S - H left, t = target. Must attend by the end = ceil(t*S/100). Bunks over the semester = P + L - that,
 * capped to 0..L. Without S: bunks = the next classes you can miss in a row and stay >= t.
 */
window.__calcRegression = (async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const eq = (name, got, want) => results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const saved = { subjects, timetable, semStart, semEnd, globalTarget, dateExceptions, roundMode };
  roundMode = 'down';
  subjects = []; semStart = ''; semEnd = ''; globalTarget = 75; timetable = []; dateExceptions = {};   // no guess from other subjects
  const subj = (id, present, total, extra = {}) => ({ id, name: id, code: '', present, total, perWeek: 0, mode: 'exact', ...extra });
  const plan = (s, t) => { const b = bunkPlan(s, t); return [b.left, b.semBunks, b.now, b.bunks, b.mustAttend, b.reachable, b.finishAll]; };
  //                                                         [left, semBunks, now, bunks, mustAttend, reachable, finishAll]

  // 1. comfortably above target: 30/38, 57 in the semester -> must 43 -> 6 bunks over the semester, 2 in a row now
  eq('1 above target', plan(subj('a', 30, 38, { semTotal: 57 })), [19, 6, 2, 6, 13, true, 85]);
  // 2. exactly at target: 30/40 = 75%, 60 in the semester -> must 45 -> 5 bunks; none in a row now
  eq('2 exactly at target', plan(subj('b', 30, 40, { semTotal: 60 })), [20, 5, 0, 5, 15, true, 83]);
  // 3. slightly below: 29/40 = 72% -> still 4 bunks over the semester
  eq('3 slightly below', plan(subj('c', 29, 40, { semTotal: 60 })), [20, 4, 0, 4, 16, true, 81]);
  // 4. zero absences: 20/20 -> 15 over the semester, 6 in a row now
  eq('4 zero absences', plan(subj('d', 20, 20, { semTotal: 60 })), [40, 15, 6, 15, 25, true, 100]);
  // 5. many absences: 10/20 = 50% -> 5 over the semester; 20 in a row needed to get back now
  eq('5 many absences', plan(subj('e', 10, 20, { semTotal: 60 })), [40, 5, 0, 5, 35, true, 83]);
  eq('5 need in a row', needed(subj('e', 10, 20)), 20);
  // 6. no classes held yet, 60 in the semester -> 15 bunks, attend 45
  eq('6 nothing held', plan(subj('f', 0, 0, { semTotal: 60 })), [60, 15, 0, 15, 45, true, 100]);
  eq('6 nothing held, no total', bunkable(subj('f2', 0, 0)), 0);
  // 7. nothing left: 30/40 with 40 in the semester -> done at 75%
  eq('7 nothing left', plan(subj('g', 30, 40, { semTotal: 40 })), [0, 0, 0, 0, 0, true, 75]);
  // 8. semester total below what's held is not trusted: falls back (no dates, no days -> unknown)
  eq('8 total < held', bunkPlan(subj('h', 30, 40, { semTotal: 35 })).left, null);
  // 9/10. changing the total and the counts moves everything
  eq('9 total 57 -> 70', plan(subj('i', 30, 38, { semTotal: 70 })), [32, 9, 2, 9, 23, true, 88]);
  eq('10 present 30 -> 33', plan(subj('j', 33, 38, { semTotal: 57 })), [19, 9, 6, 9, 10, true, 91]);
  // 11. subject target 85%: 30/38 of 57 -> must 49 -> no bunks, attend all 19
  eq('11 target 85', plan(subj('k', 30, 38, { semTotal: 57, target: 85 }), 85), [19, 0, 0, 0, 19, true, 85]);
  // 12-14. the most you can miss: 6 of 19 still finishes at 75% (43/57); a 7th does not (42/57 = 73%)
  eq('12 max misses finish', [attPct(30 + 19 - 6, 57), attPct(30 + 19 - 7, 57)], [75, 73]);
  //        back to back, those 6 would dip you to 30/44 = 68% for a while (shown, but not the verdict)
  eq('14 back-to-back dip', attPct(30, 38 + 6), 68);
  // 15. unreachable: 14/43 of 50 -> must 38 > 21 possible -> best finish 42%
  eq('15 unreachable', plan(subj('l', 14, 43, { semTotal: 50 })), [7, 0, 0, 0, 7, false, 42]);
  // 16. nothing known about the semester: only the in-a-row count (691 at a 1% target, never capped by a guess)
  //     (a guessed semester, e.g. from other subjects' classes a week, gives a '~' left but never 'known' bunks)
  eq('16 unknown semester', plan(subj('m', 7, 9)), [null, null, 0, 0, null, null, null]);
  eq('16 1% target, 53 left caps it', plan(subj('n', 7, 9, { semTotal: 62, target: 1 }), 1), [53, 53, 53, 53, 0, true, 96]);

  // ── how the college rounds (one setting for every subject) ──
  roundMode = 'up';      // 83.3 -> 84
  eq('round up: 5/6', attPct(5, 6), 84);
  eq('round up: 149/200 (74.5%) meets 75', [attPct(149, 200), isAtRisk(subj('u1', 149, 200))], [75, false]);
  eq('round up: one bunk at 149/200 (149/201 = 74.1 -> 75; 149/202 = 73.8 -> 74)', bunkable(subj('u2', 149, 200)), 1);
  eq('round up: 10/20 needs 19 in a row (29/39 = 74.4 -> 75)', needed(subj('u3', 10, 20)), 19);
  eq('round up: semester plan', plan(subj('u4', 30, 38, { semTotal: 57 })), [19, 6, 2, 6, 13, true, 86]);
  roundMode = 'exact';   // 83.3
  eq('exact: 5/6', attPct(5, 6), 83.3);
  eq('exact: 149/200 is 74.5, under 75', [attPct(149, 200), isAtRisk(subj('x1', 149, 200))], [74.5, true]);
  eq('exact: no bunk at 149/200', bunkable(subj('x2', 149, 200)), 0);
  roundMode = 'down';    // 83.3 -> 83 (the default)
  eq('round down: 5/6 and 149/200', [attPct(5, 6), attPct(149, 200), bunkable(subj('d1', 149, 200))], [83, 74, 0]);

  // ── every view agrees ─────────────────────────────────────────────────────────────────────────────────────────
  subjects = [subj('Alpha', 30, 38, { semTotal: 57 }), subj('Beta', 7, 9, { semTotal: 62 }), subj('Gamma', 14, 43, { semTotal: 50 }), subj('Delta', 20, 25)];
  const sum = subjects.reduce((a, s) => a + bunkable(s), 0);           // 6 + 13 + 0 + 1
  eq('views: bunk sum', sum, 20);
  goPage('home'); await wait(300);
  eq('views: home Safe bunks card', document.querySelector('#safe-card .sc-val')?.textContent.trim(), String(sum));
  openSafeBunks(); await wait(200);
  eq('views: Safe Bunks dialog title', (document.getElementById('sb-title').textContent.match(/\d+/) || [])[0], String(sum));
  eq('views: Safe Bunks lists Beta (below target now, 13 by the end)', document.getElementById('sb-breakdown').textContent.includes('Beta'), true);
  closeSafeBunks();
  const rowText = name => [...document.querySelectorAll('#page-home .subj-card')].find(c => c.querySelector('.subj-card-name').textContent === name)?.querySelector('.subj-card-bunk').textContent;
  eq('views: list Alpha', rowText('Alpha'), '6 bunks left');
  eq('views: list Beta', rowText('Beta'), '13 bunks left');
  eq('views: list Gamma', rowText('Gamma'), "can't reach 75%");
  goPage('subject', 'Beta'); await wait(300);
  const adv = document.getElementById('adv-text').textContent;
  eq('views: advisor Beta has 13, no contradiction', [adv.includes('13'), /No bunks to spare/.test(document.getElementById('adv-pills').textContent)], [true, false]);
  eq('views: Beta card line', document.getElementById('sp-held').textContent, '9 classes held so far · 53 classes left');
  document.getElementById('sim-input').value = 4; updateSim();
  const sim = document.getElementById('sim-result').textContent;
  eq('views: simulator Beta skip 4 finishes above 75%', [sim.includes('at the end'), /under 75%/.test(sim)], [true, false]);
  document.getElementById('sim-input').value = 14; updateSim();
  eq('views: simulator Beta skip 14 finishes under', /under 75%|gone/.test(document.getElementById('sim-result').textContent), true);
  document.getElementById('sim-input').value = 0; updateSim();
  goPage('subject', 'Alpha'); await wait(300);
  document.getElementById('sim-input').value = 6; updateSim();
  const sim6 = document.getElementById('sim-result').textContent;
  eq('views: simulator Alpha skip 6 = still 75%, dips 68% back to back', [sim6.includes('75% at the end'), sim6.includes('68%')], [true, true]);
  document.getElementById('sim-input').value = 0; updateSim();

  Object.assign(window, {});
  subjects = saved.subjects; timetable = saved.timetable; semStart = saved.semStart; semEnd = saved.semEnd;
  globalTarget = saved.globalTarget; dateExceptions = saved.dateExceptions; roundMode = saved.roundMode;
  goPage('home');
  const failed = results.filter(r => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, failures: failed };
})();
