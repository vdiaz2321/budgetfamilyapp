-- Taxes never earned its column. It was never editable in the grid, held 0 in
-- every row Victor has ever had, and the one place that wrote it (fill
-- forward) wrote zeros — so the whole column did nothing but complicate the
-- EOY equation, which is now simply:
--
--   EOY = BOY + income - spending + growth
--
-- Income in this projection is take-home. That is the assumption the numbers
-- were always built on; dropping the column just makes it explicit.
alter table public.networth_projection
  drop column if exists taxes_cents;
