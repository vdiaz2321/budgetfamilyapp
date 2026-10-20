-- Social Security PIA on the income line (Victor, 2026-10-20).
--
-- pia_cents: the full-retirement-age benefit per month (the PIA on the SSA
--   statement), Social Security lines only. Drives the survivor benefits on
--   that record: 75% per child, 75% to a spouse caring for a child under 16,
--   the widow(er) benefit, and the family maximum. Null = worked out from the
--   line's amount and start age.

alter table retirement_income_lines
  add column if not exists pia_cents bigint
    check (pia_cents is null or pia_cents >= 0);
