-- Contributions count Budget money only — never transfers.
--
-- v_investment_contributions_monthly netted EVERY withdrawal row against
-- contributions, including an investment → bank withdrawal made with the
-- Transfer popup (movement_type = 'investment_transfer'). Taking $1,000 out of
-- a Roth would have cut "Contributed · 2026" by $1,000 and raised "Left to
-- max" by $1,000 — but a withdrawal never gives IRS contribution room back.
--
-- Contributions are Budget savings lines (movement_type IS NULL). Transfers,
-- card payments and investment withdrawals move balances and Net Worth on
-- their own; they are simply not contributions, in either direction.
--
-- Same columns and same security_invoker as before, so v_investment_contributions
-- (which sums this view) needs no change.

create or replace view public.v_investment_contributions_monthly
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
  from public.transactions t
  left join public.subcategories s on s.id = t.subcategory_id
  where t.movement_type is null
)
select
  r.household_id,
  coalesce(a_direct.id, a_bucket.id, a_linked.id) as account_id,
  r.resolved_bucket_id as bucket_id,
  date_trunc('month', r.occurred_on::timestamptz)::date as month,
  extract(year from r.occurred_on)::integer as year,
  sum(case when r.is_withdrawal then -r.amount_cents else r.amount_cents end)::bigint as net_contribution_cents,
  sum(case when r.is_withdrawal then 0::bigint else r.amount_cents end)::bigint as gross_contribution_cents,
  sum(case when r.is_withdrawal then r.amount_cents else 0::bigint end)::bigint as withdrawal_cents
from resolved r
left join public.accounts a_direct
  on a_direct.id = r.tx_account_id
 and (a_direct.kind = 'investment'::public.account_kind or a_direct.is_kids_account = true)
left join public.buckets b_linked on b_linked.id = r.resolved_bucket_id
left join public.accounts a_bucket
  on a_bucket.id = b_linked.account_id
 and (a_bucket.kind = 'investment'::public.account_kind or a_bucket.is_kids_account = true)
left join public.accounts a_linked
  on a_linked.id = r.linked_account_id
 and (a_linked.kind = 'investment'::public.account_kind or a_linked.is_kids_account = true)
where a_direct.id is not null or a_bucket.id is not null or a_linked.id is not null
group by
  r.household_id,
  coalesce(a_direct.id, a_bucket.id, a_linked.id),
  r.resolved_bucket_id,
  date_trunc('month', r.occurred_on::timestamptz)::date,
  extract(year from r.occurred_on)::integer;
