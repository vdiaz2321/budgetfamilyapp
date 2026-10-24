-- TRICARE For Life typed per month or per year (Victor, 2026-10-24), like the
-- health and dental plans. healthcare_annual_cents stays the yearly figure;
-- this only says how the box shows it. Monthly by default.
alter table public.retirement_plan
  add column if not exists healthcare_annual_per text not null default 'mo'
    check (healthcare_annual_per in ('mo', 'yr'));
