-- A seat paid with points can still cost some cash — the taxes and fees on
-- an award ticket, or a points + cash fare. Kept per seat so the form can show
-- it back on that seat; the flight's pocket cost adds it to the cash seats'
-- fares. Null on a cash seat and on a points seat that cost nothing.
alter table travel_flight_passengers
  add column if not exists cash_paid_cents bigint
  check (cash_paid_cents is null or cash_paid_cents >= 0);
