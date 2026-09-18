-- A trip-tagged transaction can say which booking it pays for. The booking's
-- Pocket cost then becomes the sum of its linked payments and it is marked
-- Booked, so a hotel or flight paid on a card is never retyped on the Travel
-- Log. At most one of the three is set; a payment that pays for nothing in
-- particular is the trip's day-to-day spending instead.
alter table transactions
  add column if not exists travel_stay_id   uuid references travel_stays(id)   on delete set null,
  add column if not exists travel_flight_id uuid references travel_flights(id) on delete set null,
  add column if not exists travel_car_id    uuid references travel_cars(id)    on delete set null;
create index if not exists transactions_travel_stay_idx   on transactions (travel_stay_id)   where travel_stay_id   is not null;
create index if not exists transactions_travel_flight_idx on transactions (travel_flight_id) where travel_flight_id is not null;
create index if not exists transactions_travel_car_idx    on transactions (travel_car_id)    where travel_car_id    is not null;
