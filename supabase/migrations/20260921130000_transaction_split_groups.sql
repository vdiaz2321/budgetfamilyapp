-- A split purchase (Kaufland: $183.00 Groceries + $13.74 Sales Tax) is saved
-- as one transaction per budget item. Nothing tied the parts together, so
-- opening one showed only that part. Every part of a split now shares one
-- split_group_id; a plain transaction leaves it null.
alter table transactions add column if not exists split_group_id uuid;
create index if not exists transactions_split_group_idx
  on transactions (split_group_id) where split_group_id is not null;

-- Link the splits saved before this column existed. The form saved a split's
-- parts one after another, seconds apart, with the same date, payee, account
-- and note — so a run of such rows each under 8 seconds after the one before
-- is one split. Rows further apart (USAA, Fidelity entries 11s–9min apart)
-- read as separate purchases and are left alone.
with ordered as (
  select id, household_id, occurred_on, payee_id, account_id, coalesce(memo, '') as memo_key, created_at,
         created_at - lag(created_at) over w as gap
  from transactions
  where source = 'manual' and payee_id is not null and split_group_id is null
  window w as (partition by household_id, occurred_on, payee_id, account_id, coalesce(memo, '') order by created_at)
),
runs as (
  select *,
         sum(case when gap is null or gap >= interval '8 seconds' then 1 else 0 end)
           over (partition by household_id, occurred_on, payee_id, account_id, memo_key order by created_at) as run_no
  from ordered
),
groups as (
  select household_id, occurred_on, payee_id, account_id, memo_key, run_no, gen_random_uuid() as group_id
  from runs
  group by household_id, occurred_on, payee_id, account_id, memo_key, run_no
  having count(*) > 1
)
update transactions t
set split_group_id = g.group_id
from runs r
join groups g using (household_id, occurred_on, payee_id, account_id, memo_key, run_no)
where t.id = r.id;
