-- A transaction can be tagged to a trip, and each budget item can say which
-- Travel Log spending row its transactions belong in. Together they let a
-- card purchase entered once show up on the trip's Spending table as Actual,
-- against the Planned figure, with no retyping on the Travel Log.

-- Which trip a purchase belongs to. Optional, like property_id.
alter table transactions
  add column if not exists trip_id uuid references travel_trips(id) on delete set null;
create index if not exists transactions_trip_idx on transactions (trip_id) where trip_id is not null;

-- Set once per budget item ("Restaurant Travel" → restaurants), never per
-- transaction. Same keys as travel_trip_expenses.category.
alter table subcategories
  add column if not exists travel_category text
  check (travel_category is null or travel_category in (
    'restaurants', 'groceries', 'entertainment', 'transport',
    'fuel_tolls', 'parking', 'cash', 'other'));

-- The obvious mappings for the items that already exist, by name. Anything
-- else is set from the item's own form on the Budget page.
update subcategories set travel_category = 'restaurants'   where travel_category is null and name in ('Restaurant Travel', 'Restaurants');
update subcategories set travel_category = 'groceries'     where travel_category is null and name = 'Groceries';
update subcategories set travel_category = 'fuel_tolls'    where travel_category is null and name = 'Fuel';
update subcategories set travel_category = 'entertainment' where travel_category is null and name = 'Entertainment/outings';
update subcategories set travel_category = 'other'         where travel_category is null and name = 'Traveling/Trips';
