-- One-time backfill of per-account / per-bucket monthly balances for 2026 H1.
-- Household: fb0f52d2-cd2d-46af-874f-229711ba7b93
--
-- Source: three screenshots of the Net Worth Yearly Breakdown (2026 tab):
--   • Screenshot 1 — Total Assets / Savings section / Bank Accounts section
--   • Screenshot 2 — Stocks/Investments section
--   • Screenshot 3 — Kids Funding section
-- Months covered: 2026-01-01 through 2026-06-01
--
-- EXCLUDED: Crypto (you will enter Jan–Jun manually via the /networth grid).
--
-- ⚠️  IMPORTANT — read before running:
-- Once ANY per-account_snapshots row exists for a month, the Net Worth page
-- switches that month to "live" mode and ignores the section-level networth_history
-- fallback entirely. If you run only part of this seed (e.g. just Bank Accounts),
-- the Savings and Stocks columns for those months will show $0 instead of the
-- real section totals. Run the full file in one shot, or not at all.
--
-- HOW TO USE:
-- 1. Paste just the STEP 1 SELECT below into Supabase SQL Editor → Run.
--    Every row should show a non-null id. Fix any account/bucket name mismatches
--    in the app (/accounts) before proceeding.
-- 2. Paste the remaining INSERT blocks (STEP 2 onward) and run.
--    All inserts use ON CONFLICT DO UPDATE — safe to re-run.

-- ============================================================
-- STEP 1 — VERIFICATION: confirm every account/bucket name resolves
-- ============================================================
-- Run this SELECT first; fix any NULL ids in /accounts before the inserts.
/*
SELECT 'account' AS kind, name, (
  SELECT id FROM accounts
  WHERE household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND name = t.name
) AS id
FROM (VALUES
  ('USAA'),
  ('Ally Bank'),
  ('Cap One Checking'),
  ('Cap One Savings'),
  ('Credit Service Union'),
  ('Gold/Silver'),
  ('TSP'),
  ('Charles Schwab'),
  ('Fundrise'),
  ('M1'),
  ('Fidelity (Taxable) Vic'),
  ('Fidelity Roth Vic'),
  ('Fidelity Roth Jo'),
  ('Robinhood'),
  ('529 Leo (1028)'),
  ('529 Hannah (4823)'),
  ('529 Ben (4830)'),
  ('UTMA Leo (6231)'),
  ('UTMA Hannah (8521)'),
  ('UTMA Ben')
) AS t(name)
UNION ALL
SELECT 'bucket' AS kind, name, (
  SELECT id FROM buckets
  WHERE household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND name = t.name
) AS id
FROM (VALUES
  ('Real Estate'),
  ('Vehicle Purchase'),
  ('Emergency Fund'),
  ('Wallet$'),
  ('AMEX Savings (Extra)')
) AS t(name)
ORDER BY kind, name;
*/

-- ============================================================
-- STEP 2 — BANK ACCOUNTS  (account_snapshots)
-- ============================================================

INSERT INTO account_snapshots (household_id, month, account_id, kind, balance_cents, updated_at)
SELECT
  'fb0f52d2-cd2d-46af-874f-229711ba7b93',
  v.month::date,
  a.id,
  a.kind,
  v.balance_cents,
  now()
