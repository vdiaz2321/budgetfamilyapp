-- Start and end dates (month + year) for the retirement healthcare costs —
-- Victor, 2026-10-15. Blank start = the military retirement month; blank end
-- = until TRICARE For Life (health plans) or for life (dental & vision).
--
-- Health plans keep living in the `health_plans` jsonb list; each item may now
-- also carry startYear, startMonth, endYear, endMonth. Dental & vision gets
-- its own columns here.
alter table public.retirement_plan
  add column if not exists dental_vision_start_year smallint
    check (dental_vision_start_year is null or dental_vision_start_year between 1900 and 2200),
  add column if not exists dental_vision_start_month smallint
    check (dental_vision_start_month is null or dental_vision_start_month between 1 and 12),
  add column if not exists dental_vision_end_year smallint
    check (dental_vision_end_year is null or dental_vision_end_year between 1900 and 2200),
  add column if not exists dental_vision_end_month smallint
    check (dental_vision_end_month is null or dental_vision_end_month between 1 and 12);
