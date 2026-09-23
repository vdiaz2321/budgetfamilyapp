-- 20260923120000 added pre_trip_subcategory_id as a foreign key to
-- subcategories. That gave transactions a SECOND relationship to
-- subcategories, and PostgREST refuses every existing `subcategories(...)`
-- embed on transactions as ambiguous ("more than one relationship was found")
-- — the Travel Log, Budget and Transactions reads all failed. Keep the column,
-- drop the constraint: the value is only read back to restore a purchase's
-- item, and untagTripPurchases re-checks it belongs to the household.
alter table public.transactions
  drop constraint if exists transactions_pre_trip_subcategory_id_fkey;
