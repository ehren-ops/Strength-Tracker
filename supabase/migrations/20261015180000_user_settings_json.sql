-- One JSON field for all settings, so a new training modifier needs no schema change. The old
-- per-mode columns stay (older cached app versions still read them); the app reads this first.
alter table public.user_settings add column if not exists settings jsonb not null default '{}'::jsonb;

update public.user_settings set settings = jsonb_build_object(
  'modes', jsonb_build_object(
    'deload', coalesce(deload_mode, false), 'ski', coalesce(ski_season_mode, false),
    'knee', coalesce(knee_care_mode, false), 'back', coalesce(low_back_care_mode, false),
    'preseason', coalesce(preseason_mode, false), 'shoulder', coalesce(shoulder_rehab_mode, false)),
  'deload', jsonb_strip_nulls(jsonb_build_object('startedOn', deload_started_on, 'endedOn', deload_ended_on, 'plannedEndOn', deload_planned_end_on)),
  'shoulderRehab', jsonb_strip_nulls(jsonb_build_object('startedOn', shoulder_rehab_started_on, 'endedOn', shoulder_rehab_ended_on, 'phase3', coalesce(shoulder_rehab_phase3, false))))
where settings = '{}'::jsonb;
