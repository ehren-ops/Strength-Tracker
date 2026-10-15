-- Optional reps for each set when they differed (8/8/6); null when every set matched.
alter table public.entries add column if not exists reps_by_set integer[];
