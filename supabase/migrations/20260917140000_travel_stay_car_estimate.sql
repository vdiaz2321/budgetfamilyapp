-- Stays and rentals can be logged before they are booked, the same way flights
-- can (20260917120000, 20260917130000): the price is an estimate, it counts in
-- the trip as planned, and nothing is drawn from a card — points, night credit
-- or free-night certificate — until it is switched to booked. The last
-- estimate is kept once booked so the trip shows planned against actual.
alter table travel_stays
  add column if not exists is_estimate boolean not null default false,
  add column if not exists planned_cost_cents bigint
    check (planned_cost_cents is null or planned_cost_cents >= 0);

alter table travel_cars
  add column if not exists is_estimate boolean not null default false,
  add column if not exists planned_cost_cents bigint
    check (planned_cost_cents is null or planned_cost_cents >= 0);
