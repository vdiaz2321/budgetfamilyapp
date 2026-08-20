create or replace function public.apply_credit_card_reward_activity()
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
