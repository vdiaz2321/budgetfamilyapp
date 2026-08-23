-- Go-to APR: the rate a promotional balance reverts to once
-- `promo_apr_ends_on` passes.
--
-- Until now `debts.apr` was a single flat rate applied for the whole
-- projection, so a 0% balance-transfer card was modelled as 0% forever and its
-- payoff date, interest total, and plan comparison were all wrong in the
-- optimistic direction — for exactly the debts where the deadline is the point.
--
-- Nullable on purpose: null means "go-to rate not recorded", and the
-- projection falls back to `apr` rather than inventing a number.
alter table public.debts
  add column if not exists post_promo_apr numeric(6, 3);

comment on column public.debts.post_promo_apr is
  'APR that applies after promo_apr_ends_on. Null = unknown; projections fall back to apr.';
