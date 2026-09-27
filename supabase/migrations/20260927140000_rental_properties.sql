-- Retirement Plan, phase 2: rental properties.
--
-- One row per rental — either one already owned (linked to its Property
-- account on the Accounts page, and optionally to the loan account behind it)
-- or one planned for a future year. The plan turns each into:
--   * net rent (rent − costs − mortgage payment) as income, taxed when positive
--   * equity (value − loan balance) as part of net worth, growing with
--     principal paid down and any appreciation above inflation
--   * for a planned purchase, the down payment moving from savings into
--     equity and the closing costs leaving net worth that year.
-- Amounts are today's dollars; the mortgage payment is fixed in nominal
-- dollars, so the plan deflates it year by year.

create table if not exists rental_properties (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  name                 text not null check (length(trim(name)) > 0),
  -- Owned: the Property account whose balance is the home's value, and the
  -- loan account whose balance is what's owed. Planned: both null.
  property_account_id  uuid references accounts(id) on delete set null,
  loan_account_id      uuid references accounts(id) on delete set null,
  -- Planned purchases only: the year it is bought.
  purchase_year        integer check (purchase_year is null or (purchase_year > 1900 and purchase_year < 2200)),
  -- Planned: price in today's dollars. Owned but unlinked: current value.
  value_cents          bigint not null default 0 check (value_cents >= 0),
  down_payment_pct     numeric(5,2) not null default 25.00 check (down_payment_pct >= 0 and down_payment_pct <= 100),
  closing_cost_pct     numeric(5,2) not null default 3.00 check (closing_cost_pct >= 0 and closing_cost_pct <= 20),
  -- Owned but no loan account linked: what's owed today.
  loan_balance_cents   bigint check (loan_balance_cents is null or loan_balance_cents >= 0),
  loan_rate_pct        numeric(5,2) not null default 7.00 check (loan_rate_pct >= 0 and loan_rate_pct <= 30),
  -- Planned: loan term. Owned: years left on the loan.
  loan_years           integer not null default 30 check (loan_years >= 0 and loan_years <= 50),
  monthly_rent_cents   bigint not null default 0 check (monthly_rent_cents >= 0),
  -- Taxes, insurance, management, repairs, vacancy.
  monthly_costs_cents  bigint not null default 0 check (monthly_costs_cents >= 0),
  -- Value growth ABOVE inflation (0 = keeps pace with prices).
  appreciation_pct     numeric(5,2) not null default 0.00 check (appreciation_pct >= -20 and appreciation_pct <= 20),
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists rental_properties_household_idx
  on rental_properties (household_id);

alter table rental_properties enable row level security;

drop policy if exists rental_properties_all on rental_properties;
create policy rental_properties_all on rental_properties
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
