-- Daily per-account call counter for the coach edge function, so the Anthropic key can only be
-- spent by signed-in accounts and only up to a daily cap. Written by the function with the
-- service role; no client access.
create table public.coach_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (user_id, day)
);
alter table public.coach_usage enable row level security;

-- Counts this call and returns the caller's total for today (UTC).
create or replace function public.coach_bump(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.coach_usage (user_id, day, calls)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set calls = public.coach_usage.calls + 1
  returning calls;
$$;
revoke execute on function public.coach_bump(uuid) from public, anon, authenticated;
grant execute on function public.coach_bump(uuid) to service_role;
