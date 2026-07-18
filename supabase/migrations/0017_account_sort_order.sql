-- Manual ordering for accounts, so the Accounts / Net Worth grids don't force
-- alphabetical order. Buckets already have sort_order (0005); accounts didn't.
alter table accounts add column if not exists sort_order integer not null default 0;

-- Seed existing rows with their current alphabetical order per household, so
-- turning this on doesn't silently reshuffle anyone's list.
with ranked as (
  select id, row_number() over (partition by household_id order by name) - 1 as rn
  from accounts
)
update accounts
set sort_order = ranked.rn
from ranked
where accounts.id = ranked.id;
