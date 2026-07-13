-- Household invites — let a spouse join an existing household instead of
-- always creating a new one on sign-up.
-- Run this in Supabase → SQL Editor → New query. Safe to re-run.

alter table households add column if not exists invite_code text unique;

-- Backfill existing households with a short shareable code.
update households
set invite_code = upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 8))
where invite_code is null;

-- Returns the caller's household invite code, generating one if missing.
-- Callable only by an existing member (relies on auth_household_id()).
create or replace function get_or_create_invite_code() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := auth_household_id();
  code text;
begin
  if hid is null then
    raise exception 'not a household member';
  end if;

  select invite_code into code from households where id = hid;
  if code is null then
    code := upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 8));
    update households set invite_code = code where id = hid;
  end if;

  return code;
end;
$$;

revoke all on function get_or_create_invite_code() from public;
grant execute on function get_or_create_invite_code() to authenticated;

-- Joins the caller to an existing household by invite code. Idempotent: if
-- the caller already has a profile, returns their existing household_id
-- untouched (does not switch households).
create or replace function join_household_by_code(
  code text,
  display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_household_id uuid;
  existing_household_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select household_id into existing_household_id from profiles where user_id = uid;
  if existing_household_id is not null then
    return existing_household_id;
  end if;

  select id into target_household_id
  from households
  where invite_code = upper(btrim(code));

  if target_household_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into profiles (user_id, household_id, display_name)
  values (uid, target_household_id, nullif(btrim(coalesce(display_name, '')), ''));

  return target_household_id;
end;
$$;

revoke all on function join_household_by_code(text, text) from public;
grant execute on function join_household_by_code(text, text) to authenticated;
