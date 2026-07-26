# Capitall Verification Plan

This is the minimum regression checklist for changes to the budgeting and
accounting flows. It focuses on the financial invariants that must remain true
while the app replaces the Google Sheets workflow.

## Before each handoff

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Test with a non-production household or safe test records.
- Never apply database migrations from this workspace; Victor applies reviewed
  SQL manually in Supabase.

## Transactions and balances

- Add income to checking; verify account balance, Budget income actual, and
  Annual Overview income actual increase once.
- Add an expense; verify the account balance decreases and the matching Budget
  actual increases.
- Edit amount/date/account/category/memo; verify the old ledger effect is
  replaced rather than duplicated.
- Delete a transaction; verify every affected total reverses.
- Add a refund/inflow and verify it offsets the correct account/category.
- Add a transfer and verify source and destination move together without
  inflating household net worth.
- Run Accounts ledger reconcile and verify it reproduces the transaction-derived
  balance without changing transaction rows.

## Credit-card payments

- Charge a rewards card and verify its owed amount increases.
- Pay it from the intended checking/banking account; verify the source account
  decreases, card owed decreases, and the payment is not new income or spending.
- Pay from a bucketed bank account and verify the selected bucket decreases.
- Verify rewards fields remain independent from Budget debt payoff rows.

## Rollover

- Plan more than actual spending and verify the eligible remainder rolls into
  the next month.
- Verify rollover is separate and is not treated as new income.
- Disable rollover and verify future carry-forward stops without rewriting past
  months.

## Buckets

- Create a savings bucket and verify the parent account equals the bucket sum.
- Edit a bucket balance and verify the parent account syncs.
- Add a linked contribution/withdrawal and verify the sign, bucket balance,
  parent account, and snapshot agree.
- Verify investment buckets contribute to the correct account/year only.
- Verify an account without buckets still uses its normal ledger.

## Debt and net worth

- Create a Budget debt with balance, minimum payment, APR, and original balance.
- Verify minimum and extra payments affect the Budget snowball while the debt
  remains the single payoff record.
- Link a debt to an account and verify Net Worth does not count the liability
  twice.
- Mark it paid off and verify Budget visibility changes while history remains.
- Verify prior monthly snapshots freeze and only the current month updates.
- Verify Net Worth equals assets minus liabilities and transfers do not create
  artificial net-worth growth.

## Spreadsheet reconciliation spot-check

Use the exports as reference only, not as a second source of truth:

- Rewards export: card names, bank, owner/auth user, charging assignments,
  points, annual fees, benefits, spending limits, and booking notes.
- Budget/debt export: debt name, minimum payment, extra payment, paid/left,
  balance, interest, payment schedule, and payoff progression.

When a mismatch is found, identify whether it is an input, transaction, derived
balance, or historical snapshot before changing code or data.
