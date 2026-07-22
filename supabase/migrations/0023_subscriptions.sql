-- Subscriptions: recurring services tracked with renewal dates/amounts.
-- Each row links to a Bills subcategory (e.g. "Subscriptions") so logged
-- transactions roll up into the Budget page naturally. Victor manages the
-- list on /subscriptions; the app populates the transaction payee autocomplete
-- from it so no manual subcategory selection is needed.
create table if not exists subscriptions (
  id                uuid        primary key default gen_random_uuid(),
  household_id      uuid        not null references households(id) on delete cascade,
  name              text        not null,
  amount_cents      bigint      not null default 0,
  billing_cycle     text        not null default 'monthly'
                                check (billing_cycle in ('monthly','annual','quarterly','weekly')),
  next_renewal_date date,
  is_active         boolean     not null default true,
  subcategory_id    uuid        references subcategories(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists subscriptions_household_idx on subscriptions (household_id);
alter table subscriptions enable row level security;
drop policy if exists subscriptions_all on subscriptions;
create policy subscriptions_all on subscriptions for all
  using  (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- Irregular bills: infrequent / one-off items that don't recur on a
-- predictable schedule (Car Wash, Video Games, Benz maintenance, etc.).
-- No renewal date — just a name, a typical cost hint, and a category link.
create table if not exists irregular_bills (
  id                    uuid        primary key default gen_random_uuid(),
  household_id          uuid        not null references households(id) on delete cascade,
  name                  text        not null,
  typical_amount_cents  bigint      not null default 0,
  subcategory_id        uuid        references subcategories(id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists irregular_bills_household_idx on irregular_bills (household_id);
alter table irregular_bills enable row level security;
drop policy if exists irregular_bills_all on irregular_bills;
create policy irregular_bills_all on irregular_bills for all
  using  (household_id = auth_household_id())
  with check (household_id = auth_household_id());
