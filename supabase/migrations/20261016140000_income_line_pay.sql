-- Future income comes only from the retirement assumptions (Victor,
-- 2026-10-16). The pay typed into the Net Worth table carried his old Google
-- Sheet's stand-ins ($130k, then $100k a year to 2071) into every future year,
-- so a plan with no income lines still showed income. Future years now ignore
-- typed pay; work pay is an income line like any other:
--
--   * kind 'pay' — your own pay from work (a spouse's is 'spouse');
--   * end_month — the last month a line pays in its end year, so pay can stop
--     in October and military retired pay start in November.

alter table retirement_income_lines drop constraint if exists retirement_income_lines_kind_check;
alter table retirement_income_lines add constraint retirement_income_lines_kind_check
  check (kind in ('pay', 'va', 'social_security', 'job', 'spouse', 'other'));

alter table retirement_income_lines
  add column if not exists end_month integer
    check (end_month is null or (end_month >= 1 and end_month <= 12));
