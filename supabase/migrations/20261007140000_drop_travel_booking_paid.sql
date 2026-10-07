-- Drop the unused `paid` flag on bookings.
--
-- Added 2026-09-16 (migration travel_booking_paid, applied from the SQL editor
-- and never saved here) as `paid boolean not null default true` on stays,
-- flights and rentals. The next day `is_estimate` replaced it as the
-- planned-vs-bought switch, and no app code, view or function has read `paid`
-- since. Left in place it only misled: the Greece placeholders read paid=true
-- while still being estimates.

alter table public.travel_stays   drop column if exists paid;
alter table public.travel_flights drop column if exists paid;
alter table public.travel_cars    drop column if exists paid;
