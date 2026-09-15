-- The Trip Log: a trip carries its own dates, and its day-to-day spending
-- (restaurants, groceries, entertainment, transport…) is kept as one total per
-- category for the whole trip — the Google Sheet's per-day rows, rolled up.

-- A trip's dates. Optional: without them the dates are read from its bookings,
-- but a trip that is only a drive and some spending has no bookings to read.
alter table travel_trips
  add column if not exists start_on date,
  add column if not exists end_on date,
  add column if not exists notes text;
alter table travel_trips drop constraint if exists travel_trips_dates_check;
alter table travel_trips add constraint travel_trips_dates_check
  check (start_on is null or end_on is null or end_on >= start_on);

-- One row per trip per category. Planned is the estimate made while planning;
-- actual is what was really spent. Each keeps its euro figure beside the dollar
-- one, as the sheet did; totals are always added up in dollars.
create table if not exists travel_trip_expenses (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  trip_id             uuid not null references travel_trips(id) on delete cascade,
  category            text not null check (category in (
                        'restaurants', 'groceries', 'entertainment', 'transport',
                        'fuel_tolls', 'parking', 'cash', 'other')),
  planned_cents       bigint check (planned_cents is null or planned_cents >= 0),
  planned_eur_cents   bigint check (planned_eur_cents is null or planned_eur_cents >= 0),
  actual_cents        bigint check (actual_cents is null or actual_cents >= 0),
  actual_eur_cents    bigint check (actual_eur_cents is null or actual_eur_cents >= 0),
  account_id          uuid references accounts(id) on delete set null,
  note                text,
  updated_at          timestamptz not null default now(),
  unique (trip_id, category)
);
create index if not exists travel_trip_expenses_trip_idx on travel_trip_expenses (trip_id);

alter table travel_trip_expenses enable row level security;
drop policy if exists travel_trip_expenses_all on travel_trip_expenses;
create policy travel_trip_expenses_all on travel_trip_expenses
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());

-- Euro figures on the bookings, beside the dollars that drive every total.
alter table travel_flights           add column if not exists flight_cost_eur_cents bigint check (flight_cost_eur_cents is null or flight_cost_eur_cents >= 0);
alter table travel_flight_passengers add column if not exists fare_eur_cents bigint check (fare_eur_cents is null or fare_eur_cents >= 0);
alter table travel_cars              add column if not exists cost_eur_cents bigint check (cost_eur_cents is null or cost_eur_cents >= 0);

-- Imported history never moved a card's points; only bookings made in the app
-- do. Same rule travel_stays already has.
alter table travel_flights add column if not exists moves_card_points boolean not null default true;
alter table travel_cars    add column if not exists moves_card_points boolean not null default true;
