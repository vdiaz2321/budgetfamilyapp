-- Two facts a big-family hotel booking needs that a stay couldn't hold.
--
-- 1. Pay at hotel. Brand hotels (IHG, Hilton, Marriott) reserve without
--    charging and take the card at check-in. Such a stay is booked but not
--    paid: until its charge is linked it has a Planned figure and nothing
--    Spent, and the trip popup says "Due at check-in" instead of reading the
--    whole plan as money saved.
--
-- 2. Free cancel until. The last day the booking can be cancelled (or, on a
--    prepaid Expedia/Booking.com stay, refunded) at no cost. It lived in
--    remarks as "Refund by Mar 21" / "Cancellation until Mar 28".
alter table public.travel_stays
  add column if not exists pay_at_property boolean not null default false,
  add column if not exists free_cancel_until date;
