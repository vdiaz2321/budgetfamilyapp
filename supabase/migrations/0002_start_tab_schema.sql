-- Reshape schema to match the Google Sheet's Start tab exactly.
-- Safe to re-run: uses IF NOT EXISTS / DROP IF EXISTS.

-- =========================================================
-- households: add year + snowball settings
-- =========================================================
alter table households
  add column if not exists year int not null default extract(year from now())::int;

alter table households
  add column if not exists snowball_start_date date;

alter table households
  add column if not exists snowball_monthly_extra_cents bigint not null default 0;

-- =========================================================
-- subcategories: due_day (used by Bills and Debt entries)
-- =========================================================
alter table subcategories
  add column if not exists due_day int;

alter table subcategories
  drop constraint if exists subcategories_due_day_range;
alter table subcategories
  add constraint subcategories_due_day_range
  check (due_day is null or (due_day between 1 and 31));

-- =========================================================
-- savings_goals: rekey to subcategory_id and add start + monthly
-- =========================================================
-- Drop the old shape (zero rows in production so far)
drop table if exists savings_goals;

create table savings_goals (
  id                        uuid primary key default uuid_generate_v4(),
  household_id              uuid not null references households(id) on delete cascade,
  subcategory_id            uuid not null references subcategories(id) on delete cascade,
  goal_cents                bigint not null default 0,
  start_cents               bigint not null default 0,
  monthly_contribution_cents bigint not null default 0,
  target_date               date,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (household_id, subcategory_id)
);

alter table savings_goals enable row level security;

drop policy if exists savings_goals_all on savings_goals;
create policy savings_goals_all on savings_goals for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- =========================================================
-- debts: rekey to subcategory_id, add due_day, rename balance field
-- =========================================================
drop table if exists debts;

create table debts (
  id                     uuid primary key default uuid_generate_v4(),
  household_id           uuid not null references households(id) on delete cascade,
  subcategory_id         uuid not null references subcategories(id) on delete cascade,
  current_balance_cents  bigint not null default 0,
  min_payment_cents      bigint not null default 0,
  apr                    numeric(6,3) not null default 0,
  due_day                int,
  payoff_target_date     date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (household_id, subcategory_id),
  constraint debts_due_day_range check (due_day is null or (due_day between 1 and 31))
);

alter table debts enable row level security;

drop policy if exists debts_all on debts;
create policy debts_all on debts for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
