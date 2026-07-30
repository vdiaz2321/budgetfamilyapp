-- A Savings subcategory can now link straight to an investment account
-- (TSP, Charles Schwab, M1, etc.) when that account has no buckets. Bucketed
-- accounts (Fidelity, Crypto, Amex Savings, Cap One) still link via
-- linked_bucket_id so the bucket-level breakdown stays intact.
alter table subcategories
  add column if not exists linked_account_id uuid references accounts(id) on delete set null;

-- Only one of the two link columns may be set at a time — a subcategory
-- either targets a bucket OR a bare account, never both.
alter table subcategories
  drop constraint if exists subcategories_one_link_target;
alter table subcategories
  add constraint subcategories_one_link_target
  check (linked_bucket_id is null or linked_account_id is null);

create index if not exists idx_subcategories_linked_account
  on subcategories(linked_account_id) where linked_account_id is not null;
