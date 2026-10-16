-- The COLA comes back, split (Victor, 2026-10-16). The flat 2.5% on every
-- income line pushed net worth at 90 too high, so it was dropped; now each of
-- military retired pay, VA disability and Social Security has its own switch,
-- and the actual COLA can be typed per year as each one is announced, from the
-- first year an income actually rises (retired pay the January after retiring,
-- VA from its start, Social Security from age 62). A year with no typed COLA
-- uses cola_pct.
--   cola_by_year: {"2035": 2.6} — % keyed by the year the raised payment is
--   first received (the "2035 COLA" is paid from January 2035).
alter table public.retirement_plan
  add column if not exists cola_pct numeric(5,2) not null default 2.5,
  add column if not exists cola_by_year jsonb not null default '{}'::jsonb,
  add column if not exists cola_military boolean not null default true,
  add column if not exists cola_va boolean not null default true,
  add column if not exists cola_social_security boolean not null default true;

