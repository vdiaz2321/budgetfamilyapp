-- Card balances, summed in Postgres instead of in the browser.
--
-- The Accounts page used to fetch every charge on every credit card and add
-- them up in JavaScript. That read grew with the household's whole history and
-- crossed PostgREST's 1000-row response cap, which truncates silently: each
-- card's "owed" quietly drifted low and disagreed with the same figure on the
-- Transactions page. Aggregating here makes the response one row per card, so
-- it costs the same whether there are 900 transactions or 900,000.
--
-- `security_invoker = true` so the views honour the RLS policies on the
-- underlying tables (household_id = auth_household_id()) rather than running
-- as the view owner.

-- Per-card amount currently owed: charges on the card, minus payments made to
-- it. CSV imports are historical budget records, not live card activity, and
-- are excluded here exactly as the page did before.
create or replace view v_card_balances
with (security_invoker = true) as
with charges as (
  select t.account_id, sum(t.amount_cents)::bigint as cents
  from transactions t
  join accounts a on a.id = t.account_id
  where a.kind = 'credit_card'
    and t.paid_to_account_id is null
    and (t.source is null or t.source <> 'import')
  group by 1
),
payments as (
  select t.paid_to_account_id as account_id, sum(t.amount_cents)::bigint as cents
  from transactions t
  join accounts a on a.id = t.paid_to_account_id
  where a.kind = 'credit_card'
  group by 1
)
select
  a.household_id,
  a.id as account_id,
  (coalesce(c.cents, 0) - coalesce(p.cents, 0))::bigint as owed_cents
from accounts a
left join charges  c on c.account_id = a.id
left join payments p on p.account_id = a.id
where a.kind = 'credit_card';

-- Per-card spend by month, for the "this month" figure on the same page.
-- Keyed by month rather than hard-coding current_date so the app keeps
-- deciding which month it is (its month boundaries are local, not UTC).
create or replace view v_card_month_spend
with (security_invoker = true) as
select
  t.household_id,
  t.account_id,
  date_trunc('month', t.occurred_on)::date as month,
  sum(t.amount_cents)::bigint as spend_cents
from transactions t
join accounts a on a.id = t.account_id
where a.kind = 'credit_card'
  and t.paid_to_account_id is null
  and (t.source is null or t.source <> 'import')
group by 1, 2, 3;

grant select on v_card_balances   to authenticated;
grant select on v_card_month_spend to authenticated;
