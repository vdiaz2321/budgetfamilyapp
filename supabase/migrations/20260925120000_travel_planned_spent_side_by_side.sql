-- Travel bookings enter Planned and Spent side by side instead of flipping one
-- set of figures between "planned" and "bought". Each booking also names the
-- foreign currency its second column is in (it was always euros).
--
-- The existing money columns keep their meaning — what the booking costs now:
-- the plan while it is an estimate, what was paid once bought — so every total
-- that reads them is unchanged. The new columns hold the plan beside it.

-- Flights: a plan per passenger, and the booking's foreign currency.
alter table travel_flight_passengers
  add column if not exists planned_fare_cents bigint check (planned_fare_cents is null or planned_fare_cents >= 0),
  add column if not exists planned_fare_foreign_cents bigint check (planned_fare_foreign_cents is null or planned_fare_foreign_cents >= 0);

alter table travel_flights
  add column if not exists foreign_currency text not null default 'EUR',
  add column if not exists planned_cost_foreign_cents bigint check (planned_cost_foreign_cents is null or planned_cost_foreign_cents >= 0);

-- Stays had no foreign figure at all.
alter table travel_stays
  add column if not exists foreign_currency text not null default 'EUR',
  add column if not exists cost_foreign_cents bigint check (cost_foreign_cents is null or cost_foreign_cents >= 0),
  add column if not exists planned_cost_foreign_cents bigint check (planned_cost_foreign_cents is null or planned_cost_foreign_cents >= 0);

alter table travel_cars
  add column if not exists foreign_currency text not null default 'EUR',
  add column if not exists planned_cost_foreign_cents bigint check (planned_cost_foreign_cents is null or planned_cost_foreign_cents >= 0);

-- Bookings still planned: their current figures are the plan.
update travel_flight_passengers p
set planned_fare_cents = p.fare_cents,
    planned_fare_foreign_cents = p.fare_eur_cents
from travel_flights f
where f.id = p.flight_id and f.is_estimate and p.planned_fare_cents is null;

update travel_flights
set planned_cost_foreign_cents = flight_cost_eur_cents
where is_estimate and planned_cost_foreign_cents is null;

update travel_cars
set planned_cost_foreign_cents = cost_eur_cents
where is_estimate and planned_cost_foreign_cents is null;
