-- Optional source account for a manually-paid budget item.
-- This is intentionally separate from linked_account_id, which is used only
-- by Savings items to move money into an investment account.
alter table public.subcategories
  add column if not exists payment_account_id uuid
  references public.accounts(id) on delete set null;

create index if not exists subcategories_payment_account_id_idx
  on public.subcategories(payment_account_id)
  where payment_account_id is not null;
