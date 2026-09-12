-- The NW Projections grid is in today's money, so the rates that fill it
-- forward are real ones.
--
-- `personal_inflation_pct` and `income_growth_pct` were created as nominal
-- rates (4.00 and 2.50) alongside a `projection_return_pct` of 8.00 — but
-- nothing ever wrote any of the three, and the grid they feed is read as
-- today's money by the FI section above it. Applied nominally they would have
-- inflated the plan while the FI chart deflated nothing, widening the gap
-- between the two figures this page quotes for the same year.
--
-- They now mean "drift ABOVE inflation", so 0 is the honest default: in
-- today's money a salary that keeps pace with inflation is a flat line. Rows
-- still holding the untouched creation defaults are moved to 0; anything a
-- household actually chose is left alone (nothing could have, since no UI
-- wrote these until now, but the WHERE keeps that true if this is ever re-run).
--
-- `projection_return_pct` is left in place and unread: gains now use
-- `real_return_pct`, the same return the FI projection compounds with, so the
-- two halves of the Net Worth page can no longer disagree about growth.

alter table retirement_plan
  alter column personal_inflation_pct set default 0.00,
  alter column income_growth_pct      set default 0.00;

update retirement_plan
   set personal_inflation_pct = 0.00
 where personal_inflation_pct = 4.00;

update retirement_plan
   set income_growth_pct = 0.00
 where income_growth_pct = 2.50;
