-- Savings sub-buckets / envelopes (the AMEX Savings case).
-- One physical account holds several virtual sinking funds (Emergency Fund,
-- Vehicle Purchase, Real Estate, ...). The account keeps its REAL total balance
-- (that's what feeds net worth); buckets are a breakdown of it. The leftover
-- (account balance − sum of buckets) is shown as an auto-computed "Unallocated"
-- remainder in the UI, so nothing is double-counted and net worth math is
-- untouched — buckets are display/tracking only.

create table if not exists buckets (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  name          text not null,
  balance_cents bigint not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, account_id, name)
);

create index if not exists buckets_household_account_idx
  on buckets (household_id, account_id);

alter table buckets enable row level security;

drop policy if exists buckets_all on buckets;
create policy buckets_all on buckets for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- Monthly history per bucket, mirroring account_snapshots. Lazily upserted for
-- the current month; prior months freeze once the month rolls over.
create table if not exists bucket_snapshots (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  month         date not null,  -- first-of-month
  bucket_id     uuid not null references buckets(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  balance_cents bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, month, bucket_id)
);

create index if not exists bucket_snapshots_household_month_idx
  on bucket_snapshots (household_id, month);

alter table bucket_snapshots enable row level security;

drop policy if exists bucket_snapshots_all on bucket_snapshots;
create policy bucket_snapshots_all on bucket_snapshots for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
