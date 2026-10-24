-- A card payment can now pay a balance transfer sitting on that card.
--
-- Make Card Payment on the card holding a transfer used to lower only the
-- card's own owed figure: the transfer's debt never moved and the card slid
-- into a credit it didn't have. The Pay form now lets the payment go to the
-- transfer. It stays a card payment (paid_to_account_id = the card, so it shows
-- in the card's history and the bank or bucket is debited the usual way) but
-- carries the transfer's budget item in subcategory_id, and the transfer's debt
-- drops by it.
--
-- The transfer is not in the card's owed figure (its liability is the debts
-- row), so a payment to it must not come off owed either. Payments whose
-- subcategory is a balance transfer on that same card are left out below;
-- everything else in the view is unchanged from 20261001130000.

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
            AND NOT EXISTS (
              SELECT 1 FROM debts bt
               WHERE bt.subcategory_id = t.subcategory_id
                 AND bt.bt_card_account_id = t.paid_to_account_id
            )
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

grant select on public.v_card_balances to authenticated;
grant select on public.v_card_balances to service_role;
