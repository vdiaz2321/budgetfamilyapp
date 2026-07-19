-- One-time historical seed of investment_years from Victor's "Invest Accrued"
-- sheet (2023-2026). Run ONCE in the Supabase SQL Editor after migration 0020.
-- Idempotent: re-running overwrites the same account+year rows.
--
-- Accounts are matched by NAME (case-insensitive). If a sheet name differs from
-- the account you created on the Accounts page, add an override to name_map
-- below (csv_name, account_name). Any sheet name that doesn't match an account
-- is reported by the final NOTICE block and is simply skipped (nothing is
-- seeded to the wrong account).

with seed(csv_name, is_kids, year, contributed_cents, accrued_cents, est_cents) as (
  values
    ('Gold/Silver', false, 2025, 0, 354900, 0),
    ('Gold/Silver', false, 2024, 0, 6100, 0),
    ('TSP', false, 2026, 274874, 0, 659600),
    ('TSP', false, 2025, 194198, 558402, 0),
    ('TSP', false, 2024, 0, 863800, 0),
    ('Charles Schwab IRA', false, 2025, 0, 270600, 0),
    ('Charles Schwab IRA', false, 2024, 0, 339500, 0),
    ('M1', false, 2025, 0, 142200, 0),
    ('M1', false, 2024, 0, 186200, 0),
    ('Fidelity', false, 2026, 273863, 0, 900000),
    ('Fidelity', false, 2025, 540000, 657200, 600000),
    ('Fidelity', false, 2024, 517600, 557800, 0),
    ('Fidelity', false, 2023, 529500, 0, 0),
    ('Fidelity Roth Vic', false, 2026, 361500, 0, 700000),
    ('Fidelity Roth Vic', false, 2025, 493200, 192400, 700000),
    ('Fidelity Roth Vic', false, 2024, 517600, 39000, 0),
    ('Crypto', false, 2026, 270000, 0, 600000),
    ('Crypto', false, 2025, 641500, 393300, 540000),
    ('Crypto', false, 2024, 0, 30000, 0),
    ('Fundrise', false, 2024, 46900, 66200, 0),
    ('Fundrise', false, 2023, 140400, 0, 0),
    ('Fidelity Roth Jo', true, 2026, 310000, 0, 600000),
    ('Fidelity Roth Jo', true, 2025, 390000, 40600, 360000),
    ('Leo 529', true, 2026, 156000, 0, 312000),
    ('Hannah 529', true, 2026, 114000, 0, 228000),
    ('Ben 529', true, 2026, 78000, 0, 156000),
    ('UTMA Leo (6231)', true, 2025, 70000, 60100, 120000),
    ('UTMA Leo (6231)', true, 2024, 120000, 0, 0),
    ('UTMA Hannah (8521)', true, 2025, 70000, 65300, 120000),
    ('UTMA Hannah (8521)', true, 2024, 120000, 0, 0),
    ('UTMA Ben', true, 2025, 100000, 6500, 120000)
),
-- EDIT ME: overrides for sheet name -> Accounts page name mismatches.
-- Unlisted names match themselves. Examples you may need:
--   ('Leo 529', '529 Leo'), ('Hannah 529', '529 Hannah'), ('Ben 529', '529 Ben'),
--   ('UTMA Leo (6231)', 'UTMA Leo'), ('Fidelity Roth Vic', 'Fidelity Roth')
name_map(csv_name, account_name) as (
  values
    (null::text, null::text)   -- placeholder so the CTE is never empty; add real rows above/here
),
resolved as (
  select s.*, coalesce(nm.account_name, s.csv_name) as account_name
  from seed s
  left join name_map nm on nm.csv_name = s.csv_name
),
matched as (
  select a.household_id, a.id as account_id, r.year,
         r.contributed_cents, r.accrued_cents, r.est_cents
  from resolved r
  join accounts a on lower(a.name) = lower(r.account_name)
)
insert into investment_years
  (household_id, account_id, year, contributed_cents, accrued_cents, est_contribute_cents)
select household_id, account_id, year, contributed_cents, accrued_cents, est_cents
from matched
on conflict (household_id, account_id, year) do update set
  contributed_cents    = excluded.contributed_cents,
  accrued_cents        = excluded.accrued_cents,
  est_contribute_cents = excluded.est_contribute_cents,
  updated_at           = now();

-- Report any sheet names that matched no account (so nothing is silently lost).
do $$
declare
  missing text;
begin
  select string_agg(distinct csv_name, ', ')
    into missing
  from (
    values
      ('Gold/Silver'),
      ('TSP'),
      ('Charles Schwab IRA'),
      ('M1'),
      ('Fidelity'),
      ('Fidelity Roth Vic'),
      ('Crypto'),
      ('Fundrise'),
      ('Fidelity Roth Jo'),
      ('Leo 529'),
      ('Hannah 529'),
      ('Ben 529'),
      ('UTMA Leo (6231)'),
      ('UTMA Hannah (8521)'),
      ('UTMA Ben')
  ) as s(csv_name)
  where not exists (
    select 1 from accounts a where lower(a.name) = lower(s.csv_name)
  );
  if missing is not null then
    raise notice 'Unmatched sheet account names (not seeded): %', missing;
  else
    raise notice 'All sheet account names matched an account.';
  end if;
end $$;
