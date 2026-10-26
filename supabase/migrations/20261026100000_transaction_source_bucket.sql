-- The bucket a Budget transaction's money left, on a bank account that holds
-- buckets (Amex Savings → Real Estate) (Victor, 2026-10-26).
--
-- A bucketed bank account's balance is the sum of its buckets, so a payment
-- from it has to say which bucket it came out of — otherwise the app can't
-- move it at all, and a monthly Fidelity buy out of the Real Estate money
-- counted twice in Net Worth until the bucket was lowered by hand.
--
-- Separate from transactions.bucket_id on purpose: v_investment_contributions
-- resolves a contribution's fund as COALESCE(bucket_id, linked_bucket_id), so
-- storing the Amex bucket there would pull the buy out of Fidelity's
-- contributions. Null = no bucket picked (the account doesn't move — the old
-- behaviour).
--
-- A column on an existing table: its grants and RLS policy already cover it.

alter table public.transactions
  add column if not exists source_bucket_id uuid references public.buckets(id) on delete set null;

create index if not exists transactions_source_bucket_idx
  on public.transactions (source_bucket_id)
  where source_bucket_id is not null;
