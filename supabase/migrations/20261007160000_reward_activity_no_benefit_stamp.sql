-- Stop a points redemption from marking the card's free night as used.
--
-- The insert trigger copied each reward activity's booked_on onto the card's
-- benefit_used_on. Every new stay paid with points writes its check-in into
-- booked_on (the rewards log shows it as "Booked …"), so a plain points stay
-- set the card's free-night Check-in date and the certificate read as spent
-- when it wasn't. The free-night dates are set only by stays with Free night
-- ticked (syncFreeNightStamp in src/app/(app)/travel/reward-ledger.ts), so the
-- trigger now moves points and hotel credit only. booked_on stays on the
-- activity for the log.

create or replace function public.apply_credit_card_reward_activity()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
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

  if not found then
    raise exception 'Credit card reward details not found for account %', new.account_id;
  end if;

  return new;
end;
$function$;
