-- The month an income line starts paying in its first year (1–12; null =
-- January), for every line type. Social Security at 67 starts in Victor's
-- birth month (Mar 2048), not January, so the first year only counts the
-- months from the start month on — Victor, 2026-10-15.
alter table public.retirement_income_lines
  add column if not exists start_month smallint
    check (start_month is null or start_month between 1 and 12);
