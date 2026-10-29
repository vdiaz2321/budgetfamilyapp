-- A GS pension can count the military years too (Victor, 2026-10-29).
--
-- fers_waive_military, meaningful on a 'fers' line owned by 'self' only:
-- waive military retired pay so the active-duty years join the GS service
-- (OPM: the waiver takes effect the day before the GS annuity starts, and the
-- military deposit has to be paid before leaving GS). Retired pay then stops
-- the month the GS pension starts (lib/retirement incomeForYear); the
-- service years used come from the plan's service start and retirement.
--
-- A column on an existing table: its grants and RLS policy already cover it.

alter table public.retirement_income_lines
  add column if not exists fers_waive_military boolean not null default false;
