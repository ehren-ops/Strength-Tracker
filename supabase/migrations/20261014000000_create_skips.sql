-- Exercises skipped on purpose (injury, equipment, time, other), one row per lift per day. A skip
-- counts the lift as done for the day's completion and tells the coach why it is missing, without
-- touching the lift's progression history.
create table public.skips (
  user_id uuid not null references auth.users(id) on delete cascade,
  skip_date date not null,
  exercise_name text not null,
  reason text not null check (reason in ('injury', 'equipment', 'time', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, skip_date, exercise_name)
);
alter table public.skips enable row level security;
create policy skips_select_own on public.skips for select using (user_id = (select auth.uid()));
create policy skips_insert_own on public.skips for insert with check (user_id = (select auth.uid()));
create policy skips_update_own on public.skips for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy skips_delete_own on public.skips for delete using (user_id = (select auth.uid()));
