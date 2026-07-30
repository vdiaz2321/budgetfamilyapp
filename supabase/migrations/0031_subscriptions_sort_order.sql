-- Add manual sort order to subscriptions and irregular_bills so users
-- can arrange them in their preferred order instead of alphabetically.

alter table subscriptions
  add column if not exists sort_order int not null default 0;

alter table irregular_bills
  add column if not exists sort_order int not null default 0;

-- Seed existing rows with sequential order based on current name order
-- so the initial display matches what users have been seeing.
with ordered as (
  select id,
         row_number() over (partition by household_id order by name) as rn
  from subscriptions
)
update subscriptions s
set sort_order = o.rn
from ordered o
where s.id = o.id;

with ordered as (
  select id,
         row_number() over (partition by household_id order by name) as rn
  from irregular_bills
)
update irregular_bills ib
set sort_order = o.rn
from ordered o
where ib.id = o.id;
