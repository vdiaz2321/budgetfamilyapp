-- Month-end update checklist (Accounts → "Month-end update").
--
-- Victor updates Investments, Kids Funding and Savings balances once a month
-- from the real statements. If he stops partway through he loses track of which
-- rows he has already done — in Oct 2026 half went into the SEP column and half
-- into OCT. One row here = "this account (or bucket) is done for this month".
-- Saving a value ticks it; ticking without a change means "same as last month".
--
-- Exactly one of account_id / bucket_id is set: a bucketed account is ticked
-- per bucket, a plain account on itself. Both cascade, so deleting an account
-- or bucket clears its ticks.

create table if not exists public.month_end_checks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,
  account_id uuid references public.accounts(id) on delete cascade,
  bucket_id uuid references public.buckets(id) on delete cascade,
  checked_at timestamptz not null default now(),
  constraint month_end_checks_one_target check ((account_id is null) <> (bucket_id is null))
);

create unique index if not exists month_end_checks_account_uq
  on public.month_end_checks (household_id, month, account_id) where account_id is not null;
create unique index if not exists month_end_checks_bucket_uq
  on public.month_end_checks (household_id, month, bucket_id) where bucket_id is not null;

alter table public.month_end_checks enable row level security;

drop policy if exists month_end_checks_all on public.month_end_checks;
create policy month_end_checks_all on public.month_end_checks
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
