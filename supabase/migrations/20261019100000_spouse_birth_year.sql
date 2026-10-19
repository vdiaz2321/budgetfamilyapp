-- Spouse's birth year (Victor, 2026-10-19): sits under Birth year in
-- "General Profile Data" and drives the Year by year table's Spouse Age
-- column. Blank hides that column.

alter table retirement_plan
  add column if not exists spouse_birth_year integer
    check (spouse_birth_year is null or (spouse_birth_year > 1900 and spouse_birth_year < 2200));
