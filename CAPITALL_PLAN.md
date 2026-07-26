# Capitall — Build Plan & Status

Working handoff doc so either machine (PC ↔ Mac) can pick up the build. This is
the source of truth for the app's direction; update it as we go.

## What Capitall is

A family budgeting web app (later a mobile app) that mirrors Victor's 3-year
custom Google Sheet, styled after **EveryDollar's clean look** but with our own
palette. North-star (later phase): scan a receipt → auto-fill a transaction where
the user only picks the category. Build order is **webpage first → app view →
receipt scanner**.

**Guiding principle — single source of truth:** enter a debt, savings bucket, or
account once, and every screen (Budget, Networth, Annual Overview, Insights)
references it. No copy/paste between tabs like the spreadsheet forces today.

## Brand & design

- **Name:** Capitall (double-L, intentional).
- **Palette:** Indigo `#4f46e5` primary + Amber `#f59e0b` accent, cool grays.
  Wired as CSS/@theme tokens in `src/app/globals.css` (`--brand`, `--accent`,
  `--surface`, `--muted`, `--positive`, `--negative`), light + dark. Use Tailwind
  `indigo-*` / `amber-*` or the `brand`/`accent`/`surface`/`muted` utilities.
- **Look:** EveryDollar-style — white cards, generous spacing, collapsible group
  headers, Planned / Remaining columns. Do NOT copy EveryDollar's green.

## Sidebar (renamed from EveryDollar's) → what each mirrors

| Nav item | Mirrors | Purpose |
|---|---|---|
| **Budget** (home) | Start tab (cleaner) + the Log | Plan categories by month; Planned vs Spent; "left to budget"; transactions panel lives here. |
| **Accounts** | — | Bank/cash/credit/investment accounts + balances that feed Networth. |
| **Networth** (was Roadmap) | Log-tab linking role | Real net worth from accounts/debts/savings/investments; over-time + year-by-year. |
| **Annual Overview** (was Paycheck Planning) | Year tab | Whole picture across months: past, current, projected. |
| **Goals** | Family Goals tab (trimmed) | Family/children: names, ages, grades, expected HS/college grad, places lived / want to live. |
| **Insights** | MonthlyNetWorth + NetWorth tabs | Spending totals (pie), spending over time, income trend, income vs spent; date-range filter. |

Settings + Sign out live in the sidebar footer. Out of scope (separate Financial
Planner project): Calendar, Family Goals detail, Retirement Pay Proj, Career Span,
Networth Proj. Networth/Annual Overview should be built so they *could* connect to
that retirement planner later.

## Key decisions (confirmed by Victor)

- **Auth:** email + password (Supabase `signInWithPassword` / `signUp`). No magic
  link / OTP (Supabase free tier locks the email template, and links opened in the
  wrong browser). Disable "Confirm email" OR create users with "Auto Confirm" in
  the dashboard.
- **Budget style:** planned vs actual, **with** a "left to budget" number shown for
  reference — NOT forced to zero.
- **Time is first-class:** each month archives planned amounts + account balances as
  **monthly snapshots**, so history accrues from month one and powers a
  Year-by-Year Net Worth view (the YearlyNetWorth tab). Nothing re-entered.
