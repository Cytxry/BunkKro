// Read-only schema drift check against the live Supabase project, with the PUBLIC (publishable) key only.
//
//   node tests/schema-probe.js
//
// For every table and column the site's code uses or the repo's migrations declare, it asks PostgREST for that one
// column with limit=0 (`?select=col&limit=0`): 200 means the column exists (no row is ever returned: limit 0, and RLS
// hides other users' rows anyway); 400 (42703) means it doesn't; 404 (PGRST205) means the table doesn't. Nothing is
// written. It can't see constraints, policies or columns nobody names here: the owner's dashboard audit
// (migrations/2026-11-08-security-audit.sql) covers those.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'bunkke.js'), 'utf8');
const URL_ = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (src.slice(0, 2000).match(/(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/) || [])[1];

// what the code reads or writes (bunkke.js, ai-confirm.js) and what the migrations add
const EXPECTED = {
  subjects: ['id', 'user_id', 'name', 'code', 'total', 'present', 'per_week', 'target', 'sem_total', 'mode', 'created_at'],
  tracker_logs: ['id', 'user_id', 'subject_id', 'date', 'status'],
  timetables: ['id', 'user_id', 'title'],
  timetable_entries: ['id', 'timetable_id', 'user_id', 'day_of_week', 'period_index', 'start_time', 'end_time',
    'subject_id', 'subject_name', 'is_break',
    // migrations/2026-11-06-ai-confirmation.sql
    'import_id', 'is_unknown', 'is_uncertain', 'review_status', 'source_cell_id', 'day_type', 'day_order'],
  daily_period_logs: ['id', 'user_id', 'entry_id', 'subject_id', 'date', 'status'],
  timetable_exceptions: ['id', 'user_id', 'date', 'type', 'note'],
  timetable_imports: ['id', 'user_id', 'engine_version', 'source_hash', 'status', 'created_at', 'confirmed_at',
    'class_count', 'unresolved_count', 'corrections_count', 'training_consent', 'consent_at'],
  timetable_feedback: ['id', 'user_id', 'import_id', 'entry_id', 'correction_type', 'predicted_value',
    'confirmed_value', 'source_cell_id', 'engine_version', 'training_consent', 'review_state'],
  Subjects_backup: ['id'],
};

async function probe(table, col) {
  const r = await fetch(`${URL_}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(col)}&limit=0`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 200) return 'ok';
  if (r.status === 404 || body.code === 'PGRST205') return 'no table';
  if (body.code === '42703' || /does not exist/.test(body.message || '')) return 'missing';
  return `? ${r.status} ${body.code || ''}`;
}

(async () => {
  if (!URL_ || !KEY) throw new Error('no Supabase URL or public key found in bunkke.js');
  if (!/^sb_publishable_/.test(KEY) && !/"role":"anon"/.test(Buffer.from((KEY.split('.')[1] || ''), 'base64').toString())) {
    throw new Error('refusing to run: the key in bunkke.js is not a public (anon / publishable) key');
  }
  const report = {};
  let problems = 0;
  for (const [table, cols] of Object.entries(EXPECTED)) {
    report[table] = {};
    for (const c of cols) {
      const v = await probe(table, c);
      report[table][c] = v;
      if (v !== 'ok') problems++;
    }
  }
  for (const [t, cols] of Object.entries(report)) {
    const bad = Object.entries(cols).filter(([, v]) => v !== 'ok');
    console.log(`${t.padEnd(22)} ${bad.length ? bad.map(([c, v]) => `${c}: ${v}`).join(', ') : `all ${Object.keys(cols).length} columns present`}`);
  }
  console.log(problems ? `\n${problems} expected column(s) not found` : '\nno drift in the columns checked');
  process.exitCode = problems ? 1 : 0;
})();
