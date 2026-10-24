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
- Accounts — Transfer Funds, Withdraw, Make Card Payment, + Transaction and
  Balance Transfer (save + Undo from the Debt page) tested and working.
  - "Pay which card?" list staying open: could not reproduce (2026-10-24,
    phone + desktop, real clicks) — the phone's card rows under the Pay form
    look like the list. No change made.
  - + Transaction's account picker showed stale owed figures: it now
    refreshes its lists every time the form opens.

- Debt/Loans (2026-10-24) — totals tie to Accounts; both 0% promos clear
  before they end. Fixed: Make Card Payment can now pay a balance transfer
  on that card (migration `20261024130000`); "Pay which card?" shows debts
  and transfers; Pay form no longer prefills a plan already paid; promo APR
  shows 0% instead of a dash. Tested live with $1 entries (transfer, pay,
  edit, remove, undo) — all back to the baseline.
  - Merged the old sheet item "Venture1 1163V(Feb27)" into "1163 Venture V"
    (Victor's OK, 2026-10-24): its Mar–Jul payments, plans and balances
    moved over, then the old item was deleted. Fixed July 2026 debt counted
    twice ($937) and August's Debt plan counted twice ($135).

- Budget (2026-10-24) — every total ties to the database, Annual, Net
  Worth, Accounts and Debt. Tested live with $1 entries (bill,
  subscription, irregular bill, debt payment, savings, income; add, edit,
  delete) plus plan edit and Roll in / Undo — all back to the baseline.
  Fixed: moving an item to another group now moves its transactions'
  group too; 63 Taxes/Insurance rows still labeled "Bills" corrected.
  - UI ideas Victor approved and built (2026-10-24): picking a
    subscription as payee fills its amount (only into an empty box); the
    Budget Item picker lists Expenses, Bills, Debt, then Invest/Savings;
    the save button names the picked item's kind ("Add Bill", "Add
    Savings"). The pickers' search boxes already focus on desktop — no
    change needed there.
  - Watch-out: a charge on a card carried as a payoff debt (VentureJ,
    Venture V) shows nowhere as owed — card owed is held at $0 and the
    debt doesn't grow. No such charges since July.

- Transactions (2026-10-24) — count and Received / Spent / Net match the
  database, Budget and Annual (month and a custom date range). Search,
  column filters, Uncleared, Select total, Cleared tick and a $1 + $1
  split (add, clear, delete) tested — back to the baseline. No data bugs.
  - UI ideas Victor approved and built (2026-10-24): column-filter search
    keeps only the matches in one click or Enter; every transaction ✕
    (Transactions table, Budget side list, item panel) now asks "Delete?"
    / "Delete both?" first (`components/confirm-delete-button.tsx`); split
    rows show "Split of $X" (phone and Budget side list: "split of $X").
  - Oct 14 Military Pay $4,717.99 is the only October row not ticked
    Cleared.

- Travel Log (in progress, paused 2026-10-24) — checked so far, all tie
  out: Total CC Owed = Accounts; upcoming trips' Spent / Planned add up;
  points totals (hotel 1,100,810 + travel 635,457 = 1,736,267); trip
  spending plans reach Budget in the trip's start month (unpaid estimates
  and pay-at-hotel rooms included, paid bookings not). Tested live and
  undone: a $1 Restaurant Travel entry tagged to Malaga (trip Spent +1,
  Budget +1) and +1 Sapphire point via the Rewards Activity Log.
  - **Ask Victor:** Premier Inn Darmstadt (Wiesbaden trip, Nov 7, €69.58 /
    $78.11 on Sapphire, reserved Oct 21) shows as paid but has no
    transaction — not in Budget, Sapphire owed or Net Worth. Log it?
  - FYI: older bookings from the sheet (e.g. Barcelona's $295.27 Vueling,
    paid Jan 28) aren't linked to their payments. Totals are still right
    (no double count); linking is optional housekeeping.
  - Trip "Wiesbaden · 2027" is dated Nov 7–8, 2026 — name may be a typo.

## Next — start here

When Victor says "pick up where we left off", start here.

0. **Victor's answer on Premier Inn Darmstadt** (see Travel Log above): if
   he says log it, add the €69.58 / $78.11 Sapphire charge linked to that
   stay (Traveling/Trips, Wiesbaden trip), then check Sapphire owed, Budget
   October and Net Worth move by $78.11.
1. **Finish Travel Log: points-booking test Victor asked for.** Add Trip →
   name "TEST trip", Dec 1–2 2026 → Stay: "TEST Hotel", reserved
   2026-10-24, check-in 2026-12-01, 1 night, card 4569 IHG Rewards V,
   Pts if used 1000, Hotel cost 100, tick "Pts used", remarks TEST → Save.
   Expect: IHG Rewards V 222,190 → 221,190; Current Pts 1,736,267 →
   1,735,267; a booking entry in the card's Rewards Activity Log; stay in
   Stays History / Points-Value Historical (pts used 1,500,934, cash saved
   $15,536 before); no transaction, no change to Budget, owed, Net Worth.
   Then delete the stay and the TEST trip and confirm all of it is back
   (stays 85, trips 30, activities 13, transactions 1,627).
2. Then Travel Log's other actions (cancel / restore a stay, Pay Card from
   a card row) and its UI ideas, then Insights.

## Left alone on purpose

Victor declined these — don't raise them again:

- Backfilling 2024–2025 Roth contributions into the Invest page's yearly
  records (Net Worth shows 2025 Contributed $13,757 vs Annual's $22,588).
- Moving Net Worth's Current NW / Proj EOY NW columns next to Spouse Age.

## Don't delete

- The July 1, 2026 $457 Fundrise → USAA withdrawal is a record only (the
  balances already reflected it). Deleting it would put $457 back on
  Fundrise. Edit it instead if the date or bank is wrong.
