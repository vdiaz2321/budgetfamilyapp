-- Estate guide (Accounts → "Estate guide").
--
-- One printable place for Victor's family to see every open account, who it
-- passes to, who to call, and the steps his will asks for — so settling the
-- estate doesn't start with hunting through statements.
--
-- Per account: the beneficiary, how it passes (named beneficiary, payable /
-- transfer on death, joint owner, or through the will), a contact, and a note
-- (where the paperwork is). The guide only ever shows the last four digits of
-- an account number.
alter table public.accounts
  add column if not exists estate_beneficiary text,
  add column if not exists estate_transfer text,
  add column if not exists estate_contact text,
  add column if not exists estate_notes text;

alter table public.accounts drop constraint if exists accounts_estate_transfer_check;
alter table public.accounts add constraint accounts_estate_transfer_check
  check (estate_transfer is null or estate_transfer in ('beneficiary', 'pod', 'tod', 'joint', 'will', 'close'));

-- The household's own page of the guide: who handles things, where the will
-- is, and the steps in order. One row per household.
create table if not exists public.estate_guides (
  household_id uuid primary key references public.households(id) on delete cascade,
  executor text,
  will_location text,
  attorney text,
  power_of_attorney text,
  instructions text,
  updated_at timestamptz not null default now()
);

alter table public.estate_guides enable row level security;
drop policy if exists estate_guides_all on public.estate_guides;
create policy estate_guides_all on public.estate_guides
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- What isn't an account on the Accounts page: life insurance (SGLI/VGLI),
-- survivor benefits (SBP, DIC, Social Security), property, digital accounts.
create table if not exists public.estate_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('insurance', 'benefit', 'property', 'digital', 'other')),
  name text not null,
  amount_cents bigint,
  beneficiary text,
  contact text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estate_items_household_idx on public.estate_items (household_id, sort_order);

alter table public.estate_items enable row level security;
drop policy if exists estate_items_all on public.estate_items;
create policy estate_items_all on public.estate_items
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
