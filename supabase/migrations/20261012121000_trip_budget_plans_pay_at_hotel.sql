-- A pay-at-hotel stay (20261012120000) is booked but its money is still to
-- go out — at check-in, during the trip. The Budget's trip plan counted only
-- bookings not bought yet, so such a room's plan dropped off the Budget the
-- moment it was reserved. It now counts until its charge is linked.

create or replace view v_trip_budget_plans with (security_invoker = true) as
with trip_month as (
  select
    t.id as trip_id,
    t.household_id,
    t.name as trip_name,
    date_trunc('month', coalesce(
      t.start_on,
      (select min(d) from (
        select s.check_in as d from travel_stays s where s.trip_id = t.id and s.cancelled_at is null
        union all
        select coalesce((select min(l.flight_on) from travel_flight_legs l where l.flight_id = f.id), f.first_flight_on)
          from travel_flights f where f.trip_id = t.id and f.cancelled_at is null
        union all
        select c.pickup_on from travel_cars c where c.trip_id = t.id and c.cancelled_at is null
      ) b)
    ))::date as month
  from travel_trips t
),
parts as (
  select e.trip_id,
         case when e.category in ('restaurants', 'groceries') then 'restaurants' else 'other' end as role,
         e.planned_cents as cents
    from travel_trip_expenses e where coalesce(e.planned_cents, 0) > 0
  -- Only bookings not bought yet: a bought one was paid in its own month and
  -- already counts there as spending.
  union all
  select trip_id, 'other', pocket_cost_cents from travel_stays
    where trip_id is not null and is_estimate and cancelled_at is null and pocket_cost_cents > 0
  -- A pay-at-hotel stay is booked but not bought: its plan is still to be
  -- paid, at check-in, so it counts like a booking not bought yet — until a
  -- charge is linked (which sets its pocket cost).
  union all
  select trip_id, 'other', planned_cost_cents from travel_stays
    where trip_id is not null and not is_estimate and pay_at_property and cancelled_at is null
      and pocket_cost_cents = 0 and coalesce(planned_cost_cents, 0) > 0
  union all
  select trip_id, 'other', pocket_cost_cents from travel_flights
    where trip_id is not null and is_estimate and cancelled_at is null and pocket_cost_cents > 0
  union all
  select trip_id, 'other', pocket_cost_cents from travel_cars
    where trip_id is not null and is_estimate and cancelled_at is null and pocket_cost_cents > 0
)
select
  tm.household_id,
  tm.month,
  s.id as subcategory_id,
  tm.trip_id,
  tm.trip_name,
  sum(p.cents)::bigint as planned_cents
from parts p
join trip_month tm on tm.trip_id = p.trip_id
join subcategories s
  on s.household_id = tm.household_id and s.receives_trip_plans and s.travel_category = p.role
where tm.month is not null
group by tm.household_id, tm.month, s.id, tm.trip_id, tm.trip_name;
