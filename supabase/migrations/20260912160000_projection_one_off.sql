-- One-off money in or out of a projected year.
--
-- The grid could only say what a year earns, spends and grows — figures that
-- repeat. It had no way to say "in 2027 we buy the house", so a down payment
-- had to be smuggled into that year's spending, where the carry-forward then
-- repeated it for twenty years as if a house were bought annually.
--
-- Victor has a VA purchase coming in summer 2027, vehicles after that, and
-- investment properties after those, so this is not one exception to work
-- around — it is a recurring shape the grid has to hold.
--
--   EOY = BOY + income − spending + gains + one-off
--
-- Deliberately ONE signed number, not a purchase model. The app does not track
-- vehicles, amortisation schedules or property appreciation, and inventing
-- them here would make the grid an estimate of things it cannot measure. What
-- it can hold honestly is the net effect on that year's closing net worth,
-- which is a figure Victor knows and the app does not:
--
--   * $40k car paid in cash, not tracked as an asset → −40,000
--   * home purchase → roughly minus the closing costs, since the down payment
--     leaves cash and arrives as equity
--   * inheritance, a windfall, selling a property at a gain → positive
--
-- Unlike income and spending it never carries forward: a one-off is a
-- statement about one year, which is the whole point of it.
alter table networth_projection
  add column if not exists one_off_cents bigint not null default 0;

comment on column networth_projection.one_off_cents is
  'Signed one-time effect on that year''s closing net worth — a house, a car, a windfall. Never carried forward.';
