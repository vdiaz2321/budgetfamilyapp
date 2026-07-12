-- Monthly snapshot engine (step 5): archive account + debt balances per month.
-- No cron needed — the app upserts the *current* month's rows whenever a
-- balance changes (Accounts page, Budget debt panel) or Networth loads. When
-- the month rolls over, the previous month's rows stop being touched and are
-- frozen history. budget_plans is already per-month, so plans need no snapshot.

create table if not exists account_snapshots (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  month         date not null,  -- first-of-month
  account_id    uuid not null references accounts(id) on delete cascade,
  kind          account_kind not null,  -- copied so history survives kind edits
  balance_cents bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, month, account_id)
);

create index if not exists account_snapshots_household_month_idx
  on account_snapshots (household_id, month);

alter table account_snapshots enable row level security;

drop policy if exists account_snapshots_all on account_snapshots;
create policy account_snapshots_all on account_snapshots for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

create table if not exists debt_snapshots (
  id             uuid primary key default uuid_generate_v4(),
  household_id   uuid not null references households(id) on delete cascade,
  month          date not null,  -- first-of-month
  subcategory_id uuid not null references subcategories(id) on delete cascade,
  balance_cents  bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, month, subcategory_id)
);

create index if not exists debt_snapshots_household_month_idx
  on debt_snapshots (household_id, month);

alter table debt_snapshots enable row level security;

drop policy if exists debt_snapshots_all on debt_snapshots;
create policy debt_snapshots_all on debt_snapshots for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
