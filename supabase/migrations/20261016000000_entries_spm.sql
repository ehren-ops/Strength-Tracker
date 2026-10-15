-- Rowing: stroke rate (strokes per minute) for the C2 erg card. Meters ride in distance and the
-- 500 m split (seconds) in speed, marked by the exercise's rowing flag in the app.
alter table public.entries add column if not exists spm smallint;