FROM (VALUES
  -- USAA
  ('USAA', '2026-01-01', 85000),
  ('USAA', '2026-02-01', 85000),
  ('USAA', '2026-03-01', 80000),
  ('USAA', '2026-04-01', 80000),
  ('USAA', '2026-05-01', 70000),
  ('USAA', '2026-06-01', 50000),
  -- Ally Bank
  ('Ally Bank', '2026-01-01', 86400),
  ('Ally Bank', '2026-02-01', 86900),
  ('Ally Bank', '2026-03-01', 87100),
  ('Ally Bank', '2026-04-01', 87300),
  ('Ally Bank', '2026-05-01', 87600),
  ('Ally Bank', '2026-06-01', 87800),
  -- Cap One Checking
  ('Cap One Checking', '2026-01-01', 2500),
  ('Cap One Checking', '2026-02-01', 2500),
  ('Cap One Checking', '2026-03-01', 2500),
  ('Cap One Checking', '2026-04-01', 3600),
  ('Cap One Checking', '2026-05-01', 2500),
  ('Cap One Checking', '2026-06-01', 2500),
  -- Cap One Savings
  ('Cap One Savings', '2026-01-01', 53900),
  ('Cap One Savings', '2026-02-01', 54400),
  ('Cap One Savings', '2026-03-01', 54500),
  ('Cap One Savings', '2026-04-01', 54600),
  ('Cap One Savings', '2026-05-01', 54800),
  ('Cap One Savings', '2026-06-01', 54900),
  -- Credit Service Union
  ('Credit Service Union', '2026-01-01', 30600),
  ('Credit Service Union', '2026-02-01', 33000),
  ('Credit Service Union', '2026-03-01', 39100),
  ('Credit Service Union', '2026-04-01', 48200),
  ('Credit Service Union', '2026-05-01', 57100),
  ('Credit Service Union', '2026-06-01', 63800)
) AS v(name, month, balance_cents)
JOIN accounts a
  ON a.household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND a.name = v.name
ON CONFLICT (household_id, month, account_id)
DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();


-- ============================================================
-- STEP 3 — SAVINGS BUCKETS  (bucket_snapshots)
-- These 5 buckets sum to the parent savings account's monthly total.
-- After inserting, STEP 4 re-derives the parent account_snapshots row.
-- ============================================================

INSERT INTO bucket_snapshots (household_id, month, bucket_id, account_id, balance_cents, updated_at)
SELECT
  'fb0f52d2-cd2d-46af-874f-229711ba7b93',
  v.month::date,
  b.id,
  b.account_id,
  v.balance_cents,
  now()
FROM (VALUES
  -- Real Estate (flat $127,000 every month)
  ('Real Estate', '2026-01-01', 12700000),
  ('Real Estate', '2026-02-01', 12700000),
  ('Real Estate', '2026-03-01', 12700000),
  ('Real Estate', '2026-04-01', 12700000),
  ('Real Estate', '2026-05-01', 12700000),
  ('Real Estate', '2026-06-01', 12700000),
  -- Vehicle Purchase (flat $15,000)
  ('Vehicle Purchase', '2026-01-01', 1500000),
  ('Vehicle Purchase', '2026-02-01', 1500000),
  ('Vehicle Purchase', '2026-03-01', 1500000),
  ('Vehicle Purchase', '2026-04-01', 1500000),
  ('Vehicle Purchase', '2026-05-01', 1500000),
  ('Vehicle Purchase', '2026-06-01', 1500000),
  -- Emergency Fund (flat $20,000)
  ('Emergency Fund', '2026-01-01', 2000000),
  ('Emergency Fund', '2026-02-01', 2000000),
  ('Emergency Fund', '2026-03-01', 2000000),
  ('Emergency Fund', '2026-04-01', 2000000),
  ('Emergency Fund', '2026-05-01', 2000000),
  ('Emergency Fund', '2026-06-01', 2000000),
  -- Wallet$ (flat $5,000)
  ('Wallet$', '2026-01-01', 500000),
  ('Wallet$', '2026-02-01', 500000),
  ('Wallet$', '2026-03-01', 500000),
  ('Wallet$', '2026-04-01', 500000),
  ('Wallet$', '2026-05-01', 500000),
  ('Wallet$', '2026-06-01', 500000),
  -- AMEX Savings (Extra)
  ('AMEX Savings (Extra)', '2026-01-01', 170000),
  ('AMEX Savings (Extra)', '2026-02-01', 180000),
  ('AMEX Savings (Extra)', '2026-03-01', 577200),
  ('AMEX Savings (Extra)', '2026-04-01', 330000),
  ('AMEX Savings (Extra)', '2026-05-01', 450000),
  ('AMEX Savings (Extra)', '2026-06-01', 420000)
) AS v(name, month, balance_cents)
JOIN buckets b
  ON b.household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND b.name = v.name
ON CONFLICT (household_id, month, bucket_id)
DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();


-- ============================================================
-- STEP 4 — RE-DERIVE parent savings account_snapshots from bucket sums
-- (mirrors what syncAccountSnapshotFromBuckets does in the app)
-- ============================================================

