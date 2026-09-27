-- Retirement Plan: healthcare as its own cost.
--
-- A yearly healthcare cost (today's dollars) from a chosen age, rising faster
-- than general inflation (medical inflation runs ahead of it). Stored the same
-- way as pay: networth_projection.base_spending_cents is the spending Victor
-- types for a year, and spending_cents stays the year's TOTAL (typed spending
-- + healthcare), recomputed whenever the plan changes — so every existing
-- reader of spending_cents keeps working.

alter table retirement_plan
  add column if not exists healthcare_annual_cents bigint
    check (healthcare_annual_cents is null or healthcare_annual_cents >= 0),
  add column if not exists healthcare_start_age integer not null default 65
    check (healthcare_start_age >= 18 and healthcare_start_age <= 120),
  add column if not exists healthcare_growth_pct numeric(5,2) not null default 1.50
    check (healthcare_growth_pct >= 0 and healthcare_growth_pct <= 20);

alter table networth_projection
  add column if not exists base_spending_cents bigint;

update networth_projection
   set base_spending_cents = spending_cents
 where base_spending_cents is null;
