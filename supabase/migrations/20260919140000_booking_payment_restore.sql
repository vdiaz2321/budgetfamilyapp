-- Undo a booking's "paid" state when the last payment linked to it goes away.
--
-- A Budget transaction can say which stay, flight or car it pays for
-- (transactions.travel_*_id). The first such payment sets the booking's pocket
-- cost to what the payments add up to and marks it Booked, drawing any points
-- off the card. Deleting or unlinking that payment used to leave all of that in
-- place — the Travel Log went on showing a paid booking the Budget no longer
-- had a payment for — because nothing recorded whether the pocket cost was
-- typed by hand or written by a payment.
--
-- payment_restore holds the booking as it was just before its first linked
-- payment: pocket cost, estimate flag, points figure, points-used flag, ledger
-- row, and (flights) each passenger's points. NULL means the booking's figures
-- are the user's own — never linked, or saved by hand in the Travel Log since —
-- and unlinking leaves them alone, exactly as before.
alter table travel_stays   add column if not exists payment_restore jsonb;
alter table travel_flights add column if not exists payment_restore jsonb;
alter table travel_cars    add column if not exists payment_restore jsonb;
