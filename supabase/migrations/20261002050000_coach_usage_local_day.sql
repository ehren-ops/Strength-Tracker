-- The coach's daily cap resets at the caller's local midnight instead of UTC midnight. The edge
-- function works out the caller's local date from their time zone and passes it in. Any real time
-- zone is within a day of UTC, so anything further out falls back to the UTC date.
-- The one-argument coach_bump(uuid) from 20261002030000 is left in place (service role only, no
-- longer called) to keep this migration non-destructive; drop it whenever convenient.

create or replace function public.coach_bump(p_user uuid, p_day date)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.coach_usage (user_id, day, calls)
  values (
    p_user,
    case when p_day between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
         then p_day else (now() at time zone 'utc')::date end,
    1
  )
  on conflict (user_id, day) do update set calls = public.coach_usage.calls + 1
  returning calls;
$$;
revoke execute on function public.coach_bump(uuid, date) from public, anon, authenticated;
grant execute on function public.coach_bump(uuid, date) to service_role;
