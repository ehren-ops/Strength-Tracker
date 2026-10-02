-- Retire the one-argument coach_bump(uuid) from 20261002030000. The coach function calls
-- coach_bump(uuid, date) (20261002050000) with the caller's local day, so nothing uses this one.
drop function if exists public.coach_bump(uuid);
