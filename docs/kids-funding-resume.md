# Kids Funding: where we left off (2026-11-04)

Delete this file once these are done.

## Commit this work
Nothing is committed yet. Victor stages, commits and pushes it himself.

- `src/app/(app)/accounts/kids-funding.tsx`, `kids-actions.ts`, `types.ts`
- `src/lib/kids-funding.ts`, `tests/kids-funding.test.mjs`
- `supabase/migrations/20261104120000_kids_details_changed_event.sql`
  (already applied to the live database, so don't run it again)

On the other machine, pull after pushing. No install or database step is needed.

## What changed
- Opening an account row is now one form with one Save, all on one line.
- The Edit details, Transfer and Close account buttons are gone. A transfer and
  stop tracking are choices in the form, and Save says what it will do.
- Closed accounts move to one collapsed "Closed accounts" list at the bottom.
- Delete is a light red pill that warns first, and it erases the account's Budget
  item unless that item has activity.

## Still open
1. **UTMA hand-over age.** The app set 21 for every child as a starting value and
   it was never checked. Find the state on each UTMA's Fidelity statement
   (Documents tab, near the top), then look up that state's age. Set it in
   "Hands over at". The 529 statement doesn't help: its state is just the plan's.
2. **Owner on the 529s.** The statements list Victor as participant, which means
   owner, but the app shows "Not set". Claude offered to set all three to Vic. No
   answer yet.
3. **529 balances look about a month ahead of the statements.** The app is about
   one monthly deposit higher for Sep and Oct. It may be that balances are typed
   after the next deposit lands. Not confirmed, and nothing was changed.
4. **Trump Account hand-over date.** It shows January of the year the child turns
   18, when most are still 17. The suggestion is the 18th birthday month. The
   rules aren't final. No answer yet.

## Not checked
Dark mode, and a real iPhone. Saving on a UTMA, Trump or bank account was not
tried; only 529 saves were tested.
