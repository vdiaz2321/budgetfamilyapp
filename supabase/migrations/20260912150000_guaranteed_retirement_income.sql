-- Income that arrives whether or not the portfolio does.
--
-- The FI number is sized on the assumption that every dollar of retirement
-- spending comes out of the portfolio. For a military household that is badly
-- pessimistic: a pension is an inflation-adjusted annuity, and so is VA
-- disability, and later Social Security. Counting none of them asks the
-- portfolio to cover spending it will never have to cover.
--
--   portfolio must cover = annual spending − guaranteed income
--   FI number            = that, divided by the withdrawal rate
--
-- Two columns, not a schedule of income streams with their own start and end
-- years — this app tracks net worth, it is not the retirement planner. One
-- combined figure in today's money and the year it starts is enough to stop the
-- FI number being wrong by a factor of three, and anything more detailed
-- belongs where the retirement plan actually lives.
alter table retirement_plan
  add column if not exists guaranteed_income_cents      bigint,
  add column if not exists guaranteed_income_start_year integer;

comment on column retirement_plan.guaranteed_income_cents is
  'Pension + VA + Social Security etc., per year, in today''s money. Reduces what the portfolio has to fund.';
comment on column retirement_plan.guaranteed_income_start_year is
  'First year the guaranteed income is received. Null means it is already being received.';
