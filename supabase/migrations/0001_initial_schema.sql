-- Budget Family App — initial schema
-- Run this in Supabase → SQL Editor → New query.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.

-- =========================================================
-- Extensions
-- =========================================================
create extension if not exists "uuid-ossp";

-- =========================================================
-- Enums
-- =========================================================
do $$ begin
  create type category_kind as enum ('bills', 'expenses', 'savings', 'debt', 'income');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_kind as enum (
    'credit_card', 'cash', 'checking', 'savings_bucket', 'debt_loan'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type transaction_source as enum ('manual', 'receipt_scan', 'import');
exception when duplicate_object then null; end $$;

-- =========================================================
-- Households (one row per family; supports multi-user later)
-- =========================================================
create table if not exists households (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  currency     text not null default 'USD',
  created_at   timestamptz not null default now()
);

-- =========================================================
-- Profile: link auth.users → household
-- =========================================================
create table if not exists profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now()
);

create index if not exists profiles_household_idx on profiles(household_id);

-- =========================================================
-- Reference tables
-- =========================================================
create table if not exists categories (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  kind          category_kind not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists subcategories (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  category_id   uuid not null references categories(id) on delete cascade,
  name          text not null,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (household_id, category_id, name)
);

create table if not exists payees (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists accounts (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  kind          account_kind not null,
  holder        text,  -- 'V' / 'J' style from the sheet, freeform
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (household_id, name)
);

-- =========================================================
-- Transactions — the Log tab, normalized
-- =========================================================
create table if not exists transactions (
  id                 uuid primary key default uuid_generate_v4(),
  household_id       uuid not null references households(id) on delete cascade,
  occurred_on        date not null,
  amount_cents       bigint not null,  -- always positive; sign implied by category kind
  currency           text not null default 'USD',
  category_id        uuid references categories(id) on delete set null,
  subcategory_id     uuid references subcategories(id) on delete set null,
  payee_id           uuid references payees(id) on delete set null,
  account_id         uuid references accounts(id) on delete set null,
  memo               text,
  receipt_image_url  text,
  source             transaction_source not null default 'manual',
  import_hash        text,  -- date + amount + payee + memo hash for idempotent imports
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (household_id, import_hash)
);

create index if not exists transactions_household_date_idx
  on transactions (household_id, occurred_on desc);

create index if not exists transactions_subcategory_idx
  on transactions (subcategory_id);

-- =========================================================
-- Budget plans — planned amount per subcategory per month
-- =========================================================
create table if not exists budget_plans (
  id             uuid primary key default uuid_generate_v4(),
  household_id   uuid not null references households(id) on delete cascade,
  month          date not null,  -- store as first-of-month
  subcategory_id uuid not null references subcategories(id) on delete cascade,
  planned_cents  bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, month, subcategory_id)
);

-- =========================================================
-- Debts + savings goals (data model ready for later dashboards)
-- =========================================================
create table if not exists debts (
  id                     uuid primary key default uuid_generate_v4(),
  household_id           uuid not null references households(id) on delete cascade,
  account_id             uuid not null references accounts(id) on delete cascade,
  original_balance_cents bigint not null,
  apr                    numeric(6,3),
  min_payment_cents      bigint,
  payoff_target_date     date,
  created_at             timestamptz not null default now(),
  unique (household_id, account_id)
);

create table if not exists savings_goals (
  id             uuid primary key default uuid_generate_v4(),
  household_id   uuid not null references households(id) on delete cascade,
  account_id     uuid not null references accounts(id) on delete cascade,
  target_cents   bigint not null,
  target_date    date,
  created_at     timestamptz not null default now(),
  unique (household_id, account_id)
);

-- =========================================================
-- Views (the "toggle" is a UI switch over these)
-- =========================================================

-- Monthly actuals per subcategory
create or replace view v_monthly_actuals as
select
  t.household_id,
  date_trunc('month', t.occurred_on)::date as month,
  t.category_id,
  t.subcategory_id,
  sum(t.amount_cents)::bigint as actual_cents,
  count(*)::int as tx_count
from transactions t
group by 1, 2, 3, 4;

-- Annual pivot: subcategory rows × month columns for a year
create or replace view v_annual_breakdown as
select
  household_id,
  extract(year from month)::int as year,
  category_id,
  subcategory_id,
  sum(case when extract(month from month) = 1  then actual_cents else 0 end)::bigint as jan,
  sum(case when extract(month from month) = 2  then actual_cents else 0 end)::bigint as feb,
  sum(case when extract(month from month) = 3  then actual_cents else 0 end)::bigint as mar,
  sum(case when extract(month from month) = 4  then actual_cents else 0 end)::bigint as apr,
  sum(case when extract(month from month) = 5  then actual_cents else 0 end)::bigint as may,
  sum(case when extract(month from month) = 6  then actual_cents else 0 end)::bigint as jun,
  sum(case when extract(month from month) = 7  then actual_cents else 0 end)::bigint as jul,
  sum(case when extract(month from month) = 8  then actual_cents else 0 end)::bigint as aug,
  sum(case when extract(month from month) = 9  then actual_cents else 0 end)::bigint as sep,
  sum(case when extract(month from month) = 10 then actual_cents else 0 end)::bigint as oct,
  sum(case when extract(month from month) = 11 then actual_cents else 0 end)::bigint as nov,
  sum(case when extract(month from month) = 12 then actual_cents else 0 end)::bigint as dec_,
  sum(actual_cents)::bigint as ytd_cents
from v_monthly_actuals
group by 1, 2, 3, 4;

-- Year summary: totals per category for a year
create or replace view v_year_summary as
select
  household_id,
  extract(year from occurred_on)::int as year,
  category_id,
  sum(amount_cents)::bigint as total_cents,
  count(*)::int as tx_count
from transactions
group by 1, 2, 3;

-- =========================================================
-- Row Level Security
-- =========================================================

-- Helper: current user's household
create or replace function auth_household_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select household_id from profiles where user_id = auth.uid();
$$;

alter table households      enable row level security;
alter table profiles        enable row level security;
alter table categories      enable row level security;
alter table subcategories   enable row level security;
alter table payees          enable row level security;
alter table accounts        enable row level security;
alter table transactions    enable row level security;
alter table budget_plans    enable row level security;
alter table debts           enable row level security;
alter table savings_goals   enable row level security;

-- Households: readable by members; a user can create their own household on first sign-in.
drop policy if exists households_select on households;
create policy households_select on households
  for select using (id = auth_household_id());

drop policy if exists households_insert on households;
create policy households_insert on households
  for insert with check (true);

drop policy if exists households_update on households;
create policy households_update on households
  for update using (id = auth_household_id())
  with check (id = auth_household_id());

-- Profiles: users see and manage only their own profile row.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select using (user_id = auth.uid());

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles
  for insert with check (user_id = auth.uid());

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Reference + fact tables: scoped to caller's household.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'subcategories', 'payees', 'accounts',
    'transactions', 'budget_plans', 'debts', 'savings_goals'
  ]
  loop
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format(
      'create policy %I_all on %I for all
         using (household_id = auth_household_id())
         with check (household_id = auth_household_id())',
      t, t
    );
  end loop;
end $$;
