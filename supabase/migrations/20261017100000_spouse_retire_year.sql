-- Spouse's expected retirement year (Victor, 2026-10-17): sits beside the
-- plan's own Expected Retirement Year in "Info Data About You".

alter table retirement_plan
  add column if not exists spouse_retire_year integer
    check (spouse_retire_year is null or (spouse_retire_year > 1900 and spouse_retire_year < 2200));
