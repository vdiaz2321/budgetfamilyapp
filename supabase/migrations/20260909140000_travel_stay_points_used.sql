-- A stay's points_cost has been carrying two different facts in one column:
-- points that were actually redeemed, and what the room *would* have cost in
-- points on a stay that was paid in cash. Every "Total pts used" summed both,
-- so the totals read high — 20 card-paid stays carried 898,645 points between
-- them, some of which were never spent.
--
-- This makes the distinction explicit. It also matters beyond the totals:
-- points_cost is what writes the reward activity that lowers a card's balance,
-- so a hypothetical must never sync one.
alter table travel_stays
  add column if not exists points_used boolean not null default false;

-- Backfill: a redemption is a stay paid with points or a credit, or one whose
-- out-of-pocket came in under the room rate — something was spent to close
-- that gap. A stay whose pocket cost equals the room rate redeemed nothing,
-- so its points figure is the hypothetical.
update travel_stays
set points_used = true
where points_cost > 0
  and (
    pocket_paid_with in ('points', 'credit')
    or pocket_cost_cents < hotel_cost_cents
  );