INSERT INTO account_snapshots (household_id, month, account_id, kind, balance_cents, updated_at)
SELECT
  bs.household_id,
  bs.month,
  bs.account_id,
  a.kind,
  SUM(bs.balance_cents),
  now()
FROM bucket_snapshots bs
JOIN accounts a
  ON a.id = bs.account_id AND a.household_id = bs.household_id
WHERE bs.household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93'
  AND bs.month BETWEEN '2026-01-01'::date AND '2026-06-01'::date
  AND bs.account_id IN (
    SELECT DISTINCT account_id FROM buckets
    WHERE household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93'
      AND name IN ('Real Estate','Vehicle Purchase','Emergency Fund','Wallet$','AMEX Savings (Extra)')
  )
GROUP BY bs.household_id, bs.month, bs.account_id, a.kind
ON CONFLICT (household_id, month, account_id)
DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();


-- ============================================================
-- STEP 5 — STOCKS / INVESTMENTS  (account_snapshots)
-- Crypto excluded — enter Jan–Jun manually in /networth grid.
-- ============================================================

INSERT INTO account_snapshots (household_id, month, account_id, kind, balance_cents, updated_at)
SELECT
  'fb0f52d2-cd2d-46af-874f-229711ba7b93',
  v.month::date,
  a.id,
  a.kind,
  v.balance_cents,
  now()
FROM (VALUES
  -- Gold/Silver
  ('Gold/Silver', '2026-01-01',  950000),
  ('Gold/Silver', '2026-02-01',  939000),
  ('Gold/Silver', '2026-03-01',  816600),
  ('Gold/Silver', '2026-04-01',  830000),
  ('Gold/Silver', '2026-05-01',  830000),
  ('Gold/Silver', '2026-06-01',  739200),
  -- TSP
  ('TSP', '2026-01-01', 5142400),
  ('TSP', '2026-02-01', 5041600),
  ('TSP', '2026-03-01', 4853700),
  ('TSP', '2026-04-01', 5424300),
  ('TSP', '2026-05-01', 5827700),
  ('TSP', '2026-06-01', 5823200),
  -- Charles Schwab
  ('Charles Schwab', '2026-01-01', 1970000),
  ('Charles Schwab', '2026-02-01', 1952300),
  ('Charles Schwab', '2026-03-01', 1832200),
  ('Charles Schwab', '2026-04-01', 2028300),
  ('Charles Schwab', '2026-05-01', 2143900),
  ('Charles Schwab', '2026-06-01', 2086600),
  -- Fundrise
  ('Fundrise', '2026-01-01', 139300),
  ('Fundrise', '2026-02-01', 139200),
  ('Fundrise', '2026-03-01', 139200),
  ('Fundrise', '2026-04-01', 135500),
  ('Fundrise', '2026-05-01', 134500),
  ('Fundrise', '2026-06-01', 134200),
  -- M1
  ('M1', '2026-01-01', 1101800),
  ('M1', '2026-02-01', 1065500),
  ('M1', '2026-03-01', 1037800),
  ('M1', '2026-04-01', 1138300),
  ('M1', '2026-05-01', 1220100),
  ('M1', '2026-06-01', 1050200),
  -- Fidelity (Taxable) Vic
  ('Fidelity (Taxable) Vic', '2026-01-01', 3734500),
  ('Fidelity (Taxable) Vic', '2026-02-01', 3810500),
  ('Fidelity (Taxable) Vic', '2026-03-01', 3575700),
  ('Fidelity (Taxable) Vic', '2026-04-01', 4025200),
  ('Fidelity (Taxable) Vic', '2026-05-01', 4296800),
  ('Fidelity (Taxable) Vic', '2026-06-01', 4245000),
  -- Fidelity Roth Vic
  ('Fidelity Roth Vic', '2026-01-01', 1455500),
  ('Fidelity Roth Vic', '2026-02-01', 1491400),
  ('Fidelity Roth Vic', '2026-03-01', 1450200),
  ('Fidelity Roth Vic', '2026-04-01', 1686600),
  ('Fidelity Roth Vic', '2026-05-01', 1846200),
  ('Fidelity Roth Vic', '2026-06-01', 1831000),
  -- Fidelity Roth Jo
  ('Fidelity Roth Jo', '2026-01-01',  430600),
  ('Fidelity Roth Jo', '2026-02-01',  471500),
  ('Fidelity Roth Jo', '2026-03-01',  537200),
  ('Fidelity Roth Jo', '2026-04-01',  657100),
  ('Fidelity Roth Jo', '2026-05-01',  744700),
  ('Fidelity Roth Jo', '2026-06-01',  778300),
  -- Robinhood
  ('Robinhood', '2026-01-01',   2300),
  ('Robinhood', '2026-02-01',   1700),
  ('Robinhood', '2026-03-01',   1700),
  ('Robinhood', '2026-04-01',   1900),
  ('Robinhood', '2026-05-01',   1800),
  ('Robinhood', '2026-06-01',   1500)
) AS v(name, month, balance_cents)
JOIN accounts a
  ON a.household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND a.name = v.name
