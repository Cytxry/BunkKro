/* BunkKro XSS regression test. Run on a local copy, signed out (nothing is saved):
 *     const s = document.createElement('script'); s.src = 'tests/xss-check.js'; document.body.append(s);
 *     await new Promise(r => s.onload = r); await window.__xssCheck
 * Puts attack strings in every text a student or a timetable file controls (subject names and codes, class names,
 * the text read from a timetable, a holiday note, an import's reasons), renders every page and the dialogs that
 * show them, and checks that nothing ran and no injected element or attribute reached the page.
 * Returns { passed, failed, failures }.
 */
window.__xssCheck = (async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.__xssFired = 0;
  const P = [
    '<img src=x onerror="window.__xssFired++">',
    '"><svg onload="window.__xssFired++">',
    "'); window.__xssFired++; ('",
    '<a href="javascript:window.__xssFired++">x</a>',
    '<b data-on-click="toggleTheme()">bold</b>',             // the site's own handler attribute, smuggled in text
    '${window.__xssFired++}',
  ];
  const saved = { subjects, timetable, dateExceptions };
  const results = [];
  try {
    subjects = P.map((p, i) => ({ id: `xss-${i}`, name: p, code: p, present: 3, total: 4, perWeek: 2, mode: 'exact' }));
    timetable = P.map((p, i) => ({ id: `xss-slot-${i}`, day: (i % 5) + 1, period: 1 + Math.floor(i / 5), startTime: `0${8 + i}:00`.slice(-5),
      endTime: `0${9 + i}:00`.slice(-5), subjectId: `xss-${i}`, subjectName: p, rawText: p, isBreak: false,
      isUncertain: i % 2 === 0, reviewReasons: [p] }));
    dateExceptions = { '2026-11-20': { type: 'holiday', note: P[0] } };
    for (const page of ['home', 'tracker', 'timetable']) {
      try { goPage(page); } catch (e) { /* page needs more state */ }
      renderAll();
      await wait(150);
    }
    for (let i = 0; i < P.length; i++) { try { goPage('subject', `xss-${i}`); await wait(80); } catch (e) { /* */ } }
    try { openEditSlotModal('xss-slot-0'); await wait(120); closeSlotEditModal(); } catch (e) { /* */ }
    try { toast(P[0]); } catch (e) { /* */ }
    if (window.BunkKroAI && BunkKroAI.issues) BunkKroAI.issues(timetable, { status: 'partial', reasons: [P[1]] });
    await wait(300);
    const injected = [...document.querySelectorAll('img[src="x"], svg[onload], a[href^="javascript:"], [onerror], [onload]')]
      .filter(el => !el.closest('script'));
    const smuggled = [...document.querySelectorAll('b[data-on-click]')];
    results.push({ name: 'no attack string ran', ok: window.__xssFired === 0, got: window.__xssFired });
    results.push({ name: 'no injected element or handler attribute', ok: injected.length === 0, got: injected.map(e => e.outerHTML.slice(0, 80)) });
    results.push({ name: 'no smuggled data-on-* element', ok: smuggled.length === 0, got: smuggled.length });
    results.push({ name: 'attack strings shown as text', ok: document.body.textContent.includes('<img src=x'), got: null });
  } finally {
    subjects = saved.subjects; timetable = saved.timetable; dateExceptions = saved.dateExceptions;
    renderAll();
  }
  const failed = results.filter(r => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, failures: failed };
})();
