-- Flights join stays in the Travel Log. One row per BOOKING (a booking code),
-- not per flight: a round trip on one receipt is one entry that costs one
-- amount, with its flights (legs) and passengers underneath it.
--
-- Money and points work exactly like travel_stays: flight_cost_cents is what
-- the tickets cost in cash, pocket_cost_cents is what actually left the wallet,
-- and points redeemed on a card write a companion row in
-- credit_card_reward_activities (reward_activity_id) whose trigger lowers the
-- card's balance.

-- First names only, managed from the flight form. A passenger row keeps the
-- name it was saved with, so renaming or removing someone never rewrites an
-- old booking.
create table if not exists travel_travellers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists travel_travellers_household_name_idx
  on travel_travellers (household_id, lower(name));

create table if not exists travel_flights (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  account_id           uuid references accounts(id) on delete set null,
  card_label           text,
  holder               text,
  airline              text not null,
  booking_code         text,
  reserved_on          date,
  -- Date of the first leg, kept on the booking so the log sorts and filters
  -- without reading the legs table.
  first_flight_on      date not null,
  points_cost          integer not null default 0 check (points_cost >= 0),
  points_used          boolean not null default false,
  points_value_micros  integer check (points_value_micros is null or points_value_micros >= 0),
  -- The sum of the passengers' fares.
  flight_cost_cents    bigint not null default 0 check (flight_cost_cents >= 0),
  pocket_cost_cents    bigint not null default 0 check (pocket_cost_cents >= 0),
  remarks              text,
  cancelled_at         timestamptz,
  reward_activity_id   uuid references credit_card_reward_activities(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists travel_flights_household_date_idx
  on travel_flights (household_id, first_flight_on desc);

create table if not exists travel_flight_legs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  flight_id     uuid not null references travel_flights(id) on delete cascade,
  sort_order    integer not null default 0,
  flight_on     date not null,
  flight_number text,
  from_place    text,
  to_place      text,
  departs_at    time,
  arrives_at    time
);
create index if not exists travel_flight_legs_flight_idx on travel_flight_legs (flight_id);

create table if not exists travel_flight_passengers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  flight_id     uuid not null references travel_flights(id) on delete cascade,
  sort_order    integer not null default 0,
  traveller_id  uuid references travel_travellers(id) on delete set null,
  name          text not null,
  -- Each person's own fare: adult and child fares differ, so it is typed,
  -- never split evenly.
  fare_cents    bigint not null default 0 check (fare_cents >= 0)
);
create index if not exists travel_flight_passengers_flight_idx on travel_flight_passengers (flight_id);

alter table travel_travellers enable row level security;
alter table travel_flights enable row level security;
alter table travel_flight_legs enable row level security;
alter table travel_flight_passengers enable row level security;

drop policy if exists travel_travellers_all on travel_travellers;
create policy travel_travellers_all on travel_travellers
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());
drop policy if exists travel_flights_all on travel_flights;
create policy travel_flights_all on travel_flights
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());
drop policy if exists travel_flight_legs_all on travel_flight_legs;
create policy travel_flight_legs_all on travel_flight_legs
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());
drop policy if exists travel_flight_passengers_all on travel_flight_passengers;
create policy travel_flight_passengers_all on travel_flight_passengers
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());

-- The family, as a starting list. Editable from the flight form.
insert into travel_travellers (household_id, name, sort_order)
select h.id, t.name, t.sort_order
  from households h
  cross join (values ('Victor', 1), ('Johana', 2), ('Leo', 3), ('Hannah', 4), ('Ben', 5)) as t(name, sort_order)
on conflict do nothing;

-- Points spent on a flight get their own ledger label. Reusing
-- 'points_redemption' would make the row hand-editable in the rewards log,
-- and an edit there would drift away from the flight that owns it.
alter table public.credit_card_reward_activities
  drop constraint if exists credit_card_reward_activities_activity_type_check;
alter table public.credit_card_reward_activities
  add constraint credit_card_reward_activities_activity_type_check
  check (activity_type in (
    'points_redemption',
    'hotel_credit_redemption',
    'free_night_booking',
    'reward_refund',
    'points_earned',
    'flight_booking'
  ));
