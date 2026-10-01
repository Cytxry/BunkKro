-- ==============================================================================
-- BunkKro: Smart Timetable & Daily Attendance Tracking Schema
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ==============================================================================

-- 1. Timetables Master Table
CREATE TABLE IF NOT EXISTS timetables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'Weekly Timetable',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Timetables
ALTER TABLE timetables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own timetables"
    ON timetables FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own timetables"
    ON timetables FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own timetables"
    ON timetables FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own timetables"
    ON timetables FOR DELETE
    USING (auth.uid() = user_id);


-- 2. Timetable Period Entries Table
CREATE TABLE IF NOT EXISTS timetable_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_id UUID REFERENCES timetables(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
    period_index INT NOT NULL,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    subject_name TEXT NOT NULL,
    is_break BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for speedy timetable lookups
CREATE INDEX IF NOT EXISTS idx_timetable_entries_user_day 
    ON timetable_entries (user_id, day_of_week, period_index);

-- Enable RLS for Timetable Entries
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own timetable entries"
    ON timetable_entries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own timetable entries"
    ON timetable_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own timetable entries"
    ON timetable_entries FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own timetable entries"
    ON timetable_entries FOR DELETE
    USING (auth.uid() = user_id);


-- 3. Daily Period Logs Table (For Period-Wise Attendance Tracking)
CREATE TABLE IF NOT EXISTS daily_period_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    entry_id TEXT NOT NULL, -- Timetable slot ID or extra class ID
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    period_index INT DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('p', 'a', 'cancelled')), -- p=Present, a=Absent, cancelled=Cancelled Class
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_user_date_entry UNIQUE (user_id, date, entry_id)
);

-- Index for daily log lookups
CREATE INDEX IF NOT EXISTS idx_daily_period_logs_user_date 
    ON daily_period_logs (user_id, date);

-- Enable RLS for Daily Period Logs
ALTER TABLE daily_period_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own daily period logs"
    ON daily_period_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update their own daily period logs"
    ON daily_period_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily period logs"
    ON daily_period_logs FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own daily period logs"
    ON daily_period_logs FOR DELETE
    USING (auth.uid() = user_id);


-- 4. Timetable Exceptions Table (Holidays, Special Schedules)
CREATE TABLE IF NOT EXISTS timetable_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('holiday', 'custom_day')),
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_user_date_exception UNIQUE (user_id, date)
);

-- Enable RLS for Exceptions
ALTER TABLE timetable_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own exceptions"
    ON timetable_exceptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update their own exceptions"
    ON timetable_exceptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own exceptions"
    ON timetable_exceptions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own exceptions"
    ON timetable_exceptions FOR DELETE
    USING (auth.uid() = user_id);
