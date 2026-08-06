-- Delete-my-account RPC. Security definer so it can reach into auth.users to
-- remove the login row after wiping data.
--
-- Rules:
--   * If the caller is the only profile in their household → delete the whole
--     household (cascades every table off it), then remove the auth user.
--   * If other profiles remain → delete only the caller's profile and their
--     auth user; the household and its data stay intact for the spouse.

create or replace function delete_my_account() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  member_count int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select household_id into hid from profiles where user_id = uid;

  if hid is not null then
    select count(*) into member_count from profiles where household_id = hid;

    if member_count <= 1 then
      -- Solo owner: drop the household, cascade takes care of every table.
      delete from households where id = hid;
    else
      -- Others still using this household: just remove this profile.
      delete from profiles where user_id = uid;
    end if;
  end if;

  -- Remove the login row so the email can be reused for a fresh signup.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;
