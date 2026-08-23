-- Split gross contributions from withdrawals.
--
-- The view previously reported only a net figure, so a year with a large
-- withdrawal showed suppressed "Contrib" and, downstream, a distorted gain
-- comparison — $10,000 in and $8,000 out looked identical to $2,000 in and
-- nothing out. It also disagreed with the imported performance data, which has
-- always kept `contributions_cents` and `withdrawals_cents` apart.
--
-- The existing body is reproduced verbatim (bucket resolution, kids-account
-- handling, column order) and `net_contribution_cents` keeps identical
-- semantics — the two new columns are purely additive, so existing callers are
-- unaffected.
create or replace view v_investment_contributions as
 WITH resolved AS (
         SELECT t.household_id,
            t.account_id AS tx_account_id,
            COALESCE(t.bucket_id, s.linked_bucket_id) AS resolved_bucket_id,
            t.is_withdrawal,
            t.amount_cents,
            t.occurred_on
           FROM transactions t
             LEFT JOIN subcategories s ON s.id = t.subcategory_id
        )
 SELECT r.household_id,
    COALESCE(a_direct.id, a_bucket.id) AS account_id,
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
  WHERE a_direct.id IS NOT NULL OR a_bucket.id IS NOT NULL
  GROUP BY r.household_id, (COALESCE(a_direct.id, a_bucket.id)), r.resolved_bucket_id, (EXTRACT(year FROM r.occurred_on)::integer);
