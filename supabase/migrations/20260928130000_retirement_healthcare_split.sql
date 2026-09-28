-- Retirement Plan: healthcare split into three lines, each with its own start.
--
--   health plan     TRICARE Prime / Select / private / none — yearly premium,
--                   from the military retirement month until TFL starts
--   TFL             the Medicare Part B premium (TFL itself has no fee), from
--                   healthcare_start_age on — reuses healthcare_annual_cents
--   dental & vision yearly premium from the military retirement month on
--                   (TFL covers neither)
--
-- All in today's dollars, rising healthcare_growth_pct a year above inflation.

alter table retirement_plan
  add column if not exists health_plan_kind text
    check (health_plan_kind in ('tricare_prime', 'tricare_select', 'private', 'none')),
  add column if not exists health_plan_annual_cents bigint
    check (health_plan_annual_cents >= 0),
  add column if not exists dental_vision_annual_cents bigint
    check (dental_vision_annual_cents >= 0);

comment on column retirement_plan.healthcare_annual_cents is
  'TRICARE For Life: yearly Medicare Part B premium, from healthcare_start_age on.';
