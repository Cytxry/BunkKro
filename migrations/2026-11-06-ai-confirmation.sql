-- ==============================================================================
-- BunkKro AI: timetable confirmation and (opt-in) correction feedback   (M8)
-- Run once in the Supabase SQL Editor, after schema-migrations.sql. Safe to re-run.
--
-- * timetable_imports   one row per AI import: draft / confirmed / confirmed_with_unresolved
-- * timetable_feedback  per-period "what the AI read" vs "what the student kept", sent when a signed-in student
--                       confirms, unless they turned it off (the bar says so before confirming; "Turn off" deletes
--                       their rows). training_consent records that it was on. The file itself is never stored.
-- * timetable_entries   new nullable review columns, for replacing the 'Needs review' subject_name sentinel later.
--                       The site doesn't write them yet; existing rows are untouched.
-- Students can only see and change their own rows (RLS). Feedback rows can't be edited afterwards (an audit trail),
-- only deleted, which is what "Stop sharing" does. review_state is set by the review pipeline (service role),
-- never by the student.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS timetable_imports (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    engine_version TEXT,
    source_hash TEXT,                                   -- SHA-256 of the uploaded file: spots re-uploads, not content
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'confirmed_with_unresolved')),
    class_count INTEGER DEFAULT 0,
    unresolved_count INTEGER DEFAULT 0,
    corrections_count INTEGER DEFAULT 0,
    training_consent BOOLEAN NOT NULL DEFAULT false,    -- the student's sharing choice when this row was last saved
    consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    confirmed_at TIMESTAMPTZ
);

ALTER TABLE timetable_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select their own imports" ON timetable_imports;
CREATE POLICY "Users can select their own imports"
    ON timetable_imports FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own imports" ON timetable_imports;
CREATE POLICY "Users can insert their own imports"
    ON timetable_imports FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own imports" ON timetable_imports;
CREATE POLICY "Users can update their own imports"
    ON timetable_imports FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own imports" ON timetable_imports;
CREATE POLICY "Users can delete their own imports"
    ON timetable_imports FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS timetable_feedback (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    import_id UUID NOT NULL REFERENCES timetable_imports(id) ON DELETE CASCADE,
    entry_id UUID,                                      -- the timetable_entries row it became (null if removed)
    correction_type TEXT NOT NULL,                      -- subject, day, time (joined with +), unchanged, marked_free,
                                                        -- unknown_was_class, class_removed, class_added
    predicted_value JSONB,                              -- what the AI exported (day, times, subject, raw text, cell)
    confirmed_value JSONB,                              -- what the student kept
    source_cell_id TEXT,                                -- the engine's cell id: points at the evidence box
    engine_version TEXT,
    training_consent BOOLEAN NOT NULL CHECK (training_consent),   -- rows exist only with consent
    review_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_state IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS timetable_feedback_user_idx ON timetable_feedback (user_id);
CREATE INDEX IF NOT EXISTS timetable_feedback_import_idx ON timetable_feedback (import_id);

ALTER TABLE timetable_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select their own feedback" ON timetable_feedback;
CREATE POLICY "Users can select their own feedback"
    ON timetable_feedback FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own consented feedback" ON timetable_feedback;
CREATE POLICY "Users can insert their own consented feedback"
    ON timetable_feedback FOR INSERT
    WITH CHECK (auth.uid() = user_id AND training_consent AND review_state = 'pending');
DROP POLICY IF EXISTS "Users can delete their own feedback" ON timetable_feedback;
CREATE POLICY "Users can delete their own feedback"
    ON timetable_feedback FOR DELETE USING (auth.uid() = user_id);
-- no UPDATE policy: a shared correction is kept as it was given, or withdrawn (deleted)


-- Review columns for timetable entries (nullable, additive; Day Order columns follow M3 IR_SPEC section 6, option A)
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES timetable_imports(id) ON DELETE SET NULL;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS is_unknown BOOLEAN DEFAULT false;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS is_uncertain BOOLEAN DEFAULT false;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS review_status TEXT
    CHECK (review_status IS NULL OR review_status IN ('ai_unreviewed', 'student_confirmed', 'student_edited', 'manual'));
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS source_cell_id TEXT;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS day_type TEXT DEFAULT 'weekday'
    CHECK (day_type IN ('weekday', 'cycle_day'));
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS day_order INTEGER;
