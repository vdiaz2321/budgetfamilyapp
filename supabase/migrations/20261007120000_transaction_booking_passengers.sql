-- A payment for a flight says how much of it was each passenger's ticket.
-- [{ "name": "Victor", "cents": 18206 }, …], set on the transaction form when
-- "Pays for" is a flight. The flight's Spent column per passenger is these
-- shares added up across every payment linked to it (a refund comes off), so
-- adult and child fares land on the right seats without retyping them on the
-- Travel Log. NULL on every other transaction, and on a flight payment saved
-- before this existed — those are shared out by the passengers' planned fares.
alter table transactions add column if not exists booking_passengers jsonb;
