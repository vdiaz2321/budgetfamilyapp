-- The three reporting views summed `transactions` with no household filter and
-- ran as their owner, so RLS never applied to them: any signed-in user could
-- read every household's monthly and annual totals straight off the REST API.
-- Every call site in the app already filters by household_id, so switching the
-- views to the caller's own permissions changes nothing the app can see and
-- closes the hole for everyone else.
alter view public.v_monthly_actuals set (security_invoker = true);
alter view public.v_annual_breakdown set (security_invoker = true);
alter view public.v_year_summary set (security_invoker = true);
