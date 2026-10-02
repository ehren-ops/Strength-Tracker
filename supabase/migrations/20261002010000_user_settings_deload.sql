-- Deload Week modifier: on/off plus the dates of the current or most recent deload, so the app
-- can show the last deload and the next recommended one, and skip deload sessions when it
-- computes the next working weight.
alter table public.user_settings
  add column deload_mode boolean not null default false,
  add column deload_started_on date,
  add column deload_ended_on date;

-- Sets logged during a deload are tagged so suggestions skip them afterward and progression
-- resumes from the pre-deload working weight.
alter table public.entries add column deload boolean not null default false;
