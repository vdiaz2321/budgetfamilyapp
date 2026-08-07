-- Migration 0036: include Kids Funding accounts in investment contributions.
-- Context: kids' 529/UTMA buckets live under accounts kind='checking' flagged
-- is_kids_account=true. The Invest page shows them in a Kids Funding section
-- alongside kind='investment' accounts, but the contributions view only
-- accepted the investment kind — so Log transactions tagged to those buckets
-- never rolled up into the Kids Funding Contrib column.

create or replace view v_investment_contributions as
with resolved as (
  select
    t.household_id,
    t.account_id           as tx_account_id,
    coalesce(t.bucket_id, s.linked_bucket_id) as resolved_bucket_id,
    t.is_withdrawal,
    t.amount_cents,
    t.occurred_on
  from transactions t
  left join subcategories s on s.id = t.subcategory_id
)
select
  r.household_id,
  coalesce(a_direct.id, a_bucket.id) as account_id,
  r.resolved_bucket_id as bucket_id,
  extract(year from r.occurred_on)::int as year,
  sum(
    case when r.is_withdrawal then -r.amount_cents else r.amount_cents end
  )::bigint as net_contribution_cents
from resolved r
left join accounts a_direct
  on a_direct.id = r.tx_account_id
  and (a_direct.kind = 'investment' or a_direct.is_kids_account = true)
left join buckets b_linked
  on b_linked.id = r.resolved_bucket_id
left join accounts a_bucket
  on a_bucket.id = b_linked.account_id
  and (a_bucket.kind = 'investment' or a_bucket.is_kids_account = true)
where a_direct.id is not null or a_bucket.id is not null
group by
  r.household_id,
  coalesce(a_direct.id, a_bucket.id),
  r.resolved_bucket_id,
  extract(year from r.occurred_on)::int;
