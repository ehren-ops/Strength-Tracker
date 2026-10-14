-- Recovery sessions (sauna, cold plunge, hot tub) log a temperature in °F alongside minutes.
alter table public.entries add column if not exists temp_f numeric;
