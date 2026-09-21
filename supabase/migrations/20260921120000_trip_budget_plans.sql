-- Trip plans on the Budget. A future trip's Planned figures (its spending plan
-- per category, plus any flight / hotel / rental not bought yet) count on the
-- Budget in the month the trip starts, so they are typed once, in the Travel
-- Log, and never copied. Restaurants lands on the trip restaurants item
-- (Restaurant Travel); everything else on the catch-all (Traveling/Trips).
--
-- A view rather than rows in budget_plans: editing a trip, moving its dates or
-- deleting it changes the Budget on the next load, with no sync to drift.
-- budget_plans keeps only what is typed on the Budget on top of the trips.

-- The two items that take trip plans and trip spending. One per Travel Log row
-- at most — the view and the purchase routing both look them up by that row.
alter table subcategories add column if not exists receives_trip_plans boolean not null default false;
create unique index if not exists subcategories_trip_item_idx
  on subcategories (household_id, travel_category) where receives_trip_plans;

update subcategories set receives_trip_plans = true
  where (name = 'Restaurant Travel' and travel_category = 'restaurants')
     or (name = 'Traveling/Trips'   and travel_category = 'other');

-- One row per trip per receiving item. Month = the trip's own start date, or
-- without one the earliest live booking (the same rule the Trip Log uses).
-- A trip with neither has no month and stays off the Budget.
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
         case when e.category = 'restaurants' then 'restaurants' else 'other' end as role,
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
