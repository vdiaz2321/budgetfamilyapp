-- Trip groceries belong with trip restaurants: Restaurant Travel is the trip
-- food item (Victor, 2026-10-08). A trip's Groceries plan now lands on it on
-- the Budget, next to its Restaurants plan, instead of on the catch-all
-- (Traveling/Trips). The purchases follow the same rule in the app: a trip
-- grocery is saved on Restaurant Travel with its Groceries column.

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

-- Trip groceries already saved on the catch-all with the Groceries column
-- move to Restaurant Travel, keeping that column, so spending sits on the
-- same item as its plan. Booking payments are not spending and stay put.
update transactions x
   set subcategory_id = rt.id,
       category_id = rt.category_id
  from subcategories catch_all, subcategories rt
 where x.subcategory_id = catch_all.id
   and catch_all.receives_trip_plans and catch_all.travel_category = 'other'
   and rt.household_id = catch_all.household_id
   and rt.receives_trip_plans and rt.travel_category = 'restaurants'
   and x.trip_id is not null
   and x.travel_category = 'groceries'
   and x.travel_stay_id is null and x.travel_flight_id is null and x.travel_car_id is null;
