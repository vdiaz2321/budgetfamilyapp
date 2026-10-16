-- Pay that rises, and a year's income shown by source (Victor, 2026-10-16).
--
--   * retirement_income_lines.raise_pct — a Pay line's yearly raise, applied
--     from this year on. Null = none. (A blank end on a Pay line now stops it
--     at military retirement, or when withdrawals start — worked out in code.)
--   * networth_projection.income_parts — each future year's income by source
--     ([{name, cents}]), so the year popup can say where its income comes from
--     and link to where it's set.

alter table retirement_income_lines
  add column if not exists raise_pct numeric(5,2)
    check (raise_pct is null or (raise_pct >= 0 and raise_pct <= 20));

alter table networth_projection
  add column if not exists income_parts jsonb;
