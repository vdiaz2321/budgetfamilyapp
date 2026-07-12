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
- **Account types (from Accounts screenshot):** Banking, Cash, Investments/
  Brokerages, Credit Cards.
- **Debt (in Budget):** columns Balance / Planned / Paid so far; click a debt →
  detail panel (paid-of-planned, snowball hint, due date, notes). Paid-off debts
  strike through with a "Hide Paid-Off" toggle. Unified debt list (credit cards
  live here), matching the Start tab.

## Open design item — savings sub-buckets / envelopes (NOT YET BUILT)

Discussed on the PC before the Mac handoff; missed getting written down here, which
is exactly the kind of drift this doc exists to prevent. Captured now so it
survives the next machine switch. Victor is sending Google Sheet screenshots to
clarify further — **do not build until those land and this section is confirmed.**

- **The real-world shape:** Victor consolidated multiple savings goals into ONE
  physical bank account (Amex Savings) to maximize APY, rather than keeping
  separate accounts per goal. But he still tracks each goal as its own
  **virtual envelope / sinking fund** inside that one account balance — e.g.
  Real Estate, Vehicle Purchase, Emergency Fund, Wallet$, each with its own
  running total that should sum to the parent account's actual balance.
- **Budget's Savings category = the planning side, not a balance tracker.** The
  Savings items in Budget represent "how much am I putting into fund X *this
  month*" — a plan/contribution amount. They are NOT meant to show "Spent" the
  way Bills/Expenses/Debt do, because money isn't spent, it's being moved into
  savings (still an asset). **Bug/behavior fix needed:** Budget's Savings group
  currently reuses the same Spent/Remaining language as other groups — it
  shouldn't say "Spent."
- **The gap:** there is currently no feature connecting a Savings budget item to
  (a) a specific envelope/bucket balance that persists and snapshots monthly, or
  (b) the physical account it actually lives in. `savings_goals` (goal/start/
  monthly per subcategory) is the closest existing piece but has no monthly
  history and no link to an account.
- **What's needed once scoped:** likely a new "bucket" or "envelope" concept —
  either sub-rows under an Account (Amex Savings → Real Estate, Vehicle
  Purchase, Emergency Fund, Wallet$, ...) that sum to the account's balance and
  each get their own monthly snapshot row (mirrors his Monthly Net Worth sheet
  screenshot), OR a link from a Budget Savings subcategory to an account (same
  pattern as the debt↔account link in migration `0006`) plus monthly snapshots
  for those subcategories. Needs Victor's screenshots to decide which.
- **Withdrawals matter too:** money can flow out of a bucket (e.g. pulling from
  Emergency Fund), not just in. Whatever gets built must handle both directions
  and keep the account's total balance reconciled with its buckets' sum.

## Open design item — NOT zero-based; rollover months (NOT YET BUILT)

Victor does **not** want a zero-based budget. He needs unspent planned money to
be able to **roll over to the next month** (e.g. saved up for a vacation or
school supplies that land in a later month), rather than the "left to budget"
number just resetting or implying leftover money vanished. He'll send a Google
Sheet screenshot showing how he currently handles this. Needs that screenshot
before scoping — likely touches `budget_plans` (per-month, per-subcategory
already) and possibly needs a rollover/carry-forward calculation or an explicit
"carried over" line, separate from the current month's fresh plan.

## Build order & status

1. ✅ **Design system + app shell** — Capitall brand, indigo/amber theme, sidebar,
   placeholder pages. (commit `2c5962a`)
2. ✅ **Budget page** — month navigator, collapsible groups (Income/Bills/Expenses/
   Savings/Debt), Planned + Remaining↔Spent toggle, "left to budget" banner, debt
   rows + detail panel, per-row progress lines, Summary donut. Absorbed Settings;
   Debt Snowball got its own tab.
3. ✅ **Transactions panel (the Log)** inside Budget — right rail with Summary/
   Transactions toggle, search, add/edit/delete txn modal (5 category tabs) →
   drives Spent/Remaining.
4. ✅ **Accounts page** — Banking / Cash / Investments / Credit Cards with live
   balances + net worth summary (migration `0004`); balances feed Networth.
5. ✅ **Monthly snapshot engine** — `account_snapshots` + `debt_snapshots`
   (migration `0005`), lazily upserted for the *current* month on every balance
   change and Networth visit; prior months freeze automatically. No cron.
6. ✅ **Networth** — current Assets/Debts/Net cards, over-time SVG line chart
   with hover tooltip, year-by-year closing positions + delta, monthly history
   table. Liabilities = credit-card/loan accounts + Budget debts, de-duplicated:
   a Budget debt can link to its account (migration `0006`, "Linked account" in
   the debt panel) and Networth then counts only the debt's balance.
7. ✅ **Annual Overview** — year navigator; 12-month table (Income/Savings/Bills/
   Expenses/Debt/Net): actuals through the current month, planned (projected,
   grayed) beyond; year totals + Income/Outflow/Net cards.
7b. ✅ **Transactions page** — dedicated `/transactions` register (Clear ✓ / Date /
   Payee / Category / Account / Memo / Amount), month picker, search + type +
   account filters, totals row, add/edit via the shared modal. `cleared` column
   (migration `0007`) is a simple checkmark — deliberately NO reconcile flow.
7c. ✅ **Monthly balances grid on Networth** — accounts × months table (the
   MonthlyNetWorth tab): per-account value each month from snapshots, frozen
   history, Net worth row, linked accounts shown but not double-counted.
8. **Insights** — the four charts + date filter.
9. ~~Goals~~ — dropped (Victor: not interested in a Goals tab). Route removed.

Later: optional history importer (2024–2026 from the sheet); app view; receipt
scanner.

## Stack & schema notes

- Next.js 16 (App Router, Turbopack) + TS + Tailwind v4 + Supabase. Repo:
  https://github.com/vdiaz2321/budgetfamilyapp
- Schema migrations are numbered SQL in `supabase/migrations/` — apply each new one
  once via Supabase SQL Editor (shared DB). Current: `0001`–`0007`.
- Existing schema already has households/profiles/categories/subcategories/payees/
  accounts/transactions/budget_plans/debts/savings_goals + views. The current
  `/settings` page (Start-tab mirror) will be reworked into the Budget page.
