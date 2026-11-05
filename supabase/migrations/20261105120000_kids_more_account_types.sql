-- Kids Funding gains three types: Coverdell ESA, custodial Roth IRA and ABLE
-- account. Only the beneficiary change needs the database: a Coverdell or ABLE
-- account can now change beneficiary as a 529 can, each within its own law.
-- Sources are listed in src/lib/kids-funding.ts. The function keeps its
-- signature and grant, so it's replaced in place.

create or replace function public.kids_change_beneficiary(
  p_account_id uuid,
  p_bucket_id uuid,
  p_to_kid_id uuid,
  p_on date,
  p_note text default null
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_household_id uuid := public.auth_household_id();
  v_type text;
  v_from_kid uuid;
  v_from_name text;
  v_to_name text;
  v_name text;
  v_new_name text;
  v_to_born date;
begin
  if v_household_id is null then
    raise exception 'No household is available for this user.';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'Pick a date that isn''t in the future.';
  end if;

  select name into v_to_name from public.kids where id = p_to_kid_id and household_id = v_household_id;
  if v_to_name is null then raise exception 'Pick who it''s for now.'; end if;

  if p_bucket_id is not null then
    select coalesce(b.subtype, a.subtype), b.kid_id, b.name into v_type, v_from_kid, v_name
    from public.buckets b join public.accounts a on a.id = b.account_id
    where b.id = p_bucket_id and b.account_id = p_account_id and b.household_id = v_household_id
      and a.is_kids_account is true and b.date_closed is null
    for update of b;
  else
    select subtype, kid_id, name into v_type, v_from_kid, v_name
    from public.accounts
    where id = p_account_id and household_id = v_household_id
      and is_kids_account is true and date_closed is null
    for update;
  end if;
  if v_name is null then raise exception 'Account not found.'; end if;
  -- 529: a family member. Coverdell ESA: a family member under 30 on the date
  -- (26 U.S.C. 530(d)(6)). ABLE account: a sibling who is ABLE-eligible too
  -- (26 CFR 1.529A-2); eligibility is a medical fact the app can't check, so
  -- the app says so instead.
  if v_type is null or v_type not in ('529', 'Coverdell ESA', 'ABLE Account') then
    raise exception 'Only a 529, Coverdell ESA or ABLE account can change beneficiary.';
  end if;
  if v_type = 'Coverdell ESA' then
    select birth_month into v_to_born from public.kids where id = p_to_kid_id and household_id = v_household_id;
    if v_to_born is null or (v_to_born + interval '30 years')::date <= p_on then
      raise exception 'A Coverdell can only go to someone under 30.';
    end if;
  end if;
  if v_from_kid is not distinct from p_to_kid_id then
    raise exception 'It''s already for %.', v_to_name;
  end if;

  select name into v_from_name from public.kids where id = v_from_kid and household_id = v_household_id;
  v_new_name := case when v_from_name is null then v_name
    else regexp_replace(v_name, '\m' || v_from_name || '\M', v_to_name, 'g') end;

  if p_bucket_id is not null then
    update public.buckets set kid_id = p_to_kid_id, name = v_new_name, updated_at = now() where id = p_bucket_id;
  else
    update public.accounts
    set kid_id = p_to_kid_id, name = v_new_name, holder = v_to_name, updated_at = now()
    where id = p_account_id;
  end if;

  insert into public.kids_account_events
    (household_id, event, account_id, bucket_id, from_kid_id, to_kid_id, note, occurred_on)
  values
    (v_household_id, 'beneficiary_changed', p_account_id, p_bucket_id, v_from_kid, p_to_kid_id, nullif(trim(p_note), ''), p_on);
end;
$$;
