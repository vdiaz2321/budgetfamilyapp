-- Two additions to the Travel Log.
--
-- 1) Points per passenger. On one booking some tickets can be paid with points
--    and others in cash, so the choice lives on each passenger. The fare stays
--    recorded either way — on a points ticket it is what the seat would have
--    cost, which is how the points are valued. travel_flights.points_cost and
--    points_used become the passengers' totals, written by the save action.
alter table travel_flight_passengers
  add column if not exists points_used boolean not null default false,
  add column if not exists points_cost integer not null default 0 check (points_cost >= 0);

-- 2) Cars. One row per rental booking, or per drive in the family car (fuel
--    and tolls), so a trip without a flight still has its getting-there cost.
create table if not exists travel_cars (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  kind                 text not null default 'rental' check (kind in ('rental', 'own_car')),
  company              text,
  booking_code         text,
  reserved_on          date,
  pickup_on            date not null,
  pickup_time          time,
  pickup_place         text,
  return_on            date,
  return_time          time,
  return_place         text,
  account_id           uuid references accounts(id) on delete set null,
  card_label           text,
  holder               text,
  points_cost          integer not null default 0 check (points_cost >= 0),
  points_used          boolean not null default false,
  points_value_micros  integer check (points_value_micros is null or points_value_micros >= 0),
  -- Rental: what the car cost in cash. Own car: fuel and tolls.
  cost_cents           bigint not null default 0 check (cost_cents >= 0),
  pocket_cost_cents    bigint not null default 0 check (pocket_cost_cents >= 0),
  remarks              text,
  cancelled_at         timestamptz,
  reward_activity_id   uuid references credit_card_reward_activities(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists travel_cars_household_date_idx on travel_cars (household_id, pickup_on desc);

alter table travel_cars enable row level security;
drop policy if exists travel_cars_all on travel_cars;
create policy travel_cars_all on travel_cars
  for all using (household_id = auth_household_id()) with check (household_id = auth_household_id());

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
    'flight_booking',
    'car_booking'
  ));
