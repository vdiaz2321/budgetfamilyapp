-- One-time backfill of the Net Worth chart/table history (2026-07-19).
-- Household: fb0f52d2-cd2d-46af-874f-229711ba7b93
--
-- Source: 4 CSV exports of the "Net Worth Yearly Breakdown" Google Sheet
-- (2023, 2024, 2025, 2026 tabs). Each tab's ASSETS MONTH BY MONTH section has
-- pre-computed rollup rows — "Savings", "Bank Accounts", "Stocks/Investments"
-- (assets) and "Total Liabilities" (debt) — that map 1:1 to this table's
-- savings_cents / bank_cents / stocks_cents / debt_cents columns. Every
-- month below was cross-checked against the sheet's own "Total Assets" row
-- (Savings + Bank Accounts + Stocks/Investments) before being included here.
--
-- Only "type"-level totals are seeded, not individual accounts/line-items —
-- deliberately: the Net Worth page treats any month that has per-account
-- account_snapshots rows as fully "live" and ignores this table for that
-- month entirely. Seeding only some accounts for a historical month (instead
-- of all of them) would silently zero out the categories not backfilled and
-- corrupt the chart. This table is the correct, safe home for all of it.
--
-- 2026 stops at June — July 2026 onward is already live, captured directly
-- by the app itself (account_snapshots + debt_snapshots).

insert into networth_history (household_id, month, savings_cents, bank_cents, stocks_cents, debt_cents)
values
  -- 2023
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-01-01', 11197122, 1225145, 6462816, 3356156),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-02-01', 11497500,  873400, 6730244, 3462100),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-03-01', 11636200, 1261200, 6834544, 3220100),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-04-01', 11767800, 1192000, 6944244, 3066700),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-05-01', 11888800, 1202200, 7158944, 2124900),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-06-01', 12009800, 1462900, 7572309, 1941660),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-07-01', 12094100, 1478300, 7813744, 1872736),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-08-01', 12244000, 1522300, 7842440, 1735600),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-09-01', 12354600, 1562300, 7459840, 1610700),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-10-01', 12611800, 1430700, 7109040, 1490700),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-11-01', 12665400, 1382700, 7910340, 1433800),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2023-12-01', 12874200, 1471600, 8310240, 1335100),
  -- 2024
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-01-01', 14669700,  298100, 8088800, 1704900),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-02-01', 14832400,  337600, 8495000, 1668900),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-03-01', 15099200,  346600, 8832100, 1558500),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-04-01', 15697400,  335000, 8587500, 1486000),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-05-01', 15659200,  334300, 8920200, 1432600),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-06-01', 15359000,  333500, 9246100, 1459200),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-07-01', 16116300,  311700, 9319600, 1475000),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-08-01', 16307700,  302200, 9663400, 1652600),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-09-01', 16509700,  257400, 10041300, 1531800),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-10-01', 16565300,  273400, 10270700, 1570000),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-11-01', 16393100,  274200, 10843200, 1433100),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2024-12-01', 16451500,  219000, 11044800, 1519000),
  -- 2025
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-01-01', 16370000,  218500, 11468100, 1262400),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-02-01', 16370000,  218700, 11197300, 1306457),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-03-01', 16370000,  219400, 10902100, 1361200),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-04-01', 16370000,  219800, 10765700, 1271700),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-05-01', 16370000,  220200, 11672500, 1113300),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-06-01', 16370000,  220600, 12338300, 949053),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-07-01', 16224000,  221100, 12993100, 788427),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-08-01', 16224000,  221100, 13225700, 633200),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-09-01', 16100000,  272300, 13807544, 682786),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-10-01', 16100000,  281000, 14219100, 588400),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-11-01', 16700000,  286800, 14430000, 743800),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2025-12-01', 16700000,  257900, 14650800, 799100),
  -- 2026 (Jan–Jun only; Jul+ is live)
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-01-01', 16870000,  258400, 15035400, 994300),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-02-01', 16880000,  261800, 14920700, 891600),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-03-01', 17277200,  263200, 14241400, 893200),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-04-01', 17030000,  273700, 15912800, 662200),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-05-01', 17150000,  272000, 16925700, 551700),
  ('fb0f52d2-cd2d-46af-874f-229711ba7b93', '2026-06-01', 17120000,  259000, 16483200, 440400)
on conflict (household_id, month) do update
set savings_cents = excluded.savings_cents,
    bank_cents = excluded.bank_cents,
    stocks_cents = excluded.stocks_cents,
    debt_cents = excluded.debt_cents,
    updated_at = now();
