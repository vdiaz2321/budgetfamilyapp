-- Trips group the Travel Log's bookings: "Malaga · Dec 2026" = two flights, a
-- hotel and a rental car, with one total. A trip is only a name — its dates and
-- totals are read from the bookings in it, so they can never disagree. A trip
-- does not need a flight: a road trip is its stays plus a drive.
create table if not exists travel_trips (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  created_at    timestamptz not null default now()
);
create unique index if not exists travel_trips_household_name_idx
  on travel_trips (household_id, lower(name));

alter table travel_trips enable row level security;
drop policy if exists travel_trips_all on travel_trips;
create policy travel_trips_all on travel_trips
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());

-- Deleting a trip keeps its bookings; they just stop belonging to a trip.
alter table travel_stays   add column if not exists trip_id uuid references travel_trips(id) on delete set null;
alter table travel_flights add column if not exists trip_id uuid references travel_trips(id) on delete set null;
alter table travel_cars    add column if not exists trip_id uuid references travel_trips(id) on delete set null;

create index if not exists travel_stays_trip_idx   on travel_stays (trip_id);
create index if not exists travel_flights_trip_idx on travel_flights (trip_id);
create index if not exists travel_cars_trip_idx    on travel_cars (trip_id);
