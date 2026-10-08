-- A flight booking's fare features, from the flight form's Features popup:
-- { "fare": "Economy Basic", "personalItem": true, "carryOn": false,
--   "checkedBags": 2 }. checkedBags is the booking's total, not per person.
-- NULL until something is ticked there.
alter table travel_flights add column if not exists baggage jsonb;
