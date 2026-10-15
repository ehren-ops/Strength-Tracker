-- Joint check: an optional 0-10 pain score per session and where it was felt.
alter table public.entries add column if not exists pain smallint check (pain between 0 and 10);
alter table public.entries add column if not exists pain_area text;
