# Kids Funding: where we left off (2026-11-04)

Delete this file once these are done.

## Commit this work
Nothing is committed yet. Victor stages, commits and pushes it himself.

- `src/app/(app)/accounts/kids-funding.tsx`, `kids-actions.ts`, `types.ts`
- `src/lib/kids-funding.ts`, `tests/kids-funding.test.mjs`
- `supabase/migrations/20261104120000_kids_details_changed_event.sql`
  (already applied to the live database, so don't run it again)
- `supabase/migrations/20261104130000_utma_state_per_account.sql`
  (already applied to the live database, so don't run it again)
- `src/app/(app)/accounts/page.tsx`, `actions.ts`

On the other machine, pull after pushing. No install or database step is needed.

## What changed
- Opening an account row is now one form with one Save, all on one line.
- The Edit details, Transfer and Close account buttons are gone. A transfer and
  stop tracking are choices in the form, and Save says what it will do.
- Closed accounts move to one collapsed "Closed accounts" list at the bottom.
- Rows read "Leo's UTMA" with no last 4 and no adult's name. Owner and custodian
  are gone from the forms, and one Status choice replaces Tracking.
- Delete is a light red pill that warns first, and it erases the account's Budget
  item unless that item has activity.

## Still open
1. **UTMA age on other states.** Only CA, CO, FL, GA, NC, NY, TN and TX fill in an
   age from their law (`UTMA_GIFT_AGE` in `src/lib/kids-funding.ts`). Every other
   state starts with no age. Add a state only after reading its statute: published
   tables disagree, and Arizona had a 2025 bill to change its age.
2. **529 balances look about a month ahead of the statements.** The app is about
   one monthly deposit higher for Sep and Oct. It may be that balances are typed
   after the next deposit lands. Not confirmed, and nothing was changed.
3. **Trump Account hand-over date.** It shows January of the year the child turns
   18, when most are still 17. The suggestion is the 18th birthday month. The
   rules aren't final. No answer yet.

## Later cleanup
`kids.utma_handover_age` is no longer read by this code. Drop it in a new migration
once this code is deployed, not before: the live site still reads it until then.

## Not checked
A real iPhone. Saving on a Trump or bank account was not tried.
