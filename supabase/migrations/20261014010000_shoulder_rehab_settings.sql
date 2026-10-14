-- Shoulder Rehab modifier: on/off like the other modes, plus the day it started (sets the week
-- and phase), the day it ended (returning lifts ramp back from there) and the Phase 3 switch.
alter table public.user_settings
  add column if not exists shoulder_rehab_mode boolean not null default false,
  add column if not exists shoulder_rehab_started_on date,
  add column if not exists shoulder_rehab_ended_on date,
  add column if not exists shoulder_rehab_phase3 boolean not null default false;
