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
  - Premier Inn Darmstadt (Wiesbaden, Nov 7) had a typed Spent of $78.11
    and no transaction. Logged it (Victor's OK, 2026-10-24) with the new
    button below: Sapphire owed $550.14 → $628.25, October Traveling/Trips
    $1,675.15 → $1,753.26. Net Worth doesn't move — card owed stays out of
    it by design.
  - Built (Victor asked, 2026-10-24): a booking's Spent $ now comes only
    from linked transactions (sheet imports and bookings made before
    2026-07-15 keep their typed figures — `travel/payment-due.ts`). Each
    booking form has "Save & add transaction" (opens the transaction form
    filled in from the booking); the Add Trip popup lists booked items to
    pay after it saves; the Bookings Log flags "No transaction". Tested
    with a TEST trip (stay + rental), deleted after — counts back exactly.
  - Points-booking test passed (2026-10-24): TEST trip + TEST Hotel, IHG
    Rewards V, 1,000 pts used, hotel cost $100. IHG 222,190 → 221,190,
    Current Pts −1,000, "Stay booked" entry in the Rewards log (no Delete),
    Stays History / Points-Value +1,000 pts and +$100 saved; no
    transaction, no "No transaction" flag, no Budget plan, owed unchanged;
    the card's free-night dates untouched. Deleted through the app — all
    back to 85 stays, 30 trips, 13 activities, 1,629 transactions.
  - Other actions tested (2026-10-24), all undone after: cancel / restore
    a points stay (points back, then off again), cancel / restore a stay
    paid by a $1 transaction (payment kept while cancelled), Pay Card $1
    USAA → Sapphire and its delete. Fixed:
    - Saving an edit to a cancelled stay took its points off the card
      again (restore would then take them twice). A cancelled stay now
      draws nothing until restored. No real stay was hit (Miramar's
      +35,300 refund predates its cancel and it's a sheet import).
    - Cancel / restore wiped a paid booking's "before payment" snapshot,
      so deleting the payment afterwards left its amount as Spent with no
      transaction. Kept now while payments are linked (stays, flights,
      rentals).
    - A stay with no hotel cost counted its whole payment as negative
      savings (Premier Inn −$78): a blank hotel cost now means "cost what
      was paid". Hotels Log / Stays History cash saved $5,379 → $5,457.
    - Pay Card's line under the amount said "Full balance" whatever was
      typed; it now says what the payment leaves owed.
  - UI ideas Victor approved and built (2026-10-24): Stays History's
    header shows Most stays / Most saved instead of repeating the Hotels
    Log's totals; payoff-debt cards (Ventures) are one slim line;
    "Save & add transaction" hidden on points / free-night stays (and
    all-points flights, points rentals). Also fixed: trip cards cut off
    "PLANNED $4,009" at laptop width.
  - FYI: older bookings from the sheet (e.g. Barcelona's $295.27 Vueling,
    paid Jan 28) aren't linked to their payments. Totals are still right
    (no double count); linking is optional housekeeping.
  - Trip "Wiesbaden · 2027" is dated Nov 7–8, 2026 — name may be a typo.

- Insights (2026-10-24) — October, September, Q3 and 2026 all tie to
  the database, Transactions and Annual Overview (income, bills + taxes +
  insurance, expenses, debt). Period picker, bar clicks tested. Fixed:
  - Savings counted the kids' 529 deposits ($5,220 in 2026) — now its own
    "Kids funding" line in Total outflow, as on Annual; Savings 2026
    $23,420.38 → $18,200.38 (= Annual's Invest/Savings).
  - Top merchants counted each part of a split purchase (Commissary "27
    transactions" → 13 purchases, Kaufland 10 → 6); Largest purchases
    listed a split's biggest part instead of the whole (Kaufland Sep 18
    $183 → $196.74 "Groceries + 1 more").
  - Change colours in both tables now follow the cards: less Savings is
    red, more is green (it was the other way round).
  - **Ask Victor:** three splits look like the amounts went on the wrong
    items — Commissary Sep 20 (Sales Tax $104.08 / Groceries $7.30),
    Commissary Aug 12 (both parts Sales Tax, $27.65 + $1.38), Tran soan
    Aug 29 (Sales Tax $27.12 / Groceries $2.03). Fix them?
  - **Ideas waiting on Victor:** (1) this year vs last compares Jan–Oct 24
    with all of 2025, so most "less than 2025" just means two months are
    left — compare against 2025 scaled to the same point in the year;
    (2) the period menu offers 2025 weeks / months / quarters, which hold
    no transactions and show all $0 — start those lists at Jan 2026.

## Next — start here

When Victor says "pick up where we left off", start here.

Paused 2026-10-24 (Victor's usage limit). Everything below the "Done"
list is built, verified and left uncommitted for Victor to commit.

1. **"Go with the 2 ideas"** = build both Insights ideas (see Insights in
   Done): (1) when the year picked is the current one and the prior year is
   imported annual history, compare against that year scaled to the same
   day of the year, labelled so it says so (e.g. "vs 2025 to Oct 24,
   est."); (2) in the period menu, start the weekly / monthly / quarterly
   lists at January 2026 (first transactions) — yearly keeps 2018 on.
   Verify desktop + 375px, then report.
2. Still open: the three splits that look swapped (Commissary Sep 20,
   Commissary Aug 12, Tran soan Aug 29) — ask before changing his data.
3. Every page in the sidebar has now been audited once.

## Left alone on purpose

Victor declined these — don't raise them again:

- Backfilling 2024–2025 Roth contributions into the Invest page's yearly
  records (Net Worth shows 2025 Contributed $13,757 vs Annual's $22,588).
- Moving Net Worth's Current NW / Proj EOY NW columns next to Spouse Age.
- Renaming trip "Wiesbaden · 2027" (dated Nov 2026).

## Don't delete

- The July 1, 2026 $457 Fundrise → USAA withdrawal is a record only (the
  balances already reflected it). Deleting it would put $457 back on
  Fundrise. Edit it instead if the date or bank is wrong.
