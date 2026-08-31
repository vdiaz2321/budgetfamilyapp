-- Month-grained investment contributions.
--
-- The Invest / Savings header shows "Contributed this month", which the
-- year-grained v_investment_contributions can't answer. Rather than
-- re-deriving the three-way account resolution in TypeScript — the exact
-- duplication that made /savings and /invest disagree twice before — the
-- resolution now lives in ONE monthly view, and the yearly view is redefined
-- as a plain rollup of it.
--
-- v_investment_contributions keeps its existing column set and types, so every
-- current reader is unaffected.

create or replace view v_investment_contributions_monthly
with (security_invoker = true) as
with resolved as (
  select
    t.household_id,
    t.account_id as tx_account_id,
    coalesce(t.bucket_id, s.linked_bucket_id) as resolved_bucket_id,
    s.linked_account_id,
    t.is_withdrawal,
    t.amount_cents,
    t.occurred_on
  from transactions t
  left join subcategories s on s.id = t.subcategory_id
)
select
  r.household_id,
  coalesce(a_direct.id, a_bucket.id, a_linked.id) as account_id,
  r.resolved_bucket_id as bucket_id,
  date_trunc('month', r.occurred_on)::date as month,
  extract(year from r.occurred_on)::integer as year,
  sum(case when r.is_withdrawal then -r.amount_cents else r.amount_cents end)::bigint
    as net_contribution_cents,
  sum(case when r.is_withdrawal then 0::bigint else r.amount_cents end)::bigint
    as gross_contribution_cents,
  sum(case when r.is_withdrawal then r.amount_cents else 0::bigint end)::bigint
    as withdrawal_cents
from resolved r
  left join accounts a_direct
    on a_direct.id = r.tx_account_id
   and (a_direct.kind = 'investment'::account_kind or a_direct.is_kids_account = true)
  left join buckets b_linked
    on b_linked.id = r.resolved_bucket_id
  left join accounts a_bucket
    on a_bucket.id = b_linked.account_id
   and (a_bucket.kind = 'investment'::account_kind or a_bucket.is_kids_account = true)
  left join accounts a_linked
    on a_linked.id = r.linked_account_id
   and (a_linked.kind = 'investment'::account_kind or a_linked.is_kids_account = true)
where a_direct.id is not null or a_bucket.id is not null or a_linked.id is not null
group by
  r.household_id,
  coalesce(a_direct.id, a_bucket.id, a_linked.id),
  r.resolved_bucket_id,
  date_trunc('month', r.occurred_on)::date,
  extract(year from r.occurred_on)::integer;

-- Same columns, same types as before — now a rollup rather than a second copy
-- of the resolution logic.
create or replace view v_investment_contributions
with (security_invoker = true) as
select
  household_id,
  account_id,
  bucket_id,
  year,
  sum(net_contribution_cents)::bigint as net_contribution_cents,
  sum(gross_contribution_cents)::bigint as gross_contribution_cents,
  sum(withdrawal_cents)::bigint as withdrawal_cents
from v_investment_contributions_monthly
group by household_id, account_id, bucket_id, year;

-- Both views previously ran as owner while SELECT was granted to anon and
-- authenticated, so RLS on transactions/accounts/buckets was bypassed and a
-- query without a household_id filter could read every household's data.
-- security_invoker makes the caller's RLS apply. Every in-app reader already
-- filters by household_id, so legitimate results are unchanged.
