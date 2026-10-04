-- Estate guide: let an account be left off the guide (a card about to be
-- closed, a small account the family doesn't need to chase). It stays on the
-- Accounts page; it just doesn't appear in the guide or its printout, and it
-- doesn't count toward the "to fill in" badge.
alter table public.accounts
  add column if not exists estate_hidden boolean not null default false;
