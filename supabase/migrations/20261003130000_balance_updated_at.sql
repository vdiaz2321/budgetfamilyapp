-- When a balance was last typed in by hand, so the Accounts summary can say
-- "updated Oct 2 · 1 day ago" and flag a group that has gone stale.
--
-- updated_at can't serve: renames, group moves and tax-treatment changes bump
-- it, and the Accounts page itself rewrites it on load when bucket sums
-- drift. This column is set only by the actions where a balance is entered —
-- the inline balance edits on Accounts and the Month-end update popup — so
-- automatic syncs and transactions never make an account look fresh.
--
-- Existing rows start from updated_at: the best record there is, and for most
-- accounts it is the Oct 2 2026 month-end update.

alter table public.accounts
  add column if not exists balance_updated_at timestamptz;
update public.accounts set balance_updated_at = updated_at where balance_updated_at is null;
alter table public.accounts
  alter column balance_updated_at set default now(),
  alter column balance_updated_at set not null;

alter table public.buckets
  add column if not exists balance_updated_at timestamptz;
update public.buckets set balance_updated_at = updated_at where balance_updated_at is null;
alter table public.buckets
  alter column balance_updated_at set default now(),
  alter column balance_updated_at set not null;
