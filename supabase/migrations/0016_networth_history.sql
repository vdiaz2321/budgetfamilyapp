-- Net Worth rebuild, phase 1 schema.
--
-- 1) accounts.bank_group — splits Banking (checking / savings_bucket) into the
--    long-term "savings" pile vs everyday "spending" accounts, so the Net Worth
--    analytics can track Current Savings separately from Bank Accounts (matching
--    the sheet). Only meaningful for non-investment asset accounts; null reads as
--    'spending'. Investment / Kids Funding accounts ignore it.
alter table accounts
  add column if not exists bank_group text
    check (bank_group in ('savings', 'spending'));

-- 2) networth_history — section-level monthly totals for the pre-per-account era
--    (Victor's 2018–2025, and any user's history before they start entering
--    individual account balances). The app derives these same four numbers from
--    account_snapshots once per-account data exists for a month; this table is the
--    fallback for months that have none. All four are optional so a user can fill
--    only what they have.
create table if not exists networth_history (
  household_id  uuid not null references households(id) on delete cascade,
  month         date not null,            -- first-of-month
  savings_cents bigint not null default 0, -- long-term savings pile
  bank_cents    bigint not null default 0, -- everyday bank accounts
  stocks_cents  bigint not null default 0, -- investments
  debt_cents    bigint not null default 0, -- liabilities
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (household_id, month)
);

create index if not exists networth_history_household_month_idx
  on networth_history (household_id, month);

alter table networth_history enable row level security;

drop policy if exists networth_history_all on networth_history;
create policy networth_history_all on networth_history for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
