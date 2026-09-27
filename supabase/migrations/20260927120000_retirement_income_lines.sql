-- Retirement Plan, phase 1: income that switches on and off by year.
--
-- Until now retirement income was one flat "guaranteed income" figure and the
-- Net Worth Plan table carried a hand-typed $100k stand-in after retiring, so
-- the plan never stopped working pay and never drew savings down. This adds:
--
--   * retirement_income_lines — VA, Social Security, a second job, a spouse's
--     income… each with a monthly amount (today's dollars), a first and last
--     year, and whether it is taxed.
--   * the military retired-pay inputs on retirement_plan (High-3 × 2.5% per
--     year of service, optional SBP), plus inflation, a default tax rate and
--     the age the plan runs to.
--   * networth_projection.work_income_cents — the take-home pay Victor types
--     for a year. income_cents stays the year's TOTAL take-home (work pay
--     before military retirement + income lines after tax), so every existing
--     reader keeps working; it is recomputed whenever the plan changes.
--   * networth_projection.tax_pct — a per-year tax override on the lines.

create table if not exists retirement_income_lines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  kind          text not null check (kind in ('va', 'social_security', 'job', 'spouse', 'other')),
  monthly_cents bigint not null check (monthly_cents >= 0),
  start_year    integer check (start_year is null or (start_year > 1900 and start_year < 2200)),
  -- Inclusive: the last year the income is received. Null = for life.
  end_year      integer check (end_year is null or (end_year > 1900 and end_year < 2200)),
  taxable       boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (start_year is null or end_year is null or end_year >= start_year)
);

create index if not exists retirement_income_lines_household_idx
  on retirement_income_lines (household_id);

alter table retirement_income_lines enable row level security;

drop policy if exists retirement_income_lines_all on retirement_income_lines;
create policy retirement_income_lines_all on retirement_income_lines
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

alter table retirement_plan
  add column if not exists service_start_year integer
    check (service_start_year is null or (service_start_year > 1900 and service_start_year < 2200)),
  -- Average monthly basic pay over the highest 36 months, in the dollars of
  -- the military retirement year (how the DFAS estimate is usually worked).
  add column if not exists high3_monthly_cents bigint
    check (high3_monthly_cents is null or high3_monthly_cents >= 0),
  add column if not exists inflation_pct numeric(5,2) not null default 2.50
    check (inflation_pct >= 0 and inflation_pct <= 20),
  add column if not exists sbp_enabled boolean not null default false,
  add column if not exists sbp_pct numeric(5,2) not null default 6.50
    check (sbp_pct >= 0 and sbp_pct <= 20),
  add column if not exists retirement_tax_pct numeric(5,2) not null default 12.00
    check (retirement_tax_pct >= 0 and retirement_tax_pct <= 60),
  add column if not exists longevity_age integer not null default 90
    check (longevity_age >= 50 and longevity_age <= 120);

alter table networth_projection
  add column if not exists work_income_cents bigint,
  add column if not exists tax_pct numeric(5,2)
    check (tax_pct is null or (tax_pct >= 0 and tax_pct <= 60));

-- Every row keeps what was typed: the typed income becomes the work pay.
-- Years from the military retirement year on stop using it once the plan is
-- recomputed, which is what replaces the $100k stand-in with real lines.
update networth_projection
   set work_income_cents = income_cents
 where work_income_cents is null;
