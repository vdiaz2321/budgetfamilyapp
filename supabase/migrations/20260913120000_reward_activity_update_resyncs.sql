-- A ledger entry could be added or deleted, never corrected in place. The
-- sync triggers were AFTER INSERT and AFTER DELETE only, so changing a row's
-- points would have left the card's balance on the old figure — the log and
-- the card disagreeing, which is what the ledger exists to prevent.
--
-- Editing an entry now hands back what the old row did and applies what the
-- new row does, in the same transaction as the UPDATE. It only fires when an
-- amount or the card changes, so a date or note edit touches nothing.
-- benefit_used_on is deliberately left alone: only a stay sets booked_on, and
-- stay-owned entries are not editable from the ledger.
create or replace function public.resync_credit_card_reward_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.account_id = new.account_id then
    update public.credit_card_details
    set
      current_points = greatest(0, current_points - old.points_delta + new.points_delta),
      free_night_credit_cents = case
        when free_night_credit_cents is null then null
        else greatest(0, free_night_credit_cents - old.hotel_credit_delta_cents + new.hotel_credit_delta_cents)
      end,
      updated_at = now()
    where account_id = new.account_id
      and household_id = new.household_id;
  else
    update public.credit_card_details
    set
      current_points = greatest(0, current_points - old.points_delta),
      free_night_credit_cents = case
        when free_night_credit_cents is null then null
        else greatest(0, free_night_credit_cents - old.hotel_credit_delta_cents)
      end,
      updated_at = now()
    where account_id = old.account_id
      and household_id = old.household_id;

    update public.credit_card_details
    set
      current_points = greatest(0, current_points + new.points_delta),
      free_night_credit_cents = case
        when free_night_credit_cents is null then null
        else greatest(0, free_night_credit_cents + new.hotel_credit_delta_cents)
      end,
      updated_at = now()
    where account_id = new.account_id
      and household_id = new.household_id;
  end if;

  if not found then
    raise exception 'Credit card reward details not found for account %', new.account_id;
  end if;

  return new;
end;
$$;

drop trigger if exists credit_card_reward_activity_resync on public.credit_card_reward_activities;
create trigger credit_card_reward_activity_resync
  after update of points_delta, hotel_credit_delta_cents, account_id
  on public.credit_card_reward_activities
  for each row
  when (
    old.points_delta is distinct from new.points_delta
    or old.hotel_credit_delta_cents is distinct from new.hotel_credit_delta_cents
    or old.account_id is distinct from new.account_id
  )
  execute function public.resync_credit_card_reward_activity();
