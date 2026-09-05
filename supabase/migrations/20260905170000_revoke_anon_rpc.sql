-- These are all "do something to the signed-in user's household" functions, so
-- an unauthenticated caller has no business reaching them. They are SECURITY
-- DEFINER, which makes an anonymous call the kind of thing worth ruling out
-- rather than reasoning about.
--
-- Revoking from `anon` alone does nothing while PUBLIC still holds EXECUTE
-- (anon inherits it), so the grant is taken from PUBLIC and handed back to the
-- one role the app actually calls with. RLS inside each function is unchanged.
revoke execute on function public.auth_household_id() from public, anon;
revoke execute on function public.create_household_with_profile(text, text) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.get_or_create_invite_code() from public, anon;
revoke execute on function public.join_household_by_code(text, text) from public, anon;

grant execute on function public.auth_household_id() to authenticated;
grant execute on function public.create_household_with_profile(text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.get_or_create_invite_code() to authenticated;
grant execute on function public.join_household_by_code(text, text) to authenticated;
