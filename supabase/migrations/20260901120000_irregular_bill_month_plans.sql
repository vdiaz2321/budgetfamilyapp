-- Per-month planned amounts for irregular bills.
--
-- Irregular bills are, by definition, not monthly — a passport renewal or a
-- bike repair is planned for one specific month. Until now the Budget page
-- derived the Planned column from irregular_bills.typical_amount_cents, which
-- is a single value per bill, so every month showed the same plan forever and
-- a new month opened with amounts already budgeted.
--
-- The planned amount now lives per (bill, month): a month with no row plans
-- $0. typical_amount_cents stays what its name says — a reference hint shown
-- on /subscriptions — and no longer drives the budget.
create table if not exists irregular_bill_plans (
  id             uuid        primary key default gen_random_uuid(),
  household_id   uuid        not null references households(id) on delete cascade,
  bill_id        uuid        not null references irregular_bills(id) on delete cascade,
  month          date        not null,  -- always the first of the month
  planned_cents  bigint      not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, bill_id, month)
);

create index if not exists irregular_bill_plans_household_month_idx
  on irregular_bill_plans (household_id, month);

alter table irregular_bill_plans enable row level security;
drop policy if exists irregular_bill_plans_all on irregular_bill_plans;
create policy irregular_bill_plans_all on irregular_bill_plans for all
  using  (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- Backfill: every irregular bill was created during August 2026, and August's
-- planned column was the typical amount, so seed that month from it. Earlier
-- months predate the card entirely — their planned figure stays where it has
-- always been, on the subcategory's budget_plans row, and the app falls back
-- to it for any month that carries no per-bill plans.
insert into irregular_bill_plans (household_id, bill_id, month, planned_cents)
select household_id, id, date '2026-08-01', typical_amount_cents
from irregular_bills
where typical_amount_cents > 0
on conflict (household_id, bill_id, month) do nothing;
