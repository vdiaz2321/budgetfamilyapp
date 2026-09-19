-- A trip purchase on the catch-all travel item (Traveling/Trips, whose own
-- Travel Log row is "Other") can name a more exact row — Parking, Public
-- transport, Cash — so those columns fill without a budget item each.
-- Null means "use the budget item's row" (subcategories.travel_category),
-- which is every other purchase. Same keys as that column.
alter table transactions
  add column if not exists travel_category text
  check (travel_category is null or travel_category in (
    'restaurants', 'groceries', 'entertainment', 'transport',
    'fuel_tolls', 'parking', 'cash', 'other'));
