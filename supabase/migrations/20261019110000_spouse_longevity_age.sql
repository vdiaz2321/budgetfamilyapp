-- Spouse's plan-until age (Victor, 2026-10-19): beside Spouse birth year in
-- "General Profile Data". The plan runs to whichever of the two ends last.

alter table retirement_plan
  add column if not exists spouse_longevity_age integer not null default 90
    check (spouse_longevity_age between 50 and 120);
