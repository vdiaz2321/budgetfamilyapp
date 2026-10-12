-- What cash (checking + savings buckets) earns a year in the Net Worth plan.
--
-- The plan used to grow the whole net worth at the investment return
-- (real return + inflation, 7.5%), so $180k sitting in a savings account was
-- projected to earn stock-market growth. Now only investments get that rate;
-- cash grows at this one (a high-yield savings APY), and everything saved goes
-- to investments.
alter table public.retirement_plan
  add column if not exists cash_return_pct numeric(5,2) not null default 3.00
    check (cash_return_pct >= 0 and cash_return_pct <= 20);
