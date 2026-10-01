-- The same table holds the per-session breakdown and the weekly coach check-in.
-- For a weekly row, session_date is the last day of the week it covers.
alter table public.ai_breakdowns add column kind text not null default 'session' check (kind in ('session','weekly'));
alter table public.ai_breakdowns drop constraint ai_breakdowns_pkey;
alter table public.ai_breakdowns add primary key (user_id, kind, session_date);
