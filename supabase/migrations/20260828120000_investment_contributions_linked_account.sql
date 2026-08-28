-- Resolve investment contributions through `subcategories.linked_account_id`.
--
-- The view resolved a transaction to an investment account two ways: the
-- transaction sitting directly on one (`t.account_id`), or its subcategory
-- pointing at a bucket that belongs to one (`s.linked_bucket_id`). There was no
-- third path for a savings subcategory linked straight to an *account* with no
-- bucket in between — and that is exactly how TSP is wired.
--
-- The effect was silent and total: every TSP contribution was dropped on the
-- floor. The Savings page counted $3,298.41 for 2026 (it reads the
-- subcategory), the Investments page counted $0 from the ledger, and the only
-- reason /invest showed anything at all was a hand-entered `investment_years`
-- row. Any account-linked goal had the same hole.
--
-- Fix: a third LEFT JOIN on `s.linked_account_id`, added LAST in the COALESCE
-- so the existing two paths keep precedence exactly as before — a transaction
-- already resolving via bucket or direct account is unaffected. Rows resolved
-- this way carry a NULL bucket_id, so they land in the account-level slot,
-- which is where account-linked money belongs.
--
-- Column names, types and order are unchanged, so `create or replace` is safe
-- and every existing caller keeps working.
create or replace view v_investment_contributions as
 WITH resolved AS (
         SELECT t.household_id,
            t.account_id AS tx_account_id,
            COALESCE(t.bucket_id, s.linked_bucket_id) AS resolved_bucket_id,
            s.linked_account_id AS linked_account_id,
            t.is_withdrawal,
            t.amount_cents,
            t.occurred_on
           FROM transactions t
             LEFT JOIN subcategories s ON s.id = t.subcategory_id
        )
 SELECT r.household_id,
    COALESCE(a_direct.id, a_bucket.id, a_linked.id) AS account_id,
    r.resolved_bucket_id AS bucket_id,
    EXTRACT(year FROM r.occurred_on)::integer AS year,
    sum(
        CASE
            WHEN r.is_withdrawal THEN - r.amount_cents
            ELSE r.amount_cents
        END)::bigint AS net_contribution_cents,
    sum(
        CASE
            WHEN r.is_withdrawal THEN 0
            ELSE r.amount_cents
        END)::bigint AS gross_contribution_cents,
    sum(
        CASE
            WHEN r.is_withdrawal THEN r.amount_cents
            ELSE 0
        END)::bigint AS withdrawal_cents
   FROM resolved r
     LEFT JOIN accounts a_direct ON a_direct.id = r.tx_account_id AND (a_direct.kind = 'investment'::account_kind OR a_direct.is_kids_account = true)
     LEFT JOIN buckets b_linked ON b_linked.id = r.resolved_bucket_id
     LEFT JOIN accounts a_bucket ON a_bucket.id = b_linked.account_id AND (a_bucket.kind = 'investment'::account_kind OR a_bucket.is_kids_account = true)
     LEFT JOIN accounts a_linked ON a_linked.id = r.linked_account_id AND (a_linked.kind = 'investment'::account_kind OR a_linked.is_kids_account = true)
  WHERE a_direct.id IS NOT NULL OR a_bucket.id IS NOT NULL OR a_linked.id IS NOT NULL
  GROUP BY r.household_id, (COALESCE(a_direct.id, a_bucket.id, a_linked.id)), r.resolved_bucket_id, (EXTRACT(year FROM r.occurred_on)::integer);
