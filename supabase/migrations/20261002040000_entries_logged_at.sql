-- When each set was logged on the phone (not when it reached the server, which can be much later
-- for sets logged offline). The coach compares a session's actual exercise order with the planned
-- one. Existing rows take created_at, which matches log time for anything synced while online.
alter table public.entries add column logged_at timestamptz;
update public.entries set logged_at = created_at where logged_at is null;
alter table public.entries alter column logged_at set default now();