- **Account types:** Banking (Checking / Savings / Money Market), Cash,
  Investments/Brokerages, Credit Card, Loan (Auto / Student / Personal / Mortgage /
  Other). Each type maps to a **class** — Asset or Liability — which is what drives
  the Net Worth sign AND auto-routes liabilities into the debt snowball. No manual
  "is this debt?" button; the type decides. (Optional per-account "Include in debt
  payoff" opt-out for cards paid in full.)
- **Balance source (confirmed):** **auto-derive**, not manual monthly typing.
  Checking / Cash / Credit Card balances = `starting balance + every inflow − every
  outflow assigned to the account` (a card's balance = charges − payments). This is
  reliable in a DB (unlike cross-tab spreadsheet formulas, which is why the sheet
  and commercial apps failed him) and is the big time-saver. **Investments &
  savings buckets stay manual** — they move with the market, not the Log. Requires
  logging **income** too (inflows), which also auto-fills the Income "Actual" on
  Budget / Annual Overview.
- **Owner / people tagging:** each account carries an **owner** from a
  **user-managed people list** — NO hardcoded family names. Ships empty; you add
  people (yourself, spouse, kids, or friends if shared) from the Accounts page.
  Owner ≠ household generates the "Family Accounts" / "Family Investments"
  subtotals from one field. Keep it generic so the app is shareable.
- **Debt (in Budget):** columns Balance / Planned / Paid so far; click a debt →
  detail panel with **Current Balance, Minimum Payment, Interest Rate, Original
  Balance**, and a computed **projected payoff date** + months-to-zero + "paid of
  original" (mirrors EveryDollar's "Update balance" panel; payoff month is encoded
  in your debt names today, e.g. `QuickSil7906V (Dec24)`). Paid-off debts strike
  through with a "Hide Paid-Off" toggle. Unified debt list (credit cards + loans
  live here); the debt record lives on the **account** (single source), the Budget
  row and Networth liabilities both reference it.
- **Refunds & transfers are first-class transaction types** (not band-aid rows). A
  refund/return = an inflow on the same category/account; a transfer moves money
  between two accounts. Both adjust balances + net worth for the correct month
  automatically. (This replaces the old sheet hack of `Fidelity/Crypto/TSP debt`
  patch lines, which are being dropped.)
- **No "Average" columns anywhere.** Victor: vacation/travel spikes skew averages
  and make them useless. Totals only.

## Accounts model (the object that makes it single-source)

Every account carries four attributes; those four reproduce the entire Net Worth
tab automatically:

1. **Type** → Banking / Cash / Savings bucket / Investment / Credit Card / Loan
2. **Class** (auto from type) → Asset or Liability → Net Worth sign + debt routing
3. **Owner** → from the user-managed people list (household by default)
4. **Balance source** → transaction-derived (Checking / Cash / Credit Card) or
   manual monthly value (Investments / Savings buckets)

Extras on the record: starting balance + date (for derived accounts), APY %
(savings), interest ledger (see APY below), debt fields (balance / min payment /
APR / original / payoff), "include in debt payoff" opt-out.

**Savings buckets:** modeled as **named buckets *inside* one account**, not
separate accounts — mirrors Victor's single **American Express Savings** account
split into buckets (Real Estate, Vehicle Purchase, Emergency Fund, Wallet$, AMEX
Extra) to track available funds and chase APY. One account row on Accounts; the
buckets live in a detail drawer and sum to the account balance.

## Shared "parent row + detail drawer" pattern

One reusable component powers **three** places, so the Budget page stays clean and
depth lives in a right-side drawer (like the debt detail panel already built):

- **Debts** → drawer shows payoff math (above).
- **Subscriptions** (Bills → one row) → drawer lists each subscription: name,
  amount, due date, **Active/Cancelled toggle** (cancelled ones strike through and
  drop from the total), and a "$X/mo across N active subs" summary for cancel
  decisions. Amount supports a **"Fixed" toggle** (auto-fills each active month) +
  **billing cadence incl. annual**, and **cancel-on-a-date** that removes all
  future fixed charges.
- **Irregular Bills** (Bills → one row) → same drawer, but **per-month entry**
  (Car Cleaning, Eye Care, Video Games, Vehicle Registration, Benz, etc.) since
  amounts vary and aren't monthly. Optional due-day → calendar (the sheet's purple
  box).

Parent row Planned/Spent = sum of that month's active children. Cancel/return
once → it drops from Budget, Bills total, Annual Overview, and Cash Flow.

## Networth page (mirrors Net Worth 2026 + MonthlyNetWorth)

A grouped roll-up of the same accounts — nothing re-entered:

- Asset groups: **Bank Accounts, Cash, Savings buckets, Investments/Brokerages**,
  plus **Family** subtotals (owner ≠ household) for accounts & investments.
- Liabilities: credit cards + loans.
- **Total Assets − Total Liabilities = Total Net Worth**, plus **Change (+/−)**,
  **Change %**, **NW w/out Invest**, and a **Growth** column, laid out month by
  month (Jan→Dec) with year-by-year history.
