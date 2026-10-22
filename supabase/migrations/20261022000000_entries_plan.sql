-- The plan the Next tile showed when a session was logged ({ sets, reps, weight }), so the chart and
-- Coach's Notes judge each session against what was asked of it. Null for older sessions.
alter table public.entries add column if not exists plan jsonb;
