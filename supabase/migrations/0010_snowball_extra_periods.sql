-- Time-varying snowball extra: instead of one flat "Monthly Extra" forever,
-- the amount you throw at the smallest debt can change over date ranges
-- (e.g. pay $250 extra Jan–Jun during a promo, then $100 after). Each row is
-- one period; the extra for any month = flat base (households.snowball_
-- monthly_extra_cents) + sum of every period whose range covers that month.

create table if not exists snowball_extra_periods (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  start_month   date not null,        -- first-of-month
  end_month     date,                 -- null = ongoing (no end)
  amount_cents  bigint not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists snowball_extra_periods_household_idx
  on snowball_extra_periods (household_id);

alter table snowball_extra_periods enable row level security;

drop policy if exists snowball_extra_periods_all on snowball_extra_periods;
create policy snowball_extra_periods_all on snowball_extra_periods for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
