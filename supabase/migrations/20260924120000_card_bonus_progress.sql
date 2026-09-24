-- Sign-up bonus progress, one row per card still working on one.
--
-- The minimum spend and its deadline were already stored per card and shown
-- nowhere. The page could say a bonus existed but never how close it was — on
-- the one clock in travel hacking that is worth real money, cannot be
-- extended, and is missed by forgetting rather than by deciding.
--
-- Summed in Postgres, the way v_card_balances and v_card_month_spend already
-- are: the same cost at 1,000 transactions or 100,000, and never silently
-- truncated by the 1,000-row response cap.
--
-- Charges only, on the same definition those two views use. A payment TO the
-- card (paid_to_account_id) is money going back, not spending. Imported rows
-- are excluded so a history import can't credit someone with a bonus they
-- never spent their way to.
--
-- Rows appear only for an open card with an unearned bonus and a deadline, so
-- the view is empty in the normal case. Whether a past deadline still counts
-- as "in progress" is the page's call, not the view's — it reports the facts
-- and leaves them both readable.

create or replace view v_card_bonus_progress with (security_invoker = true) as
select
  d.household_id,
  d.account_id,
  d.bonus_spend_cents::bigint as required_cents,
  d.bonus_spend_deadline     as deadline,
  coalesce(sum(t.amount_cents), 0)::bigint as spend_cents
from credit_card_details d
join accounts a
  on a.id = d.account_id
 and a.household_id = d.household_id
-- The bonus window: from the day the card was opened to its deadline. A card
-- with no opened date counts everything up to the deadline rather than
-- nothing, so a missing date understates the clock instead of hiding it.
left join transactions t
  on t.account_id = d.account_id
 and t.household_id = d.household_id
 and t.paid_to_account_id is null
 and (t.source is null or t.source <> 'import')
 and t.occurred_on <= d.bonus_spend_deadline
 and (a.date_opened is null or t.occurred_on >= a.date_opened)
where coalesce(d.bonus_spend_cents, 0) > 0
  and d.bonus_spend_deadline is not null
  and not coalesce(d.bonus_earned, false)
  and a.date_closed is null
group by d.household_id, d.account_id, d.bonus_spend_cents, d.bonus_spend_deadline;
