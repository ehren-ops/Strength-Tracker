-- A deload is planned as one week: the app switches it off on this date unless you choose to
-- keep it on for another week.
alter table public.user_settings add column deload_planned_end_on date;
