-- The "Select if using other currency" dropdown gets a None choice, and None is
-- the default. Every booking and trip used to be in euros whether or not
-- anything was paid in them, so a new trip opened with EUR columns nobody
-- asked for. NULL now means "dollars only": the forms hide the second-currency
-- columns until a currency is picked.
alter table travel_flights alter column foreign_currency drop not null, alter column foreign_currency drop default;
alter table travel_stays   alter column foreign_currency drop not null, alter column foreign_currency drop default;
alter table travel_cars    alter column foreign_currency drop not null, alter column foreign_currency drop default;
alter table travel_trips   alter column spending_currency drop not null, alter column spending_currency drop default;

-- Rows with no figure in their other currency were never really in it.
update travel_flights f set foreign_currency = null
where coalesce(f.flight_cost_eur_cents, 0) = 0 and coalesce(f.planned_cost_foreign_cents, 0) = 0
  and not exists (
    select 1 from travel_flight_passengers p
    where p.flight_id = f.id and (coalesce(p.fare_eur_cents, 0) > 0 or coalesce(p.planned_fare_foreign_cents, 0) > 0)
  );
update travel_stays set foreign_currency = null
where coalesce(cost_foreign_cents, 0) = 0 and coalesce(planned_cost_foreign_cents, 0) = 0;
update travel_cars set foreign_currency = null
where coalesce(cost_eur_cents, 0) = 0 and coalesce(planned_cost_foreign_cents, 0) = 0;
update travel_trips t set spending_currency = null
where not exists (
  select 1 from travel_trip_expenses e
  where e.trip_id = t.id and (coalesce(e.planned_eur_cents, 0) > 0 or coalesce(e.actual_eur_cents, 0) > 0)
);