- The monthly snapshot engine archives these totals each month → powers the
  **MonthlyNetWorth analytics** (M2M diff, Monthly %, YTD %, Debt Incurred, Actual
  NW, Debt Ratio). *Analytics layer deferred to the Networth build step; data model
  reserves room now.*

## Annual Overview page (mirrors Year tab) — 100% derived

No new data entry — pure roll-up of Budget transactions + planned amounts:

- **Annual Dashboard:** 5 charts (Income / Savings / Bills / Expenses / Debt) +
  Planned-vs-Actual summary cards with monthly rows + TOTAL (no Average).
- **Budget vs Actual + Cash Flow month-by-month** with a **LEFT** row (net cash
  flow per month), Total column.
- **Income / Savings / Bills / Expenses** full subcategory grids, Planned vs
  Actual, month by month, Total.
- Income subcategories are distinct from spending: Military Pay, Military Pay
  Deduc., Juice Plus Pay, **Savings APY**, COLA, VAT Reimbursement, Income Taxes,
  TDY, PCS, (person) Income, Sold Items, Side Income, CC Redeem Cashback, Farewell
  Gift, Debt Income.

## APY Yields (deferred build, model now)

Per savings/bank account **interest ledger**: monthly rows (date, month #, interest
earned, running end balance, APY %). Victor enters manually today; attaching it to
the account means it can later auto-feed the account balance + Net Worth growth
and the "Savings APY" income line — instead of being an island. Full page deferred
to Networth/Insights step.

## Deferred — DO NOT FORGET

- **Invest Accrued** (estimate-vs-actual): per investment, January **~Contribute**
  (estimated) vs **Contribute** (actual) + **Int Accrued**, across years, graded at
  year end. Actual is derivable from Savings-category transactions tagged to each
  investment; estimate is a number set each January. Build with the Networth/
  Insights analytics.
- **Retirement planner bridge:** Victor built a separate financial/retirement
  planner (Cloudflare-hosted, another chat). Networth + Annual Overview are being
  built so they *could* hand off to it later (API pull / shared Supabase table /
  export-import — TBD when he shares the link).

## Savings sub-buckets / envelopes (BUILT — migrations 0008/0011/0019)

The virtual envelope concept above was built as **buckets nested under an
account**. Model: one row in `accounts` (e.g. Amex Savings) with N rows in
`buckets` (`account_id` FK, `name`, `balance_cents`). The parent account's
`current_balance_cents` is always the sum of its buckets via
`syncAccountFromBuckets` — never a separate source of truth. Budget savings
subcategories can link to a specific bucket via `subcategories.linked_bucket_id`
(migration 0011); contributions/withdrawals logged on that subcategory
auto-adjust the bucket's balance via `adjustBucketBalance`.

- Withdrawals: `transactions.is_withdrawal` flips the sign.
- Snapshots per bucket: `bucket_snapshots` table (migration 0008), captured
  monthly by `captureSnapshots`.
- Banking group tag: `bank_group` on buckets (`savings` / `spending`, migration
  0019) so Amex Savings can carry both sinking-fund buckets and spending buckets
  side by side.

**Extended to investment accounts (2026-07-26, migration 0027):** the same
bucket model now backs investment sub-accounts too (Fidelity → Roth IRA Vic /
Roth IRA Jo / Taxable Vic; Crypto → Tangem / Kraken / River / Robinhood). The
Invest page renders one row per account with an expand chevron that reveals
bucket rows, each with editable Contrib/Gains/Current cells. The transaction
modal shows a Bucket picker whenever the selected account is `kind='investment'`
and has ≥1 bucket; picking one writes `transactions.bucket_id` (new column),
and `adjustBucketBalance` handles the balance side-effect.

## Rollover months (BUILT — migration 0015)

Per-subcategory monthly rollover was built: unspent planned money carries
forward into the next month's "left to budget" instead of resetting. Rollover
inflow is displayed on the Budget hero as a separate `RolloverBar` and folded
into the waterfall (own income spent first, then rolled-in buffer). Toggleable
per household. Delivered in migration 0015.

## Credit Cards / Rewards Tracker (BUILT — migrations 0024/0025/0026)

Full rewards tracker to replace Victor's rewards Google Sheet:

