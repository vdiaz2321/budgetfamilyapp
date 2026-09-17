-- A flight can be logged before it is bought: the fares are today's quoted
-- prices, an estimate. It counts in the trip's totals (flagged as planned) but
-- never draws points from a card until it is marked bought.
alter table travel_flights
  add column if not exists is_estimate boolean not null default false;
