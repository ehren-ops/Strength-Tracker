-- One cached Full AI Breakdown per user per session date. Written by the app
-- after a breakdown is generated; read back on sign-in and by outlive's
-- strength-sync function so the same breakdown shows in both apps.
create table public.ai_breakdowns (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_date date not null,
  breakdown jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, session_date)
);
alter table public.ai_breakdowns enable row level security;
create policy ai_breakdowns_select_own on public.ai_breakdowns for select using (user_id = (select auth.uid()));
create policy ai_breakdowns_insert_own on public.ai_breakdowns for insert with check (user_id = (select auth.uid()));
create policy ai_breakdowns_update_own on public.ai_breakdowns for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ai_breakdowns_delete_own on public.ai_breakdowns for delete using (user_id = (select auth.uid()));
