-- Main lifts run heavy (4x5) and volume (3x8) sessions, each progressing on its own. Null on
-- every other lift and on entries logged before this existed.
alter table public.entries add column if not exists heavy boolean;
