-- A trip's Spending table (restaurants, groceries, …) keeps a second figure
-- beside the dollars. It was always euros; now each trip names its currency.
-- One per trip rather than per category: a trip's day-to-day spending is in
-- the one place's money.
alter table travel_trips
  add column if not exists spending_currency text not null default 'EUR';
