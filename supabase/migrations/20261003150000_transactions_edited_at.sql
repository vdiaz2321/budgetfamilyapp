-- When a transaction was last edited, so the Accounts payment popups can show
-- "edited Oct 3" on a payment whose amount or date was changed after it was
-- logged. transactions.updated_at already existed but nothing ever set it, so
-- it always equalled created_at; this trigger keeps it honest from now on.
--
-- Only changes a person would call an edit count: amount, date, reimbursed,
-- account, budget item, payee, note. Ticking Cleared or the booking/trip links
-- the app re-syncs in the background leave it alone, so it doesn't fire on
-- noise. Edits made before this migration can't be recovered.

create or replace function public.touch_transaction_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount_cents is distinct from old.amount_cents
    or new.occurred_on is distinct from old.occurred_on
    or new.reimbursed_cents is distinct from old.reimbursed_cents
    or new.account_id is distinct from old.account_id
    or new.subcategory_id is distinct from old.subcategory_id
    or new.payee_id is distinct from old.payee_id
    or new.memo is distinct from old.memo
  then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_touch_edited_at on public.transactions;
create trigger transactions_touch_edited_at
  before update on public.transactions
  for each row execute function public.touch_transaction_edited_at();
