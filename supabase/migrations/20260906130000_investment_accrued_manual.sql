-- Gains (accrued_cents) become automatic: end balance − start balance −
-- contributions, both balances read from the Accounts page's monthly
-- snapshots. A typed figure still wins, so this flag records which rows the
-- user set by hand. Existing non-zero gains were all hand-typed (2024/2025),
-- so they are marked manual and keep showing exactly what they show today.
alter table investment_years
  add column if not exists accrued_manual boolean not null default false;

update investment_years set accrued_manual = true where accrued_cents <> 0;
