-- Budget Family App — onboarding RPC
-- Run this in Supabase → SQL Editor → New query.
-- Safe to re-run: uses CREATE OR REPLACE.
--
-- Why this exists:
-- Onboarding used to `insert into households ... returning id` then insert a
-- profile. The RETURNING clause is evaluated against the SELECT policy
-- (id = auth_household_id()), but the caller has no profile yet, so
-- auth_household_id() is NULL and the row isn't visible — Postgres then reports
-- "new row violates row-level security policy for table households".
--
-- This function creates the household and the caller's profile in a single
-- transaction with SECURITY DEFINER, so it bypasses RLS for the bootstrap and
-- can never leave an orphaned household behind.

create or replace function create_household_with_profile(
  household_name text,
  display_name   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_household_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Idempotent: if the caller already has a household, just return it.
  select household_id into new_household_id from profiles where user_id = uid;
  if new_household_id is not null then
    return new_household_id;
  end if;

  if coalesce(btrim(household_name), '') = '' then
    raise exception 'household name is required';
  end if;

  insert into households (name)
  values (btrim(household_name))
  returning id into new_household_id;

  insert into profiles (user_id, household_id, display_name)
  values (uid, new_household_id, nullif(btrim(coalesce(display_name, '')), ''));

  return new_household_id;
end;
$$;

revoke all on function create_household_with_profile(text, text) from public;
grant execute on function create_household_with_profile(text, text) to authenticated;
