-- Remember which budget item a purchase was on before it was tagged to a
-- trip, so taking it off the trip can put it back. Tagging moves trip
-- spending onto the trip items (Groceries -> Traveling/Trips, Groceries
-- column); without this the original item was lost and "un-tag" could only
-- guess. Null means the purchase was not moved (it was already on a trip item)
-- or was tagged before this column existed.
alter table public.transactions
  add column if not exists pre_trip_subcategory_id uuid
    references public.subcategories(id) on delete set null;

comment on column public.transactions.pre_trip_subcategory_id is
  'Budget item the purchase was on before a trip tag moved it; restored when the trip tag is removed.';

-- Backfill the two Dornbirn · Jul 2026 purchases tagged on 2026-09-23 before
-- this column existed (read from the data just before they were tagged):
-- the 25-Jul Commissary $114.36 was on Groceries, the 25-Jul $65.21 on Fuel.
update public.transactions t
set pre_trip_subcategory_id = s.id
from public.travel_trips tr, public.subcategories s
where t.trip_id = tr.id
  and tr.name = 'Dornbirn · Jul 2026'
  and s.household_id = t.household_id
  and t.occurred_on = '2026-07-25'
  and t.pre_trip_subcategory_id is null
  and (
    (t.amount_cents = 11436 and s.name = 'Groceries' and s.receives_trip_plans = false)
    or (t.amount_cents = 6521 and s.name = 'Fuel' and s.receives_trip_plans = false)
  );
