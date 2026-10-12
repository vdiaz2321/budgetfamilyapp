-- Plain rates for the Net Worth plan (Victor, 2026-10-12): "real return +
-- inflation" read as one confusing 7.5%, and inflation seemed to grow income.
-- Now each rate does one job:
--   investment_return_pct  expected yearly return on investments, typed as is
--   cola_pct               yearly COLA on retired pay, VA, Social Security
--   inflation_pct          (existing) now only raises spending, healthcare and
--                          rental prices
--   savings_to_invest_pct  share of each year's saving that goes to
--                          investments. Taken out of the form the same day —
--                          new savings now split like the accounts today —
--                          so it is no longer read
--   withdraw_start_year    when 4% withdrawals start (he may work a civilian
--                          job after military retirement); null = that year
-- real_return_pct and retirement_tax_pct stay but are no longer read: income
-- is shown gross (taxes are budgeted as spending).
alter table public.retirement_plan
  add column if not exists investment_return_pct numeric(5,2) not null default 7.50
    check (investment_return_pct >= -20 and investment_return_pct <= 30),
  add column if not exists cola_pct numeric(5,2) not null default 2.50
    check (cola_pct >= 0 and cola_pct <= 20),
  add column if not exists savings_to_invest_pct numeric(5,2) not null default 70.00
    check (savings_to_invest_pct >= 0 and savings_to_invest_pct <= 100),
  add column if not exists withdraw_start_year integer
    check (withdraw_start_year is null or withdraw_start_year between 1900 and 2200);

-- Keep today's plan where it is: the old growth was real return + inflation,
-- and COLA followed inflation.
update public.retirement_plan
   set investment_return_pct = real_return_pct + inflation_pct,
       cola_pct = inflation_pct;
