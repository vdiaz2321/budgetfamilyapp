-- Survivor spending per year (Victor, 2026-10-19): typed in the Year by year
-- popup as a % of that year's Total Spending, for the "If you die first"
-- card. Blank carries the last typed year's %, or 100% when none was typed.
-- Replaces the single plan-wide % added earlier the same day (it only ever
-- held test values).

alter table networth_projection
  add column if not exists survivor_spending_pct numeric(5,2)
    check (survivor_spending_pct is null or (survivor_spending_pct > 0 and survivor_spending_pct <= 100));

alter table retirement_plan drop column if exists survivor_spending_pct;
