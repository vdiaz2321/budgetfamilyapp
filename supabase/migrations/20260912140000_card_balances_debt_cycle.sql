-- A credit card that is being used as a debt, and then goes back to being a
-- credit card.
--
-- Victor opens a card on a 0% APR promotion, carries a balance on it, tracks
-- that balance as a `debts` row and pays it down — then either starts using the
-- card normally or closes it. The same card can go round that loop more than
-- once. Two things broke on the way round:
--
--   1. WHILE THE DEBT IS LIVE. Every payoff payment made through the Accounts
--      card panel writes a transaction paid TO the card, and this view counts
--      those payments. With the promo balance itself never recorded as a charge
--      (it lives in `debts`, not the register), the card's owed figure walks
--      steadily NEGATIVE — one number for the same card going down on the Debt
--      page and down again here, for the same dollars.
--
--   2. AFTER IT IS PAID OFF. That negative carries forward, so when the card
--      goes back to ordinary use its "Total CC owed" reads $0 until new
--      spending climbs back over everything that was ever paid off on it. On a
--      $1,968 payoff that is months of invisible spending.
--
-- The rule that fixes both, and matches how the card is actually being used:
--
--   * a card with a LIVE payoff debt owes nothing HERE — its liability is the
--     debts row, shown on Debt/Loans and counted in Net Worth from there;
--   * once the debt is cleared, the register starts the day AFTER the payoff
--     date, so the card comes back to ordinary life at $0 and counts only what
--     is spent on it from then on. The boundary is strict because the final
--     payoff payment is itself dated the payoff day — counting it would leave
--     the card starting its new life owing minus one payment;
--   * a card that has never been a payoff debt behaves exactly as before.
--
-- `debts.paid_off_at` is already maintained for this — lib/debts.ts stamps it
-- the moment a balance reaches zero and clears it again if a payment is undone
-- — so a card that goes round the loop a second time resets a second time.
create or replace view v_card_balances as
with baseline as (
  select d.account_id,
         bool_or(coalesce(d.current_balance_cents, 0) > 0) as has_live_debt,
         max(d.paid_off_at) as cleared_on
    from debts d
   where d.account_id is not null
   group by d.account_id
),
charges as (
  select t.account_id,
         sum(t.amount_cents)::bigint as cents
    from transactions t
    join accounts a_1 on a_1.id = t.account_id
    left join baseline b on b.account_id = t.account_id
   where a_1.kind = 'credit_card'::account_kind
     and t.paid_to_account_id is null
     and (t.source is null or t.source <> 'import'::transaction_source)
     and (b.cleared_on is null or t.occurred_on > b.cleared_on)
   group by t.account_id
),
payments as (
  select t.paid_to_account_id as account_id,
         sum(t.amount_cents)::bigint as cents
    from transactions t
    join accounts a_1 on a_1.id = t.paid_to_account_id
    left join baseline b on b.account_id = t.paid_to_account_id
   where a_1.kind = 'credit_card'::account_kind
     and (b.cleared_on is null or t.occurred_on > b.cleared_on)
   group by t.paid_to_account_id
)
select a.household_id,
       a.id as account_id,
       case
         when coalesce(b.has_live_debt, false) then 0::bigint
         else coalesce(c.cents, 0::bigint) - coalesce(p.cents, 0::bigint)
       end as owed_cents
  from accounts a
  left join baseline b on b.account_id = a.id
  left join charges c on c.account_id = a.id
  left join payments p on p.account_id = a.id
 where a.kind = 'credit_card'::account_kind;
