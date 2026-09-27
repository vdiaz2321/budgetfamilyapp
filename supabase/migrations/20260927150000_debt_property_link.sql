-- A mortgage counts against net worth when it is linked to the property it
-- is for (Victor, 2026-09-27). A mortgage with no Property link stays out of
-- net worth — the 2026-09-12 rule for a home that isn't carried as an asset.
--
-- The link lives on the debt, because `debts` is the one liability ledger
-- (lib/debt-identity.ts). The property's equity is its value − this balance.

alter table debts
  add column if not exists property_account_id uuid references accounts(id) on delete set null;

create index if not exists debts_property_account_idx
  on debts (property_account_id)
  where property_account_id is not null;
