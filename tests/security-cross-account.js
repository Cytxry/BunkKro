/* BunkKro two-account isolation test (M10.5). ONLY with two disposable TEST accounts, never real students'.
 *
 * Under the site's Content-Security-Policy, load it as a script (no eval):
 *     const s = document.createElement('script'); s.src = 'tests/security-cross-account.js'; document.body.append(s);
 *     await new Promise(r => s.onload = r); await window.__crossAccount
 *
 * Step 1, signed in as test account A: it creates one disposable subject, timetable and import of its own (named
 *   "xacct-probe"), and prints A's ids. Copy the line it prints.
 * Step 2, sign out, sign in as test account B, then:  window.__xacctTarget = <the line from step 1>  and load the
 *   script again. As B it tries, against A's rows: read them; update and delete them (by id, only A's probe rows);
 *   insert B-owned rows that point at A's timetable / subject / import. Every one must be refused or reach nothing.
 * Step 3, signed in as A again, with window.__xacctCleanup = true: it deletes A's probe rows and checks they were
 *   untouched by B (name and counts unchanged).
 * B's own probe rows that were wrongly accepted are deleted at once and reported as FAIL.
 * Returns { passed, failed, results }.
 */
window.__crossAccount = (async () => {
  if (!currentUser) throw new Error('Sign in as a TEST account first.');
  const me = currentUser.id;
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  const db = supabaseClient;
  const PROBE = 'xacct-probe';
  const target = window.__xacctTarget;

  if (window.__xacctCleanup) {                        // step 3, as A
    const { data: subs } = await db.from('subjects').select('id,name,total,present').eq('user_id', me).eq('name', PROBE);
    check('A: probe subject unchanged by B', (subs || []).length === 1 && subs[0].total === 0 && subs[0].present === 0,
      JSON.stringify(subs));
    await db.from('timetable_imports').delete().eq('user_id', me).eq('engine_version', PROBE);
    await db.from('subjects').delete().eq('user_id', me).eq('name', PROBE);
    await db.from('timetables').delete().eq('user_id', me).eq('title', PROBE);
    const { data: left } = await db.from('subjects').select('id').eq('user_id', me).eq('name', PROBE);
    check('A: probe rows cleaned up', !(left || []).length);
  } else if (!target) {                               // step 1, as A
    const sub = await db.from('subjects').insert([{ user_id: me, name: PROBE, code: 'XP101', total: 0, present: 0, per_week: 0 }]).select('id').single();
    const tt = await db.from('timetables').insert([{ user_id: me, title: PROBE }]).select('id').single();
    const imp = await db.from('timetable_imports').insert([{ id: crypto.randomUUID(), user_id: me, engine_version: PROBE, status: 'draft',
      training_consent: false }]).select('id').single();
    check('A: probe rows created', !sub.error && !tt.error && !imp.error,
      [sub.error, tt.error, imp.error].filter(Boolean).map(e => e.message).join('; '));
    const line = JSON.stringify({ user: me, subject: sub.data?.id, timetable: tt.data?.id, import: imp.data?.id });
    console.log('Copy this for step 2:  window.__xacctTarget = ' + line);
    window.__xacctLine = line;
  } else {                                            // step 2, as B, against A
    if (target.user === me) throw new Error('Step 2 must run as account B, not A.');
    const refusedOrNothing = (r) => !!r.error || !(r.data || []).length;
    // reads
    for (const [t, id] of [['subjects', target.subject], ['timetables', target.timetable], ['timetable_imports', target.import]]) {
      const r = await db.from(t).select('*').eq('id', id);
      check(`B reads A's ${t} row: nothing`, refusedOrNothing(r), r.error ? r.error.code : `${(r.data || []).length} rows`);
    }
    // updates and deletes reach nothing (RLS filters the row out: 0 rows affected)
    {
      const r = await db.from('subjects').update({ total: 99 }).eq('id', target.subject).select('id');
      check("B updates A's subject: 0 rows", refusedOrNothing(r), r.error ? r.error.code : `${(r.data || []).length} rows`);
      const u = await db.from('subjects').update({ user_id: me }).eq('id', target.subject).select('id');
      check("B takes over A's subject: 0 rows", refusedOrNothing(u), u.error ? u.error.code : `${(u.data || []).length} rows`);
      const d = await db.from('subjects').delete().eq('id', target.subject).select('id');
      check("B deletes A's subject: 0 rows", refusedOrNothing(d), d.error ? d.error.code : `${(d.data || []).length} rows`);
    }
    // inserts of B's own rows pointing at A's rows: must be refused (foreign keys ignore RLS; the restrictive policy doesn't)
    const tryInsert = async (name, table, row) => {
      const r = await db.from(table).insert([row]).select('id');
      if (!r.error && r.data?.length) await db.from(table).delete().eq('id', r.data[0].id);
      check(name, !!r.error, r.error ? `${r.error.code}: ${r.error.message}` : 'ACCEPTED (deleted again)');
    };
    await tryInsert("B's entry in A's timetable is refused", 'timetable_entries',
      { user_id: me, timetable_id: target.timetable, day_of_week: 1, period_index: 1, subject_name: PROBE });
    await tryInsert("B's entry linked to A's subject is refused", 'timetable_entries',
      { user_id: me, timetable_id: null, day_of_week: 1, period_index: 1, subject_id: target.subject, subject_name: PROBE });
    await tryInsert("B's mark for A's subject is refused", 'tracker_logs',
      { user_id: me, subject_id: target.subject, date: '2026-01-01', status: 'p' });
    await tryInsert("B's feedback on A's import is refused", 'timetable_feedback',
      { id: crypto.randomUUID(), user_id: me, import_id: target.import, correction_type: 'unchanged', training_consent: false, review_state: 'pending' });
    await tryInsert("B's row claiming to be A is refused", 'subjects',
      { user_id: target.user, name: PROBE, code: 'X', total: 0, present: 0, per_week: 0 });
  }
  const failed = results.filter(r => !r.ok);
  console.table(results);
  return { passed: results.length - failed.length, failed: failed.length, results };
})();
