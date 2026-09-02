-- Tag a transaction with the property it belongs to.
--
-- A rental's rent is Income and its repairs are Expenses, so the two halves of
-- one property's P&L live in different category groups and nothing joined them.
-- This is that join: the property account (kind = 'property') whose value Net
-- Worth already carries.
--
-- ON DELETE SET NULL, never cascade — removing a property must not delete the
-- transactions that happened at it; they simply lose the tag.
alter table transactions
  add column if not exists property_id uuid references accounts(id) on delete set null;

create index if not exists transactions_household_property_idx
  on transactions (household_id, property_id)
  where property_id is not null;