- **`credit_card_details` table** (0025): 1:1 with `accounts.kind='credit_card'`,
  holds bank, auth user, charging, bonus info + spend/deadline + earned flag,
  current points, fees paid, free-night credit + expiration, spending limit,
  remarks, revolving flag, linked-debt subcategory.
- **Free-night points-limit fields** (0026): `free_night_points_limit` +
  `benefit_used_on` for hotel-brand cards with per-year points caps.
- **Auto-computed "Owed"** per card = sum(charges where paid_to_account_id IS
  NULL) − sum(payments to that card). No manual owed number.
- **`transactions.paid_to_account_id`** (0025) represents a one-row CC payment
  that both debits the source bank AND credits the CC's owed tally.
- **Pay Card modal** on Accounts (source account + optional bucket picker,
  writes the paid_to_account_id transaction and calls adjustBucketBalance /
  adjustAccountLedger on the source).
- **Pay-in-full vs revolving distinction**: pay-in-full cards (most) never
  create a debt entry; revolving cards can opt in and link to a debt
  subcategory, so 0% APR promotional balances get tracked as actual debt.
- **Expandable row layout** on Accounts, grouped by holder (Vic / Johana) with
  per-holder counts and totals, three sub-sections (active / closed / archived).

## Investment performance / Year-by-Year (BUILT — migrations 0020/0021/0022/0027)

- **`investment_years` table** (0020) — one row per (household, account, [bucket],
  year), holding contributed / accrued / start / end (start/end added in 0021).
  Seeded from Victor's 3-year CSV.
- **`v_investment_contributions` view** (0020, extended 0027) — sums transactions
  keyed by (account, bucket, year), so live contributions flow into Contrib
  automatically.
- **Current-year additive rule** (0027) — for the current year, Contrib =
  seed + live transactions. Historical years stay frozen at their reviewed
  values, so back-dating a transaction can't double-count against a past year.
- **Bucket nesting on Invest page** (0027) — Fidelity/Crypto expand to their
  bucket rows (Vic Taxable, Roth Vic, Roth Jo / Tangem, Kraken, River,
  Robinhood). Each bucket cell is editable and saves via `setInvestmentYear`
  (extended to accept optional bucketId).
- **Annual Overview year-over-year breakdown** (0022) — 12-month grid rebuilt
  as `annual_overview` with per-cell overrides for years missing raw
  transactions.
- **Chart & UI polish** — hero total-return card, stats bar (Contributed /
  Unrealized Gains / Current / Accounts), Stacked / Grouped / % Return toggle,
  click-to-filter chart, teal accent for gains (not green — reserved for
  positive-cash Net Worth semantics).

## Ledger reconcile (BUILT 2026-07-26)

`recalculateBalance` server action + ↻ button next to the balance field on
every non-bucketed, non-investment asset account on the Accounts page. Rebuilds
`current_balance_cents` from the sum of every transaction's ledger delta
(income adds, everything else subtracts), assuming a $0 starting balance.
Fixes ledger drift when a manual balance edit or transient error caused the
running total to diverge from the transaction log. Manual balance edits still
win — reconcile is opt-in and confirms before overwriting.

## Deferred / open

- **Insights page** (four charts + date filter) — schema is ready; page not
  built yet.
- **Debt refactor** — Victor's rule: debts live only in Budget; the Accounts
  page should stop offering debt entry. Refactor tracked in memory
  `debt_single_source_budget.md`, not yet applied.
- **CSV import for Jan–Jul 2026 subcategory totals** — Victor is preparing the
  file from Google Sheets; build the upload tool when it arrives (memory
  `project_2026_csv_import.md`).
- **Retirement-planner bridge** — deferred until Victor shares the external
  Cloudflare-hosted planner.
- **Receipt scanner** — north-star feature, later phase.

## Build order & status

1. ✅ **Design system + app shell** — Capitall brand, indigo/amber theme,
   sidebar, placeholder pages.
2. ✅ **Budget page** — month navigator, collapsible groups, Planned + Remaining
   ↔ Spent toggle, hero "left to budget" summary card, debt rows + detail panel,
   per-row sparklines, category icons, rollover bar, sticky footer.