ON CONFLICT (household_id, month, account_id)
DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();


-- ============================================================
-- STEP 6 — KIDS FUNDING  (account_snapshots)
-- 529 accounts have no January value (blank in screenshot) — skipped for Jan.
-- ============================================================

INSERT INTO account_snapshots (household_id, month, account_id, kind, balance_cents, updated_at)
SELECT
  'fb0f52d2-cd2d-46af-874f-229711ba7b93',
  v.month::date,
  a.id,
  a.kind,
  v.balance_cents,
  now()
FROM (VALUES
  -- 529 Leo (1028) — no January value
  ('529 Leo (1028)', '2026-02-01',  26100),
  ('529 Leo (1028)', '2026-03-01',  49000),
  ('529 Leo (1028)', '2026-04-01',  82600),
  ('529 Leo (1028)', '2026-05-01', 167800),
  ('529 Leo (1028)', '2026-06-01', 189600),
  -- 529 Hannah (4823) — no January value
  ('529 Hannah (4823)', '2026-02-01',  18900),
  ('529 Hannah (4823)', '2026-03-01',  35700),
  ('529 Hannah (4823)', '2026-04-01',  60200),
  ('529 Hannah (4823)', '2026-05-01', 122500),
  ('529 Hannah (4823)', '2026-06-01', 138400),
  -- 529 Ben (4830) — no January value
  ('529 Ben (4830)', '2026-02-01',  13000),
  ('529 Ben (4830)', '2026-03-01',  24400),
  ('529 Ben (4830)', '2026-04-01',  41200),
  ('529 Ben (4830)', '2026-05-01',  83800),
  ('529 Ben (4830)', '2026-06-01',  94700),
  -- UTMA Leo (6231)
  ('UTMA Leo (6231)', '2026-01-01', 420000),
  ('UTMA Leo (6231)', '2026-02-01', 413600),
  ('UTMA Leo (6231)', '2026-03-01', 388400),
  ('UTMA Leo (6231)', '2026-04-01', 429400),
  ('UTMA Leo (6231)', '2026-05-01', 453200),
  ('UTMA Leo (6231)', '2026-06-01', 443900),
  -- UTMA Hannah (8521)
  ('UTMA Hannah (8521)', '2026-01-01', 415000),
  ('UTMA Hannah (8521)', '2026-02-01', 412100),
  ('UTMA Hannah (8521)', '2026-03-01', 387000),
  ('UTMA Hannah (8521)', '2026-04-01', 427900),
  ('UTMA Hannah (8521)', '2026-05-01', 451600),
  ('UTMA Hannah (8521)', '2026-06-01', 442300),
  -- UTMA Ben (name may not have a suffix — verify in /accounts)
  ('UTMA Ben', '2026-01-01', 130000),
  ('UTMA Ben', '2026-02-01', 126900),
  ('UTMA Ben', '2026-03-01', 119100),
  ('UTMA Ben', '2026-04-01', 131700),
  ('UTMA Ben', '2026-05-01', 139000),
  ('UTMA Ben', '2026-06-01', 136200)
) AS v(name, month, balance_cents)
JOIN accounts a
  ON a.household_id = 'fb0f52d2-cd2d-46af-874f-229711ba7b93' AND a.name = v.name
ON CONFLICT (household_id, month, account_id)
DO UPDATE SET balance_cents = EXCLUDED.balance_cents, updated_at = now();
