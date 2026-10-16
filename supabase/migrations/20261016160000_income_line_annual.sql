-- Income typed per year (Victor, 2026-10-16): "$130,000 a year" is how pay is
-- thought of, not $10,833.33 a month. When set, annual_cents is the amount as
-- typed and the line pays a twelfth of it each month; monthly_cents keeps the
-- rounded monthly figure for anything that reads it directly.

alter table retirement_income_lines
  add column if not exists annual_cents bigint
    check (annual_cents is null or annual_cents >= 0);
