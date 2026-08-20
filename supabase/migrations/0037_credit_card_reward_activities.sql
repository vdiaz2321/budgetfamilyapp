-- A permanent ledger for reward redemptions and bookings. The trigger keeps
-- each card's current point and hotel-credit balances in sync with the log.
create table if not exists credit_card_reward_activities (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references households(id) on delete cascade,
  account_id                uuid not null references accounts(id) on delete cascade,
  activity_type             text not null check (activity_type in ('points_redemption', 'hotel_credit_redemption', 'free_night_booking')),
  occurred_on               date not null,
  points_delta              integer not null default 0 check (points_delta <= 0),
  hotel_credit_delta_cents  bigint not null default 0 check (hotel_credit_delta_cents <= 0),
  booked_on                 date,
  note                      text,
  created_at                timestamptz not null default now()
);

create index if not exists credit_card_reward_activities_card_date_idx
  on credit_card_reward_activities (account_id, occurred_on desc, created_at desc);

alter table credit_card_reward_activities enable row level security;

drop policy if exists credit_card_reward_activities_all on credit_card_reward_activities;
create policy credit_card_reward_activities_all on credit_card_reward_activities
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

create or replace function apply_credit_card_reward_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.credit_card_details
  set
    current_points = greatest(0, current_points + new.points_delta),
    free_night_credit_cents = case
      when free_night_credit_cents is null then null
      else greatest(0, free_night_credit_cents + new.hotel_credit_delta_cents)
    end,
    benefit_used_on = coalesce(new.booked_on, benefit_used_on),
    updated_at = now()
  where account_id = new.account_id
    and household_id = new.household_id;

  if not found then
    raise exception 'Credit card reward details not found for account %', new.account_id;
  end if;

  return new;
end;
$$;

drop trigger if exists credit_card_reward_activity_sync on credit_card_reward_activities;
create trigger credit_card_reward_activity_sync
  after insert on credit_card_reward_activities
  for each row execute function apply_credit_card_reward_activity();
