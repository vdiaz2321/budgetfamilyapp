-- A UTMA's state and hand-over age belong to the account, not the child: each
-- account stays under the state on its title even after the family moves, so
-- one child's accounts can differ. Null means not known yet, and the app shows
-- no date rather than assuming one.
--
-- kids.utma_handover_age stays for now because the deployed app still reads it.
-- Drop it in a later migration once this code is live.

alter table public.accounts
  add column if not exists utma_state text check (utma_state ~ '^[A-Z]{2}$'),
  add column if not exists utma_handover_age smallint check (utma_handover_age between 18 and 25);

alter table public.buckets
  add column if not exists utma_state text check (utma_state ~ '^[A-Z]{2}$'),
  add column if not exists utma_handover_age smallint check (utma_handover_age between 18 and 25);
