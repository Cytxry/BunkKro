/* BunkKro cross-account security check (M10.1, M10.6).
 *
 * Run it SIGNED IN on your site (local or live), in the browser console. The site's Content-Security-Policy refuses
 * eval, so load it as a script:
 *     const s = document.createElement('script'); s.src = 'tests/security-rls-check.js'; document.body.append(s);
 *     await new Promise(r => s.onload = r); await window.__rlsCheck
 * (tests/ is not deployed: run it on a local copy signed in to the real project, e.g. http://localhost:5520)
 * It only reads, plus one write that MUST be refused (a row for another user id, which doesn't exist). A pass needs
 * Postgres's row-level-security refusal (42501), not just any error: user_id links to real accounts, so a made-up id
 * fails that link even with RLS off. If a write is wrongly accepted, it is undone at once and reported as a FAIL.
 * It never touches other students' rows (no update/delete probes: if RLS were broken they would do real damage;
 * UPDATE/DELETE policies and their WITH CHECK are checked by migrations/2026-11-08-security-audit.sql instead).
 * Returns { passed, failed, results }. Every FAIL is a security problem to fix before going public.
 */
window.__rlsCheck = (async () => {
  if (!currentUser) throw new Error('Sign in first: this checks what YOUR account can and cannot reach.');
  const me = currentUser.id, stranger = crypto.randomUUID();
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  const tables = ['subjects', 'tracker_logs', 'timetables', 'timetable_entries', 'daily_period_logs', 'timetable_exceptions',
                  'timetable_imports', 'timetable_feedback'];

  // 1. reading everything returns only my rows
  for (const t of tables) {
    const { data, error } = await supabaseClient.from(t).select('user_id').limit(1000);
    if (error && /does not exist|schema cache/i.test(error.message)) { check(`read ${t}`, true, 'table not set up (skipped)'); continue; }
    const others = (data || []).filter(r => r.user_id !== me).length;
    check(`read ${t}: only my rows`, !error && others === 0, error ? error.message : `${data.length} rows, ${others} not mine`);
  }
  // 2. the backup table is closed to the browser
  {
    const { data, error } = await supabaseClient.from('Subjects_backup').select('*').limit(5);
    check('Subjects_backup closed', !!error || (data || []).length === 0, error ? 'blocked' : `${data.length} rows visible`);
  }
  // 3. writing a row for someone else is refused
  {
    const { data, error } = await supabaseClient.from('subjects')
      .insert([{ user_id: stranger, name: 'rls-check', code: 'X', total: 0, present: 0, per_week: 0 }]).select('id');
    if (!error && data?.length) await supabaseClient.from('subjects').delete().eq('id', data[0].id);
    check("insert a subject for another user is refused by RLS", error?.code === '42501',
      error ? `${error.code}: ${error.message}` : 'ACCEPTED (deleted again)');
  }
  // 4. a signed-out visitor sees nothing
  {
    const anon = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const t of ['subjects', 'tracker_logs', 'timetable_entries', 'daily_period_logs', 'Subjects_backup']) {
      const { data, error } = await anon.from(t).select('user_id').limit(5);
      check(`signed-out visitor reads ${t}: nothing`, !!error || (data || []).length === 0, error ? 'blocked' : `${(data || []).length} rows visible`);
    }
  }
  const failed = results.filter(r => !r.ok);
  console.table(results);
  return { passed: results.length - failed.length, failed: failed.length, results };
})();
