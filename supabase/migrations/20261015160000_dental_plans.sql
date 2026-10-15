-- Dental & vision becomes a list like the health plans — Victor, 2026-10-15.
-- Each item: {kind, annualCents, startYear, startMonth, endYear, endMonth},
-- kind one of fedvip_dental, fedvip_vision, private_dental, private_vision
-- (FEDVIP replaced the TRICARE Retiree Dental Program). Blank start = the
-- military retirement month; blank end = for life.
--
-- The single dental & vision amount and its dates (added earlier today) are
-- folded into the list, then dropped.
alter table public.retirement_plan
  add column if not exists dental_plans jsonb not null default '[]'::jsonb;

update public.retirement_plan
set dental_plans = jsonb_build_array(jsonb_build_object(
  'kind', 'fedvip_dental',
  'annualCents', dental_vision_annual_cents,
  'startYear', dental_vision_start_year,
  'startMonth', dental_vision_start_month,
  'endYear', dental_vision_end_year,
  'endMonth', dental_vision_end_month))
where dental_vision_annual_cents > 0;

alter table public.retirement_plan
  drop column if exists dental_vision_annual_cents,
  drop column if exists dental_vision_start_year,
  drop column if exists dental_vision_start_month,
  drop column if exists dental_vision_end_year,
  drop column if exists dental_vision_end_month;
