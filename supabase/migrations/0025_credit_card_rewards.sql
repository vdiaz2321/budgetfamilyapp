-- Full rewards tracker for credit cards (mirrors Victor's Google Sheet columns)
-- and a payment-to-card link on transactions so "owed" auto-computes from
-- charges minus payments without needing a "transfer" concept.

-- One row per credit_card account. Fields kept off the generic accounts table
-- so they don't clutter every other kind. Filled lazily on first save.
create table if not exists credit_card_details (
  account_id                uuid        primary key references accounts(id) on delete cascade,
  household_id              uuid        not null references households(id) on delete cascade,
  bank                      text,
  auth_user                 text,
  charging                  text,
  bonus_info                text,
  bonus_spend_cents         bigint,
  bonus_spend_deadline      date,
  bonus_earned              boolean     not null default false,
  current_points            integer     not null default 0,
  fees_paid_cents           bigint      not null default 0,
  free_night_credit_cents   bigint,
  free_night_expires_on     date,
  spending_limit_cents      bigint,
  remarks                   text,
  is_revolving_debt         boolean     not null default false,
  debt_subcategory_id       uuid        references subcategories(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists credit_card_details_household_idx on credit_card_details (household_id);
alter table credit_card_details enable row level security;
drop policy if exists credit_card_details_all on credit_card_details;
create policy credit_card_details_all on credit_card_details for all
  using  (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- One-row payment model for CC payoffs: the transaction's account_id is the
-- SOURCE bank (that's what gets debited), and paid_to_account_id is the CC
-- (whose auto-computed "owed" tally is reduced by the same amount).
-- Nullable — set only for CC payment rows. Every existing row stays NULL.
alter table transactions
  add column if not exists paid_to_account_id uuid references accounts(id) on delete set null;
create index if not exists transactions_paid_to_idx
  on transactions (paid_to_account_id)
  where paid_to_account_id is not null;
