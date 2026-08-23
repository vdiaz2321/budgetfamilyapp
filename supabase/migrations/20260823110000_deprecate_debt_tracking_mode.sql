-- Deprecate `accounts.debt_tracking_mode`.
--
-- The column encoded a second answer to "is this account a liability", competing
-- with the `debts` table. In practice only one value was ever written:
-- `addAccount` hardcodes 'budget' for every debt account, and every existing row
-- carries it. The 'account' branch was therefore unreachable — and because it
-- existed only in the Net Worth query, it was also the single code path that
-- skipped the mortgage exclusion applied everywhere else. Had it ever been set
-- on a mortgage, Net Worth and Accounts would have disagreed by the full loan
-- balance.
--
-- The rule is now stated once, in src/lib/debt-identity.ts: the `debts` table is
-- the only liability ledger, and an account is never itself a liability.
--
-- The column is NOT dropped. Nothing reads it, so it is inert, and keeping it
-- avoids destroying data that a future migration might want to inspect.
comment on column public.accounts.debt_tracking_mode is
  'DEPRECATED and unread as of 2026-08-23. The debts table is the sole liability ledger; see src/lib/debt-identity.ts. Retained only to avoid data loss.';
