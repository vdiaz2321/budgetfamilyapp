-- Fix v_investment_contributions to capture contributions routed via the
-- savings linked-bucket path.
--
-- The original view only counted transactions WHERE t.account_id joins to an
-- investment account. But when a user logs a Savings item linked to an
-- investment bucket (e.g. "Roth IRA (Vic)" → "Fidelity Roth IRA Vic bucket"),
-- the transaction has account_id = the banking account (e.g. Amex Checking),
-- so the view was blind to it — even though the bucket balance updated correctly.
--
-- Fix: also include transactions where t.bucket_id belongs to an investment
-- account. In that case use the investment account as the contribution's
-- account_id so the Invest page still groups correctly.

create or replace view v_investment_contributions as
select
  t.household_id,
  -- For direct investment-account transactions, use t.account_id.
  -- For linked-bucket savings transactions, use the investment account the
  -- bucket belongs to.
  coalesce(a_direct.id, a_bucket.id)                        as account_id,
  t.bucket_id,
  extract(year from t.occurred_on)::int                     as year,
  sum(
    case when t.is_withdrawal
         then -t.amount_cents
         else  t.amount_cents
    end
  )::bigint                                                  as net_contribution_cents
from transactions t
-- Path 1: transaction is directly on an investment account
left join accounts a_direct
  on a_direct.id = t.account_id
 and a_direct.kind = 'investment'
-- Path 2: transaction has a bucket whose parent account is investment
left join buckets b_linked
  on b_linked.id = t.bucket_id
left join accounts a_bucket
  on a_bucket.id = b_linked.account_id
 and a_bucket.kind = 'investment'
where
  a_direct.id is not null   -- path 1 matched
  or a_bucket.id is not null -- path 2 matched
group by
  t.household_id,
  coalesce(a_direct.id, a_bucket.id),
  t.bucket_id,
  extract(year from t.occurred_on)::int;
