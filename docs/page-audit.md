# Page-by-page audit

Started 2026-10-24 (last commit of that session: `d7b31b1`). For each page:
check its numbers match the other pages, fix bugs, review the design (easy
to read, scan and filter — see AGENTS.md rules), and actually test the
actions. Test entries are $1 with a "TEST" note, deleted afterwards, and the
balances checked to be back exactly. Reports go to Victor's phone: short,
numbered, plain words.

## Done

- Annual Overview
- Net Worth
- Invest / Savings
- Accounts — Transfer Funds, Withdraw, Make Card Payment and + Transaction
  tested and working

## Next — start here

1. **Accounts bug:** Make Card Payment → pick a card → the "Pay which card?"
   list stays open behind the Pay form, and closing the form leaves it
   showing. `PickCardModal` in `src/app/(app)/accounts/accounts-board.tsx`
   (around line 1530) — its `onPick` calls `setPickingCard(false)`, yet the
   list stays. Not yet diagnosed.
2. **Accounts:** the + Transaction account picker showed a card's owed
   amount from before a payment just made (stale list).
3. **Accounts:** Balance Transfer not yet tested.
4. Then audit: Budget, Transactions, Debt/Loans, Travel Log, Insights.

## Left alone on purpose

Victor declined these — don't raise them again:

- Backfilling 2024–2025 Roth contributions into the Invest page's yearly
  records (Net Worth shows 2025 Contributed $13,757 vs Annual's $22,588).
- Moving Net Worth's Current NW / Proj EOY NW columns next to Spouse Age.

## Don't delete

- The July 1, 2026 $457 Fundrise → USAA withdrawal is a record only (the
  balances already reflected it). Deleting it would put $457 back on
  Fundrise. Edit it instead if the date or bank is wrong.
