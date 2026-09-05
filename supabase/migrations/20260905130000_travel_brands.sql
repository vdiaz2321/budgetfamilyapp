-- One managed list of hotel brands / booking channels behind the stay form's
-- "Booked thru / Brand" picker. The two free-text fields it replaces drifted
-- ("Hilton" vs "hilton.com"), which a future by-brand chart can't group on.
create table if not exists travel_brands (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  created_at    timestamptz not null default now()
);

-- Case-insensitive: adding "hilton" next to "Hilton" would defeat the point.
create unique index if not exists travel_brands_household_name_idx
  on travel_brands (household_id, lower(name));

alter table travel_brands enable row level security;

drop policy if exists travel_brands_all on travel_brands;
create policy travel_brands_all on travel_brands
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- Victor's starting list, given once to every household that exists today.
insert into travel_brands (household_id, name)
select h.id, b.name
  from households h
  cross join (values
    ('AirBnB'), ('Amex'), ('Booking'), ('CapOne'), ('Delta'), ('Expedia'),
    ('Hilton'), ('Hyatt'), ('IHG'), ('Marriott'), ('NH'), ('Resorts'),
    ('Sapphire')
  ) as b(name)
on conflict do nothing;
