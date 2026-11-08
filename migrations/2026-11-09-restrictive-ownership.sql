-- ==============================================================================
-- BunkKro M10.5: ownership that holds whatever other policies exist (NOT APPLIED: the owner runs it).
-- Run 2026-11-08-security-audit.sql first and read blocks 2 and 7. Safe to re-run. Deletes no data, drops no table,
-- renames nothing. Rollback: the DROP POLICY lines at the end.
--
-- Why RESTRICTIVE: Postgres ORs permissive policies together, so one broad policy (qual "true", made in the
-- dashboard or by an old migration) opens a table even when "own rows only" policies exist. A RESTRICTIVE policy is
-- ANDed with all of them: with these, every row a browser key reads or writes must be the user's own, full stop.
--
-- Why the references: a foreign-key check ignores RLS. Without the second part, a user can insert their OWN row
-- that points at ANOTHER user's timetable, subject or import (e.g. timetable_entries.timetable_id = someone else's
-- timetable). That leaks nothing, but it ties one account's rows to another's records (cascades, joins, the
-- feedback pipeline). The checks below allow only references to the user's own rows (or none).
--
-- Note on UPDATE: when an UPDATE policy has no WITH CHECK, Postgres uses its USING expression for the new row too,
-- so "USING (auth.uid() = user_id)" alone already stops moving a row to another user. The explicit WITH CHECKs in
-- 2026-11-08-rls-lockdown.sql only make that visible; the restrictive policies here state it once for every command.
-- ==============================================================================

-- 1. own rows only, for every command, on every user table
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects', 'tracker_logs', 'timetables', 'timetable_entries', 'daily_period_logs',
                           'timetable_exceptions', 'timetable_imports', 'timetable_feedback'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "bk restrict own rows" ON public.%I', t);
    EXECUTE format('CREATE POLICY "bk restrict own rows" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated '
                   'USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
  END LOOP;
END $$;

-- 2. references must be to the user's own rows (or empty)
DROP POLICY IF EXISTS "bk restrict own references" ON public.timetable_entries;
CREATE POLICY "bk restrict own references" ON public.timetable_entries AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (
    (timetable_id IS NULL OR EXISTS (SELECT 1 FROM public.timetables t WHERE t.id = timetable_id AND t.user_id = auth.uid()))
    AND (subject_id IS NULL OR EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = subject_id AND s.user_id = auth.uid()))
    AND (import_id IS NULL OR EXISTS (SELECT 1 FROM public.timetable_imports i WHERE i.id = import_id AND i.user_id = auth.uid())));

DROP POLICY IF EXISTS "bk restrict own references" ON public.daily_period_logs;
CREATE POLICY "bk restrict own references" ON public.daily_period_logs AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (subject_id IS NULL OR EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = subject_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "bk restrict own references" ON public.tracker_logs;
CREATE POLICY "bk restrict own references" ON public.tracker_logs AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (subject_id IS NULL OR EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = subject_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "bk restrict own references" ON public.timetable_feedback;
CREATE POLICY "bk restrict own references" ON public.timetable_feedback AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM public.timetable_imports i WHERE i.id = import_id AND i.user_id = auth.uid()));

-- 3. check: every user table should list "bk restrict own rows" (and the four above "bk restrict own references")
SELECT tablename, policyname, permissive, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'bk restrict%' ORDER BY tablename, policyname;

-- ROLLBACK (only if something breaks; the earlier policies are untouched):
-- DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['subjects','tracker_logs','timetables','timetable_entries',
--   'daily_period_logs','timetable_exceptions','timetable_imports','timetable_feedback'] LOOP
--   IF to_regclass('public.' || t) IS NOT NULL THEN
--     EXECUTE format('DROP POLICY IF EXISTS "bk restrict own rows" ON public.%I', t);
--     EXECUTE format('DROP POLICY IF EXISTS "bk restrict own references" ON public.%I', t);
--   END IF; END LOOP; END $$;
