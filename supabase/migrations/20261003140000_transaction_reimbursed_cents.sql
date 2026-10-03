-- How much of a card or debt payment came back as a reimbursement, so the
-- Accounts payment popups can show "Paid $682.00 · Reimbursed $100.00 ·
-- Net $582.00".
--
-- amount_cents stays the NET amount (paid minus reimbursed): every balance,
-- view and total in the app already reads amount_cents, so they all count the
-- net without changing. The paid amount is amount_cents + reimbursed_cents.

alter table public.transactions
  add column if not exists reimbursed_cents integer not null default 0;

alter table public.transactions
  drop constraint if exists transactions_reimbursed_cents_nonneg;
alter table public.transactions
  add constraint transactions_reimbursed_cents_nonneg check (reimbursed_cents >= 0);
