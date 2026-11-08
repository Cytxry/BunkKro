-- ==============================================================================
-- BunkKro RLS lock-down (M10.1). Run AFTER looking at 2026-11-08-security-audit.sql.
-- Safe to re-run. It deletes no data and drops no table.
--
-- * subjects, tracker_logs: the site uses them, but schema-migrations.sql never set their row-level security.
--   Each student can only see and change their own rows.
-- * "Subjects_backup": not used by the site. RLS on with NO policy means the browser keys can't read or write it
--   at all; you still can, from the dashboard. Delete the table yourself if you don't need it.
-- If block 2 of the audit showed extra, broader policies on these tables (qual "true"), drop those by name too:
-- policies are OR-ed, so a broad one stays open even with these added.
-- ==============================================================================

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bk own subjects select" ON subjects;
CREATE POLICY "bk own subjects select" ON subjects FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own subjects insert" ON subjects;
CREATE POLICY "bk own subjects insert" ON subjects FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own subjects update" ON subjects;
CREATE POLICY "bk own subjects update" ON subjects FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own subjects delete" ON subjects;
CREATE POLICY "bk own subjects delete" ON subjects FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE tracker_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bk own tracker select" ON tracker_logs;
CREATE POLICY "bk own tracker select" ON tracker_logs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own tracker insert" ON tracker_logs;
CREATE POLICY "bk own tracker insert" ON tracker_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own tracker update" ON tracker_logs;
CREATE POLICY "bk own tracker update" ON tracker_logs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "bk own tracker delete" ON tracker_logs;
CREATE POLICY "bk own tracker delete" ON tracker_logs FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE "Subjects_backup" ENABLE ROW LEVEL SECURITY;   -- no policy: closed to the browser keys

-- the UPDATE policies of the original tables (schema-migrations.sql) only had USING: add WITH CHECK, so a row can't
-- be moved to another user_id by an update
DROP POLICY IF EXISTS "Users can update their own timetables" ON timetables;
CREATE POLICY "Users can update their own timetables" ON timetables FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own timetable entries" ON timetable_entries;
CREATE POLICY "Users can update their own timetable entries" ON timetable_entries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own daily period logs" ON daily_period_logs;
CREATE POLICY "Users can update their own daily period logs" ON daily_period_logs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own exceptions" ON timetable_exceptions;
CREATE POLICY "Users can update their own exceptions" ON timetable_exceptions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
