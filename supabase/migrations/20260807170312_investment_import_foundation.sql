-- Foundation only for a future brokerage-neutral investment importer.
-- No existing accounts, buckets, balances, transactions, or history are changed.

create table public.investment_import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  bucket_id uuid references public.buckets(id) on delete set null,
  provider text not null,
  import_kind text not null check (import_kind in ('positions', 'performance')),
  as_of_date date not null,
  source_filename text,
  source_hash text,
  column_mapping jsonb not null default '{}'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  created_at timestamptz not null default now()
);

create table public.investment_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  import_batch_id uuid not null references public.investment_import_batches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  bucket_id uuid references public.buckets(id) on delete set null,
  as_of_date date not null,
  symbol text,
  security_name text not null,
  asset_class text,
  quantity numeric,
  price_cents bigint,
  market_value_cents bigint not null,
  cost_basis_cents bigint,
  unrealized_gain_cents bigint,
  unrealized_gain_percent numeric,
  created_at timestamptz not null default now()
);

create table public.investment_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  import_batch_id uuid not null references public.investment_import_batches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  bucket_id uuid references public.buckets(id) on delete set null,
  as_of_date date not null,
  beginning_balance_cents bigint,
  contributions_cents bigint,
  withdrawals_cents bigint,
  dividends_cents bigint,
  fees_cents bigint,
  market_change_cents bigint,
  ending_balance_cents bigint not null,
  created_at timestamptz not null default now()
);

create index investment_import_batches_household_account_date_idx
  on public.investment_import_batches (household_id, account_id, as_of_date desc);

create index investment_position_snapshots_import_idx
  on public.investment_position_snapshots (import_batch_id);

create index investment_position_snapshots_lookup_idx
  on public.investment_position_snapshots (household_id, account_id, bucket_id, as_of_date desc);

create index investment_performance_snapshots_lookup_idx
  on public.investment_performance_snapshots (household_id, account_id, bucket_id, as_of_date desc);

alter table public.investment_import_batches enable row level security;
alter table public.investment_position_snapshots enable row level security;
alter table public.investment_performance_snapshots enable row level security;

create policy investment_import_batches_household_access
  on public.investment_import_batches
  for all to authenticated
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

create policy investment_position_snapshots_household_access
  on public.investment_position_snapshots
  for all to authenticated
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

create policy investment_performance_snapshots_household_access
  on public.investment_performance_snapshots
  for all to authenticated
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
