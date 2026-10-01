-- "Match statement" for a credit card's owed figure.
--
-- The owed figure is logged charges minus logged payments, so a missed or
-- mistyped charge leaves it a few dollars off the real statement for good —
-- in Oct 2026 Sapphire read -$97.21 and Plat Amex -$4.98 after full payoffs.
-- Victor sets the card to its real balance from the Pay Card popup; the gap is
-- stored here as a correction and added to the computed figure. No transaction
-- is written, so Budget, Transactions and Insights are untouched.
--
-- Net worth is unaffected: this view only feeds the Accounts "Total CC owed"
-- line and the account pickers, never accounts.balance_cents or snapshots.
--
-- The correction belongs to the register it was made against. If the card
-- later goes through a payoff-debt cycle (see 20260912140000), the register
-- restarts the day after the payoff and an older correction is dropped.

alter table public.accounts
  add column if not exists owed_adjustment_cents bigint not null default 0,
  add column if not exists owed_adjusted_on date;

create or replace view public.v_card_balances
with (security_invoker = true) as
 WITH baseline AS (
         SELECT d.account_id,
            bool_or(COALESCE(d.current_balance_cents, 0::bigint) > 0) AS has_live_debt,
            max(d.paid_off_at) AS cleared_on
           FROM debts d
          WHERE d.account_id IS NOT NULL
          GROUP BY d.account_id
        ), charges AS (
         SELECT t.account_id,
            sum(t.amount_cents)::bigint AS cents
           FROM transactions t
             JOIN accounts a_1 ON a_1.id = t.account_id
             LEFT JOIN baseline b_1 ON b_1.account_id = t.account_id
          WHERE a_1.kind = 'credit_card'::account_kind AND t.paid_to_account_id IS NULL AND (t.source IS NULL OR t.source <> 'import'::transaction_source) AND (b_1.cleared_on IS NULL OR t.occurred_on > b_1.cleared_on)
          GROUP BY t.account_id
        ), payments AS (
         SELECT t.paid_to_account_id AS account_id,
            sum(t.amount_cents)::bigint AS cents
           FROM transactions t
             JOIN accounts a_1 ON a_1.id = t.paid_to_account_id
             LEFT JOIN baseline b_1 ON b_1.account_id = t.paid_to_account_id
          WHERE a_1.kind = 'credit_card'::account_kind AND (b_1.cleared_on IS NULL OR t.occurred_on > b_1.cleared_on)
          GROUP BY t.paid_to_account_id
        )
 SELECT a.household_id,
    a.id AS account_id,
        CASE
            WHEN COALESCE(b.has_live_debt, false) THEN 0::bigint
            ELSE COALESCE(c.cents, 0::bigint) - COALESCE(p.cents, 0::bigint)
              + CASE
                  WHEN b.cleared_on IS NULL OR a.owed_adjusted_on > b.cleared_on THEN a.owed_adjustment_cents
                  ELSE 0::bigint
                END
        END AS owed_cents
   FROM accounts a
     LEFT JOIN baseline b ON b.account_id = a.id
     LEFT JOIN charges c ON c.account_id = a.id
     LEFT JOIN payments p ON p.account_id = a.id
  WHERE a.kind = 'credit_card'::account_kind;
