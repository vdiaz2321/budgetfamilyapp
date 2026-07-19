-- Add start_cents and end_cents to investment_years so historical year-end
-- balances can be entered directly on the Invest page (they weren't part of
-- the original CSV seed, which only had contributed/accrued).
alter table investment_years
  add column if not exists start_cents bigint,
  add column if not exists end_cents bigint;
