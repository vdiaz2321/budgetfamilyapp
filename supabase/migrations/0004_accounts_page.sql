-- Accounts page (step 4): investment account kind + live balance on accounts.
-- Balances entered here feed Networth (step 6) and the monthly snapshot
-- engine (step 5) will archive them per month.

-- New kind for Investments / Brokerages (plan's four account types).
alter type account_kind add value if not exists 'investment';

-- Live balance, entered/edited on the Accounts page. Positive numbers for
-- everything; credit cards & loans are treated as liabilities in the UI math.
alter table accounts
  add column if not exists current_balance_cents bigint not null default 0;

alter table accounts
  add column if not exists updated_at timestamptz not null default now();
