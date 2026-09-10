-- The points_used backfill in 20260909140000 treated "pocket cost came in under
-- the room rate" as proof that points were redeemed. A card's hotel credit
-- closes that same gap without a single point being spent, so every
-- credit-covered stay got flagged as a redemption and the "Total pts used"
-- rollups read high — 545,111 points across the ten stays below.
--
-- Their points_cost is still correct and still worth showing: it is what the
-- room would have cost in points. Only the "these were actually redeemed"
-- claim is wrong, so this clears the flag and leaves the figures alone.
--
-- None of these ten had synced a reward activity, so no card balance moves.

-- The room was paid outright with a travel/hotel credit. Nothing was redeemed.
update travel_stays
set points_used = false
where points_used
  and pocket_paid_with = 'credit';

-- Paid by card, where the difference between the room rate and what was
-- actually paid is accounted for by the card's hotel credit. Listed by id
-- rather than by rule: the Hilton Sandestin gap runs $12 over its credit
-- (taxes) and the Tautermann credit was never entered in hotel_credit_cents,
-- only noted in remarks, so no clean predicate catches exactly these six
-- without also sweeping in stays whose credit covers only part of the gap.
update travel_stays
set points_used = false
where id in (
  '44865f37-ac8e-49d0-ac7b-fbd37687b00e', -- 2022-11-25 Hotel Effie Sandestin, 25,700
  'b1fca555-d122-4a9d-94ac-edffafde241c', -- 2023-02-25 Hilton Sandestin, 70,000
  'd8ebb7f2-a680-4ec6-8007-149250672278', -- 2025-07-06 Hotel Tautermann, 18,000
  '0450c0c7-0fd9-4590-9f96-878c093f9ab9', -- 2025-08-30 Hilton Gravenbruch, 131,000
  '1b57d71f-869c-4515-b145-5dc6fce9e276', -- 2025-10-11 Hilton Gravenbruch, 131,000
  'cbbc68b1-8c0e-459c-b94c-b13ea3ce7506'  -- 2026-06-17 Villa Ivanka Trogir, 31,411
);
