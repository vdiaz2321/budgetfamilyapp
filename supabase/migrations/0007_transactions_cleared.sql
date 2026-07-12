-- Transactions page: simple "cleared" checkmark (the Log tab's Clear column).
-- Checked = you verified the charge against the bank / credit card app.
-- No reconcile flow on purpose.

alter table transactions
  add column if not exists cleared boolean not null default false;
