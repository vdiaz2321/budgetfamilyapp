-- One-time fix/backfill for the Invest page historical data (2026-07-19).
-- Household: fb0f52d2-cd2d-46af-874f-229711ba7b93 (the only household with accounts).
-- Run once in the Supabase SQL Editor. Every dollar figure below was checked
-- against "Net Worth Yearly Breakdown - Invest Accrued 2026.csv" by hand.
--
-- What this fixes, and why the original 0020 seed missed it:
--  1) 8 accounts on the CSV (Fidelity Roth Vic/Jo, the 529s, the UTMAs) were
--     never created under Accounts at all — the seed's name-match had
--     nothing to attach their rows to, so that data silently dropped.
--  2) "Charles Schwab" (app name) never matched "Charles Schwab IRA" (CSV
--     name), so its 2024/2025 numbers never seeded.
--  3) The original seed's "Fidelity" match hit BOTH accounts named
--     "Fidelity" in this household — the real investment one (correct) and
--     a kids-checking account (wrong). Step 1 below removes the wrong one.
--
-- Balances on the 8 new accounts are left at $0 — this file only seeds
-- Contributed/Gain history. Set each one's actual current balance on the
-- Net Worth page same as any other account.

-- 1) Remove the accidental duplicate rows on the wrong "Fidelity" account.
delete from investment_years
where account_id = '7296f0da-6438-45b7-ad94-e0d0e23847fe';

-- 2) Create the 8 missing accounts, then seed their historical years.
with new_accounts as (
  insert into accounts (household_id, name, kind, holder, subtype, is_kids_account, sort_order)
  values
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', 'Fidelity Roth Vic', 'investment', 'Vic',    'Roth IRA', false, 100),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', 'Fidelity Roth Jo',  'investment', 'Jo',     'Roth IRA', false, 101),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '529 Leo',           'investment', 'Leo',    '529',      true,  102),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '529 Hannah',        'investment', 'Hannah', '529',      true,  103),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '529 Ben',           'investment', 'Ben',    '529',      true,  104),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', 'UTMA Leo',          'investment', 'Leo',    'UTMA',     true,  105),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', 'UTMA Hannah',       'investment', 'Hannah', 'UTMA',     true,  106),
    ('fb0f52d2-cd2d-46af-874f-229711ba7b93', 'UTMA Ben',          'investment', 'Ben',    'UTMA',     true,  107)
  returning id, name
)
insert into investment_years (household_id, account_id, year, contributed_cents, accrued_cents)
select 'fb0f52d2-cd2d-46af-874f-229711ba7b93', na.id, v.year, v.contributed_cents, v.accrued_cents
from new_accounts na
join (values
  ('Fidelity Roth Vic', 2026, 361500, 0),
  ('Fidelity Roth Vic', 2025, 493200, 192400),
  ('Fidelity Roth Vic', 2024, 517600, 39000),
  ('Fidelity Roth Jo',  2026, 310000, 0),
  ('Fidelity Roth Jo',  2025, 390000, 40600),
  ('529 Leo',           2026, 156000, 0),
  ('529 Hannah',        2026, 114000, 0),
  ('529 Ben',           2026, 78000, 0),
  ('UTMA Leo',          2025, 70000, 60100),
  ('UTMA Leo',          2024, 120000, 0),
  ('UTMA Hannah',       2025, 70000, 65300),
  ('UTMA Hannah',       2024, 120000, 0),
  ('UTMA Ben',          2025, 100000, 6500)
) as v(name, year, contributed_cents, accrued_cents)
  on v.name = na.name;

-- 3) Charles Schwab — attach the missing 2024/2025 rows to the existing
--    account (id looked up directly, no name-match involved this time).
insert into investment_years (household_id, account_id, year, contributed_cents, accrued_cents)
values
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '417cc2b2-1350-4d75-a4ab-487c5cbcae3e', 2025, 0, 270600),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '417cc2b2-1350-4d75-a4ab-487c5cbcae3e', 2024, 0, 339500)
on conflict (household_id, account_id, year) do update
set contributed_cents = excluded.contributed_cents,
    accrued_cents = excluded.accrued_cents,
    updated_at = now();
