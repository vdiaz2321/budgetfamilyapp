-- The ledger could be added to but never corrected. The sync trigger was
-- AFTER INSERT only, so deleting a mistyped redemption left the points off the
-- card, and "Archive" hid the row without giving anything back. The only way
-- to fix a wrong entry was to retype Current points in the card's edit form,
-- which left the balance and the history disagreeing — the exact thing this
-- ledger exists to prevent.
--
-- Deleting an entry now reverses whatever it did. Note it does NOT raise when
-- the details row is already gone: an account delete cascades to its
-- activities, and there is nothing left to adjust in that case.
create or replace function public.reverse_credit_card_reward_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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

  return old;
end;
$$;

drop trigger if exists credit_card_reward_activity_reverse on public.credit_card_reward_activities;
create trigger credit_card_reward_activity_reverse
  after delete on public.credit_card_reward_activities
  for each row execute function public.reverse_credit_card_reward_activity();
