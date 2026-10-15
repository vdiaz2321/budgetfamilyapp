-- Monthly base pay per calendar year for the High-3, e.g.
-- {"2030": 1050800, "2031": 1065300} (cents). DFAS's High-3 is the average of
-- the 36 months of base pay before retired pay starts, so each year's rate
-- counts for the months it covers (a Nov 2033 start: 2030 ×2, 2031 ×12,
-- 2032 ×12, 2033 ×10). The Edit popup computes that average from these and
-- saves it to high3_monthly_cents, which everything else keeps reading.
-- Before this, one High-3 box held the final year's pay — Victor, 2026-10-15.
alter table public.retirement_plan
  add column if not exists base_pay_by_year jsonb not null default '{}'::jsonb;
