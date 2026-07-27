-- Migration 0029: also count investment contributions routed through a
-- Savings subcategory that's linked to an investment bucket.
--
-- Context: on the Budget page, a Savings item like "Fidelity Roth Vic" is
-- linked to an investment bucket via subcategories.linked_bucket_id. When
-- Victor logs a transaction against that subcategory, the transaction row
-- itself carries subcategory_id but NOT bucket_id (bucket_id is only set
-- when using the direct bucket picker on investment accounts).
--
-- Migration 0028 already added the direct-bucket path. This one adds the
-- subcategory→linked_bucket_id path so those Savings-based contributions
-- also flow into Invest page Contrib / Total Contributed.
--
-- The view resolves the bucket_id from THREE sources in priority order:
--   1. t.bucket_id (direct bucket picker on the modal — investment account)
--   2. subcategories.linked_bucket_id (savings item linked to a bucket)
--   3. NULL (unbucketed contribution — direct-on-account only)
-- And the owning investment account from EITHER the direct account_id or
-- the resolved bucket's parent account.

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
  on a_direct.id = r.tx_account_id and a_direct.kind = 'investment'
left join buckets b_linked
  on b_linked.id = r.resolved_bucket_id
left join accounts a_bucket
  on a_bucket.id = b_linked.account_id and a_bucket.kind = 'investment'
where a_direct.id is not null or a_bucket.id is not null
group by
  r.household_id,
  coalesce(a_direct.id, a_bucket.id),
  r.resolved_bucket_id,
  extract(year from r.occurred_on)::int;
