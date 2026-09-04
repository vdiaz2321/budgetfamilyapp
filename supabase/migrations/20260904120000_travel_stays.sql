-- A reservation ledger for travel hacking: one row per hotel / apartment stay,
-- carrying what it cost in points, what the cash rate would have been, and what
-- actually came out of pocket. This is the app's version of the Google Sheet
-- Victor has kept since 2022 — the columns map 1:1 to his headers.
--
-- Points are NOT tracked twice. A stay booked with points writes a companion
-- row in credit_card_reward_activities (reward_activity_id below), and that
-- table's existing trigger is what lowers the card's balance. This is the fix
-- for "used my Sapphire points but had no good method to reduce them".
create table if not exists travel_stays (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references households(id) on delete cascade,
  -- The card the stay was booked on. Nullable because older stays were often
  -- put on a card that no longer exists in the app; card_label keeps the name
  -- from the sheet ("Saph", "CapOne", "Hilton Aspire") in that case.
  account_id            uuid references accounts(id) on delete set null,
  card_label            text,
  holder                text,
  property_name         text not null,
  city                  text,
  brand                 text,
  booking_channel       text,
  reserved_on           date,
  check_in              date not null,
  nights                integer not null default 1 check (nights > 0),
  pax                   integer check (pax is null or pax > 0),
  points_cost           integer not null default 0 check (points_cost >= 0),
  -- Dollars per point x 1,000,000, matching credit_card_details.points_value_micros
  -- ($0.006/pt -> 6000). Cash value of the points = points_cost * micros / 10000 cents.
  points_value_micros   integer check (points_value_micros is null or points_value_micros >= 0),
  hotel_credit_cents    bigint not null default 0 check (hotel_credit_cents >= 0),
  -- What the room would have cost in cash: the basis for "total saved".
  hotel_cost_cents      bigint not null default 0 check (hotel_cost_cents >= 0),
  pocket_cost_cents     bigint not null default 0 check (pocket_cost_cents >= 0),
  -- How the out-of-pocket half was settled. 'points' and 'credit' are the rows
  -- the sheet wrote as "Pts" / "Saph" — real spend of a reward, not cash.
  pocket_paid_with      text not null default 'cash'
                          check (pocket_paid_with in ('cash', 'points', 'credit', 'tbd')),
  remarks               text,
  reward_activity_id    uuid references credit_card_reward_activities(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists travel_stays_household_checkin_idx
  on travel_stays (household_id, check_in desc);
create index if not exists travel_stays_account_idx
  on travel_stays (account_id);

alter table travel_stays enable row level security;

drop policy if exists travel_stays_all on travel_stays;
create policy travel_stays_all on travel_stays
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
