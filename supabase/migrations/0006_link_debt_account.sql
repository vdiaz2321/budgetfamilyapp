-- De-dup net worth: a Budget debt can link to the account it represents
-- (e.g. a credit card entered in both places). Networth then skips the
-- account's balance and uses the Budget debt's, so nothing counts twice.

alter table debts
  add column if not exists account_id uuid references accounts(id) on delete set null;

-- One debt per linked account.
create unique index if not exists debts_account_link_idx
  on debts (account_id)
  where account_id is not null;
