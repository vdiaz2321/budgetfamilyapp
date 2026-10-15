-- Victor removed the COLA from the retirement plan (2026-10-15): retired pay,
-- VA, Social Security and other income lines now stay at the amount entered
-- every year. The column was 2.50 when dropped.
alter table public.retirement_plan drop column if exists cola_pct;
