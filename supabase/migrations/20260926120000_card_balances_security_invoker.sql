-- v_card_balances lost security_invoker when 20260912140000 rebuilt it with a
-- plain `create or replace view` (the original 20260826183000 version had it).
-- Without it the view ran with its owner's rights and skipped RLS, so anyone
-- holding the public anon key could read every household's card balances
-- through the REST API — no sign-in needed. Every other view already has this.
alter view public.v_card_balances set (security_invoker = true);
