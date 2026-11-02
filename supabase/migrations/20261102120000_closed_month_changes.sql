-- A saved month's close (account_snapshots / bucket_snapshots) doesn't move when
-- a transaction is backdated into that month, re-dated out of it, edited or
-- deleted. Accounts then disagrees with itself until someone notices, as with a
-- $4,400 transfer logged on Nov 2 that really left on Oct 31.
--
-- This records every such change so Accounts can offer to update the close. It's
-- a trigger because transactions are written from about twenty places, and only
-- the database sees all of them, including a delete or a move out of a month.
--
-- It records facts and moves nothing: the app works out which balances are
-- affected, shows the before and after, and writes only if the user says so.

create table if not exists public.closed_month_changes (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null,
  old_row        jsonb,
  new_row        jsonb,
  changed_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists closed_month_changes_open_idx
  on public.closed_month_changes (household_id)
  where resolved_at is null;

alter table public.closed_month_changes enable row level security;

drop policy if exists closed_month_changes_all on public.closed_month_changes;
create policy closed_month_changes_all on public.closed_month_changes
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

grant select, insert, update, delete on public.closed_month_changes to authenticated;
grant select, insert, update, delete on public.closed_month_changes to service_role;

create or replace function public.record_closed_month_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_of_month date := date_trunc('month', now())::date;
  v_household_id uuid;
  v_transaction_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  -- Fields that decide which balance moves, by how much, and in which month.
  if tg_op = 'UPDATE' and not (
    new.occurred_on is distinct from old.occurred_on
    or new.amount_cents is distinct from old.amount_cents
    or new.is_withdrawal is distinct from old.is_withdrawal
    or new.account_id is distinct from old.account_id
    or new.bucket_id is distinct from old.bucket_id
    or new.source_bucket_id is distinct from old.source_bucket_id
    or new.paid_to_account_id is distinct from old.paid_to_account_id
    or new.paid_to_bucket_id is distinct from old.paid_to_bucket_id
    or new.category_id is distinct from old.category_id
    or new.subcategory_id is distinct from old.subcategory_id
  ) then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    -- CSV imports never moved a balance, so they can't put a close out of step.
    if old.source::text = 'import' then return null; end if;
    v_household_id := old.household_id;
    v_transaction_id := old.id;
    if old.occurred_on < v_first_of_month then
      v_old := jsonb_build_object(
        'occurred_on', old.occurred_on, 'amount_cents', old.amount_cents, 'is_withdrawal', old.is_withdrawal,
        'account_id', old.account_id, 'bucket_id', old.bucket_id, 'source_bucket_id', old.source_bucket_id,
        'paid_to_account_id', old.paid_to_account_id, 'paid_to_bucket_id', old.paid_to_bucket_id,
        'category_id', old.category_id, 'subcategory_id', old.subcategory_id,
        'payee_id', old.payee_id, 'memo', old.memo);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.source::text = 'import' then return null; end if;
    v_household_id := new.household_id;
    v_transaction_id := new.id;
    if new.occurred_on < v_first_of_month then
      v_new := jsonb_build_object(
        'occurred_on', new.occurred_on, 'amount_cents', new.amount_cents, 'is_withdrawal', new.is_withdrawal,
        'account_id', new.account_id, 'bucket_id', new.bucket_id, 'source_bucket_id', new.source_bucket_id,
        'paid_to_account_id', new.paid_to_account_id, 'paid_to_bucket_id', new.paid_to_bucket_id,
        'category_id', new.category_id, 'subcategory_id', new.subcategory_id,
        'payee_id', new.payee_id, 'memo', new.memo);
    end if;
  end if;

  -- Only this month and later on both sides: no closed month is involved.
  if v_old is null and v_new is null then return null; end if;

  -- A household being deleted takes its transactions with it; nothing to offer.
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = v_household_id) then
    return null;
  end if;

  insert into public.closed_month_changes (household_id, transaction_id, old_row, new_row)
  values (v_household_id, v_transaction_id, v_old, v_new);
  return null;
end;
$$;

-- Fires from the trigger only; no one should call it through the API.
revoke execute on function public.record_closed_month_change() from public, anon, authenticated;

drop trigger if exists transactions_record_closed_month_change on public.transactions;
create trigger transactions_record_closed_month_change
  after insert or update or delete on public.transactions
  for each row execute function public.record_closed_month_change();
