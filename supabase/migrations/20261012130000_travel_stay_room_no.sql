-- Which room a reservation is for, picked by hand on the stay form.
--
-- A family of five books two rooms, and the second is often several
-- one-night reservations (a free night on each card, a night on points). The
-- trip popup lists them under one hotel line, by room. That room used to be
-- worked out from the dates, invisibly — Victor couldn't see or set it. Now it
-- is a field: null on a stay booked as a single room.
alter table public.travel_stays
  add column if not exists room_no smallint check (room_no is null or room_no between 1 and 9);
