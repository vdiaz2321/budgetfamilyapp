-- Account groups: each kind of money grows, takes in and pays out on its own.
--
-- The plan grew every investment at one return and every bank account at the
-- savings APY, and never took money out on purpose — a year that spent more
-- than it earned simply shrank one pot. Victor's old Financial Planner kept
-- TSP, each Roth, taxable stocks, cash, crypto and gold apart, each with its
-- own return, contributions and withdrawals (2026-10-16). This brings that
-- back, grouped by type so it works for any household, not only a TSP one:
--
--   * retirement_account_groups — one row per group the household has set
--     up: its return, what it adds a year and when, what it pays out a year
--     (today's dollars, raised by inflation) and when, and the tax on what it
--     pays out. A blank figure means the plan's default (see lib/account-groups).
--   * accounts.plan_group / buckets.plan_group — which group an account or
--     bucket belongs to. Null = worked out from its type, name and tax label.
--   * networth_projection.withdrawn_cents / withdrawal_tax_cents /
--     planned_add_cents / groups — what each future year takes out, the tax
--     on it (already inside spending_cents), what it adds, and the per-group
--     detail behind the year popup. Written by the recompute; null on years
--     it hasn't touched.

create table if not exists retirement_account_groups (
  household_id      uuid not null references households(id) on delete cascade,
  kind              text not null check (kind in ('cash', 'pretax', 'roth', 'brokerage', 'crypto', 'metals')),
  -- Null = the plan's investment return (cash: the savings APY).
  return_pct        numeric(5,2) check (return_pct is null or (return_pct >= -20 and return_pct <= 30)),
  -- Added each year, flat. Null = what the last 12 months put in.
  add_annual_cents  bigint check (add_annual_cents is null or add_annual_cents >= 0),
  add_start_year    integer check (add_start_year is null or (add_start_year > 1900 and add_start_year < 2200)),
  add_end_year      integer check (add_end_year is null or (add_end_year > 1900 and add_end_year < 2200)),
  -- Paid out each year in today's dollars, raised by inflation. Null = none.
  take_annual_cents bigint check (take_annual_cents is null or take_annual_cents >= 0),
  take_start_year   integer check (take_start_year is null or (take_start_year > 1900 and take_start_year < 2200)),
  take_end_year     integer check (take_end_year is null or (take_end_year > 1900 and take_end_year < 2200)),
  -- Flat % of what is paid out. Null = the group's default.
  tax_pct           numeric(5,2) check (tax_pct is null or (tax_pct >= 0 and tax_pct <= 60)),
  updated_at        timestamptz not null default now(),
  primary key (household_id, kind),
  check (add_start_year is null or add_end_year is null or add_end_year >= add_start_year),
  check (take_start_year is null or take_end_year is null or take_end_year >= take_start_year)
);

alter table retirement_account_groups enable row level security;

drop policy if exists retirement_account_groups_all on retirement_account_groups;
create policy retirement_account_groups_all on retirement_account_groups
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

alter table accounts add column if not exists plan_group text;
alter table buckets add column if not exists plan_group text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_plan_group_check') then
    alter table accounts add constraint accounts_plan_group_check
      check (plan_group is null or plan_group in ('cash', 'pretax', 'roth', 'brokerage', 'crypto', 'metals'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buckets_plan_group_check') then
    alter table buckets add constraint buckets_plan_group_check
      check (plan_group is null or plan_group in ('cash', 'pretax', 'roth', 'brokerage', 'crypto', 'metals'));
  end if;
end $$;

alter table networth_projection
  add column if not exists withdrawn_cents bigint,
  add column if not exists withdrawal_tax_cents bigint,
  add column if not exists planned_add_cents bigint,
  add column if not exists groups jsonb;

comment on column networth_projection.withdrawal_tax_cents is
  'Tax on that year''s withdrawals. Already included in spending_cents.';
