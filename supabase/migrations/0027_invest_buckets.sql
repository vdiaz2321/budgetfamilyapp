-- Bucket-level investment tracking. Some investment accounts (Fidelity, Crypto)
-- hold multiple sub-accounts (Roth IRA Vic, Taxable Vic, Roth Jo / Tangem,
-- Kraken, River, Robinhood). This adds an optional bucket_id everywhere the
-- Invest page reads its numbers, so a bucket-less account still works exactly
-- as before (bucket_id stays NULL).

-- 1) investment_years — add nullable bucket_id + swap the composite PK for a
-- surrogate id, because a PK column can't hold NULL and every existing row's
-- bucket_id defaults to NULL (account-level "unallocated" slot). Uniqueness
-- is enforced via two partial indexes instead.
alter table investment_years
  add column if not exists bucket_id uuid references buckets(id) on delete cascade;

alter table investment_years
  add column if not exists id uuid not null default gen_random_uuid();

alter table investment_years drop constraint if exists investment_years_pkey;
alter table investment_years add constraint investment_years_pkey primary key (id);

-- One row per (household, account, year) when bucket_id is NULL (account-level).
create unique index if not exists investment_years_account_year_no_bucket
  on investment_years (household_id, account_id, year)
  where bucket_id is null;

-- One row per (household, account, year, bucket) when a bucket is attached.
create unique index if not exists investment_years_account_year_bucket
  on investment_years (household_id, account_id, year, bucket_id)
  where bucket_id is not null;

-- 2) transactions — direct bucket attribution. Distinct from the existing
-- subcategory.linked_bucket_id path (used by savings), which stays untouched.
alter table transactions
  add column if not exists bucket_id uuid references buckets(id) on delete set null;

create index if not exists idx_tx_bucket
  on transactions(bucket_id)
  where bucket_id is not null;

-- 3) View: group by bucket_id too, so the Invest page can key contributions
-- by (account, bucket, year). Must drop first — `create or replace view` can't
-- add/reorder columns of an existing view.
drop view if exists v_investment_contributions;
create view v_investment_contributions as
select
  t.household_id,
  t.account_id,
  t.bucket_id,
  extract(year from t.occurred_on)::int as year,
  sum(case when t.is_withdrawal then -t.amount_cents else t.amount_cents end)::bigint
    as net_contribution_cents
from transactions t
join accounts a on a.id = t.account_id
where a.kind = 'investment'
group by t.household_id, t.account_id, t.bucket_id, extract(year from t.occurred_on)::int;
