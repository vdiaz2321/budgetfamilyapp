-- Spending inflation by year (Victor, 2026-10-24). The plan keeps one box,
-- the rate from now on; a change to it counts from the year it is saved, so
-- years already passed keep the rate they had. Each change stores the rate it
-- replaced and the last year that rate covered:
--   inflation_history: [{"until": 2029, "pct": 2.5}]
-- (2.5% through 2029, then inflation_pct). Empty = one rate for every year.
alter table public.retirement_plan
  add column if not exists inflation_history jsonb not null default '[]'::jsonb;
