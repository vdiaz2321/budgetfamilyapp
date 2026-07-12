-- Link a Savings budget item to a bucket (or a bucket-less account), so
-- monthly contributions logged in Budget add straight to that bucket's
-- balance instead of being entered twice. Withdrawals (e.g. using a bucket's
-- funds for a purchase) are transactions flagged to subtract instead of add.

alter table subcategories
  add column if not exists linked_bucket_id uuid references buckets(id) on delete set null;

alter table transactions
  add column if not exists is_withdrawal boolean not null default false;
