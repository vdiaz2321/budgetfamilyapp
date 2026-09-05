-- The assumptions behind the Financial Independence projection. One row per
-- household: everything else it needs (portfolio, contributions, spending) is
-- measured from accounts and transactions, so only the things the app cannot
-- know — when you want to stop, what return you assume, what you'll withdraw —
-- live here. Every money/rate column is nullable-with-default so the section
-- can render before it has ever been opened.
create table if not exists retirement_plan (
  household_id              uuid primary key references households(id) on delete cascade,
  -- Optional: lets the projection speak in ages rather than only in years.
  birth_year                integer check (birth_year is null or (birth_year > 1900 and birth_year < 2200)),
  target_retire_year        integer check (target_retire_year is null or (target_retire_year > 1900 and target_retire_year < 2200)),
  -- Overrides for the measured figures. Null means "use the actuals".
  annual_spend_cents        bigint check (annual_spend_cents is null or annual_spend_cents >= 0),
  annual_contribution_cents bigint check (annual_contribution_cents is null or annual_contribution_cents >= 0),
  -- Real (after-inflation) return, so every figure below is in today's money.
  real_return_pct           numeric(5,2) not null default 5.00 check (real_return_pct >= -20 and real_return_pct <= 20),
  withdrawal_rate_pct       numeric(5,2) not null default 4.00 check (withdrawal_rate_pct > 0 and withdrawal_rate_pct <= 20),
  -- Cash savings are excluded by default: a house deposit sitting in savings
  -- is not retirement money.
  include_cash              boolean not null default false,
  updated_at                timestamptz not null default now()
);

alter table retirement_plan enable row level security;

drop policy if exists retirement_plan_all on retirement_plan;
create policy retirement_plan_all on retirement_plan
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
