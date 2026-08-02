-- Allow a manual override of the rollover amount when the live calculation
-- can't be easily corrected. NULL = use live calc; any integer = use this
-- value (in cents) instead, regardless of actual transactions.
alter table budget_rollovers
  add column if not exists override_cents integer;
