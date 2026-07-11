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

## Build order & status

1. ✅ **Design system + app shell** — Capitall brand, indigo/amber theme, sidebar,
   placeholder pages. (commit `2c5962a`)
2. ⏭️ **Budget page** — month navigator, collapsible groups (Income/Bills/Expenses/
   Savings/Debt), Planned + Remaining↔Spent toggle, "left to budget" banner, debt
   rows + detail panel. Absorbs the current Settings category editor. **NEXT.**
3. **Transactions panel (the Log)** inside Budget — add txn (date, amount,
   category→subcategory, payee, account, memo) → drives Spent/Remaining.
4. **Accounts page** — types above; balances feed Networth.
5. **Monthly snapshot engine** — archive plan + balances per month.
6. **Networth** — aggregate + over-time + year-by-year.
7. **Annual Overview** — Year tab across months (past/current/projected).
8. **Insights** — the four charts + date filter.
9. **Goals** — light family info.

Later: optional history importer (2024–2026 from the sheet); app view; receipt
scanner.

## Stack & schema notes

- Next.js 16 (App Router, Turbopack) + TS + Tailwind v4 + Supabase. Repo:
  https://github.com/vdiaz2321/budgetfamilyapp
- Schema migrations are numbered SQL in `supabase/migrations/` — apply each new one
  once via Supabase SQL Editor (shared DB). Current: `0001`–`0003`. The snapshot
  engine (step 5) will add a new migration for monthly balance snapshots.
- Existing schema already has households/profiles/categories/subcategories/payees/
  accounts/transactions/budget_plans/debts/savings_goals + views. The current
  `/settings` page (Start-tab mirror) will be reworked into the Budget page.
