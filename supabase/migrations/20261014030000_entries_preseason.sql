-- Sets logged with Preseason Prep on, for an exercise whose target reps change in preseason (Squat:
-- 5 reps with a 4 sec lowering), are tagged so charts judge them against the preseason target.
alter table public.entries add column if not exists preseason boolean not null default false;
-- Backfill: squats at 5 reps or fewer since preseason started (last week of September).
update public.entries e set preseason = true
from public.exercises x
where x.id = e.exercise_id and x.name = 'Squat' and e.entry_date >= '2026-09-21' and e.reps <= 5;
