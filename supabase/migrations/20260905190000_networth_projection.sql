-- Victor's "Net Worth Projection Calculator" sheet, which he has kept by hand
-- since 2018: one row per year, income in, spending out, growth on top, and the
-- balance it lands on. Held as data rather than formulas so any year can be
-- corrected when life doesn't match the plan; the EOY chain is recomputed by
-- the app whenever a row changes.
create table if not exists networth_projection (
  household_id    uuid not null references households(id) on delete cascade,
  year            integer not null check (year > 1900 and year < 2200),
  age             integer check (age is null or (age >= 0 and age < 130)),
  -- Balance carried in from the previous year. Stored (not derived) so the
  -- first year has somewhere to start and a single year can be corrected in
  -- isolation before the chain is rebuilt.
  boy_cents       bigint not null default 0,
  income_cents    bigint not null default 0,
  taxes_cents     bigint not null default 0,
  -- Kept positive; it is subtracted, and a sheet full of negative numbers is
  -- harder to check than one that says what each column means.
  spending_cents  bigint not null default 0,
  growth_cents    bigint not null default 0,
  eoy_cents       bigint not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (household_id, year)
);

alter table networth_projection enable row level security;

drop policy if exists networth_projection_all on networth_projection;
create policy networth_projection_all on networth_projection
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- The sheet's assumption block. It lives on the household's existing plan row
-- because it answers the same question the FI section does — where is this
-- going — just with the household's own year-by-year model instead of a single
-- compounding rate.
alter table public.retirement_plan
  add column if not exists projection_return_pct   numeric(5,2) not null default 8.00,
  add column if not exists personal_inflation_pct  numeric(5,2) not null default 4.00,
  add column if not exists income_growth_pct       numeric(5,2) not null default 2.50,
  add column if not exists desired_spend_cents     bigint;
