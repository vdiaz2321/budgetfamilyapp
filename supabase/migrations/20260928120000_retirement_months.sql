-- Retirement Plan: month precision for military retirement.
--
-- Years of service count whole months (DFAS: 2.5% per year, prorated by
-- month), and a November retirement only swaps active-duty pay for retired
-- pay for the last two months of that year. Null = the whole year, as before.

alter table retirement_plan
  add column if not exists target_retire_month smallint
    check (target_retire_month between 1 and 12),
  add column if not exists service_start_month smallint
    check (service_start_month between 1 and 12);