3. ✅ **Transactions panel (the Log)** inside Budget — right rail Summary /
   Transactions toggle, search, add/edit/delete modal (5 category tabs, tab-
   aware "charged to / paid from" label, bucket picker for investment accounts).
4. ✅ **Accounts page** — Banking / Cash / Investments / Credit Cards with live
   balances, bucketed accounts, Savings/Spending tag, drag reorder, closed &
   archived sections, ledger reconcile ↻ button.
5. ✅ **Monthly snapshot engine** — `account_snapshots`, `debt_snapshots`,
   `bucket_snapshots`, lazily upserted; prior months freeze automatically.
6. ✅ **Networth** — Assets / Debts / Net hero, SVG line chart with hover
   tooltip, editable per-month grid, year-by-year closing positions + delta,
   monthly balances table, sessionStorage collapse persistence.
7. ✅ **Annual Overview** — year navigator; 12-month table; year totals; per-
   cell override backfill for pre-import years.
8. ✅ **Transactions page** — dedicated `/transactions` register; `cleared`
   checkmark; month + type + account filters; bulk delete.
9. ✅ **Monthly balances grid on Networth** — accounts × months table.
10. ✅ **Debt Snowball** — dedicated `/snowball` page with focus subcategory,
    extra-per-period modeling, paid-off flag, historical debt tracking.
11. ✅ **Savings page redesign** — hero total, connected stats bar, full-ring
    goal cards, condensed details.
12. ✅ **Invest page** — hero Total Return, summary stats bar, Performance
    chart (Stacked / Grouped / % Return), PerfTable with bucket expansion,
    Year-by-Year drawer, additive current-year transaction rule.
13. ✅ **Credit Cards / Rewards Tracker** — full rewards fields on
    `credit_card_details`, auto-owed, Pay Card modal, holder groups.
14. ⏳ **Insights** — four charts + date filter (deferred).
15. ~~Goals~~ — dropped.

Later: history importer (Jan–Jul 2026 CSV upload); app view; receipt scanner;
retirement-planner bridge.

## Stack & schema notes

- Next.js 16 (App Router, Turbopack) + TS + Tailwind v4 + Supabase. Repo:
  https://github.com/vdiaz2321/budgetfamilyapp
- Schema migrations are numbered SQL in `supabase/migrations/` — apply each new
  one once via Supabase SQL Editor (shared DB). **Victor applies all migrations
  himself** — Claude never calls `apply_migration` or executes DDL via
  `execute_sql`; only read-only SELECT queries are permitted via MCP.
- Current migrations: **`0001`–`0027`**.

### Migration index

| # | Purpose |
|---|---|
| 0001 | Initial schema (households, profiles, categories, subcategories, payees, accounts, transactions, budget_plans, debts, savings_goals + views) |
| 0002 | Start-tab schema |
| 0003 | `create_household` RPC |
| 0004 | Accounts page tables/views |
| 0005 | Monthly snapshots (account_snapshots, debt_snapshots) |
| 0006 | Debt → account link |
| 0007 | `transactions.cleared` |
| 0008 | Savings buckets + `bucket_snapshots` |
| 0009 | Debt extras (APR promo, notes, etc.) |
| 0010 | Snowball extra periods |
| 0011 | `subcategories.linked_bucket_id`, `transactions.is_withdrawal` |
| 0012 | `savings_goals.target_date` |
| 0013 | Household invites |
| 0014 | `accounts.subtype`, networth include flag |
| 0015 | Budget rollover |
| 0016 | Networth history (`bank_group` + `networth_history`) |
| 0017 | `accounts.sort_order` |
| 0018 | `debts.paid_off_at` |
| 0019 | `buckets.bank_group` |
| 0020 | Investment performance (`investment_years`, `v_investment_contributions`) |
| 0021 | `investment_years.start_cents`/`end_cents` |
| 0022 | Annual overview history |
| 0023 | Subscriptions |
| 0024 | Credit card fields + subscription `account_id` |
| 0025 | `credit_card_details` + `transactions.paid_to_account_id` |
| 0026 | `free_night_points_limit` + `benefit_used_on` |
| 0027 | Bucket-level investing (`investment_years.bucket_id`, `transactions.bucket_id`, view update) |
