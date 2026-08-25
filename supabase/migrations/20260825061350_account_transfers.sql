-- First-class account transfers. A single transaction row records both legs:
-- account_id / bucket_id are the source and paid_to_account_id /
-- paid_to_bucket_id are the destination. movement_type prevents an ordinary
-- bank transfer from being mistaken for a card payment.

alter table public.transactions
  add column if not exists movement_type text,
  add column if not exists paid_to_bucket_id uuid references public.buckets(id) on delete set null;

alter table public.transactions
  drop constraint if exists transactions_movement_type_check;
alter table public.transactions
  add constraint transactions_movement_type_check
  check (movement_type is null or movement_type in ('account_transfer', 'card_payment', 'investment_transfer'));

create index if not exists transactions_paid_to_bucket_idx
  on public.transactions (paid_to_bucket_id)
  where paid_to_bucket_id is not null;

-- Backfill any movement rows created before the explicit discriminator.
update public.transactions t
set movement_type = case
  when exists (
    select 1 from public.accounts destination
    where destination.id = t.paid_to_account_id
      and destination.kind = 'credit_card'
  ) then 'card_payment'
  when exists (
    select 1 from public.accounts source
    where source.id = t.account_id
      and source.kind = 'investment'
  ) then 'investment_transfer'
  else 'account_transfer'
end
where t.paid_to_account_id is not null
  and t.movement_type is null;

-- Create, edit, and delete an account transfer in one database transaction so
-- both ledger legs always move together. SECURITY INVOKER keeps the caller's
-- RLS policies in force; the function never bypasses household isolation.
create or replace function public.mutate_account_transfer(
  p_action text,
  p_transaction_id uuid default null,
  p_occurred_on date default null,
  p_amount_cents bigint default null,
  p_from_account_id uuid default null,
  p_to_account_id uuid default null,
  p_from_bucket_id uuid default null,
  p_to_bucket_id uuid default null,
  p_memo text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid := public.auth_household_id();
  v_tx public.transactions%rowtype;
  v_result_id uuid;
  v_from_kind text;
  v_to_kind text;
  v_from_name text;
  v_to_name text;
  v_bucket_count integer;
begin
  if v_household_id is null then
    raise exception 'No household is available for this user.';
  end if;
  if p_action not in ('create', 'update', 'delete') then
    raise exception 'Unsupported transfer action.';
  end if;

  -- Lock and reverse the original movement before an update or delete.
  if p_action in ('update', 'delete') then
    if p_transaction_id is null then
      raise exception 'A transfer id is required.';
    end if;

    select * into v_tx
    from public.transactions
    where id = p_transaction_id
      and household_id = v_household_id
      and movement_type = 'account_transfer'
    for update;
    if not found then
      raise exception 'Transfer not found.';
    end if;

    perform 1
    from public.accounts
    where household_id = v_household_id
      and id in (v_tx.account_id, v_tx.paid_to_account_id)
    order by id
    for update;

    if v_tx.bucket_id is not null then
      update public.buckets
      set balance_cents = balance_cents + v_tx.amount_cents,
          updated_at = now()
      where id = v_tx.bucket_id
        and household_id = v_household_id;
      update public.accounts a
      set current_balance_cents = (
            select coalesce(sum(b.balance_cents), 0)
            from public.buckets b
            where b.account_id = a.id
          ),
          updated_at = now()
      where a.id = v_tx.account_id
        and a.household_id = v_household_id;
    else
      update public.accounts
      set current_balance_cents = current_balance_cents + v_tx.amount_cents,
          updated_at = now()
      where id = v_tx.account_id
        and household_id = v_household_id;
    end if;

    if v_tx.paid_to_bucket_id is not null then
      update public.buckets
      set balance_cents = balance_cents - v_tx.amount_cents,
          updated_at = now()
      where id = v_tx.paid_to_bucket_id
        and household_id = v_household_id;
      update public.accounts a
      set current_balance_cents = (
            select coalesce(sum(b.balance_cents), 0)
            from public.buckets b
            where b.account_id = a.id
          ),
          updated_at = now()
      where a.id = v_tx.paid_to_account_id
        and a.household_id = v_household_id;
    else
      update public.accounts
      set current_balance_cents = current_balance_cents - v_tx.amount_cents,
          updated_at = now()
      where id = v_tx.paid_to_account_id
        and household_id = v_household_id;
    end if;

    if p_action = 'delete' then
      delete from public.transactions
      where id = v_tx.id
        and household_id = v_household_id;
      return v_tx.id;
    end if;
  end if;

  if p_occurred_on is null or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter a valid transfer date and amount.';
  end if;
  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    raise exception 'Pick two different accounts.';
  end if;

  -- Stable lock order prevents two simultaneous opposite transfers from
  -- deadlocking each other.
  perform 1
  from public.accounts
  where household_id = v_household_id
    and id in (p_from_account_id, p_to_account_id)
  order by id
  for update;

  select kind::text, name into v_from_kind, v_from_name
  from public.accounts
  where id = p_from_account_id
    and household_id = v_household_id
    and active is true;
  select kind::text, name into v_to_kind, v_to_name
  from public.accounts
  where id = p_to_account_id
    and household_id = v_household_id
    and active is true;
  if v_from_kind is null or v_to_kind is null then
    raise exception 'Account not found.';
  end if;
  if v_from_kind in ('credit_card', 'investment') or v_to_kind in ('credit_card', 'investment') then
    raise exception 'Use the card or investment transfer workflow for those accounts.';
  end if;

  select count(*) into v_bucket_count
  from public.buckets
  where household_id = v_household_id and account_id = p_from_account_id;
  if v_bucket_count > 0 and p_from_bucket_id is null then
    raise exception 'Pick which % bucket the money comes from.', v_from_name;
  end if;
  if p_from_bucket_id is not null and not exists (
    select 1 from public.buckets
    where id = p_from_bucket_id
      and household_id = v_household_id
      and account_id = p_from_account_id
  ) then
    raise exception 'The source bucket does not belong to the source account.';
  end if;

  select count(*) into v_bucket_count
  from public.buckets
  where household_id = v_household_id and account_id = p_to_account_id;
  if v_bucket_count > 0 and p_to_bucket_id is null then
    raise exception 'Pick which % bucket the money goes into.', v_to_name;
  end if;
  if p_to_bucket_id is not null and not exists (
    select 1 from public.buckets
    where id = p_to_bucket_id
      and household_id = v_household_id
      and account_id = p_to_account_id
  ) then
    raise exception 'The destination bucket does not belong to the destination account.';
  end if;

  perform 1
  from public.buckets
  where household_id = v_household_id
    and id in (p_from_bucket_id, p_to_bucket_id)
  order by id
  for update;

  if p_from_bucket_id is not null then
    update public.buckets
    set balance_cents = balance_cents - p_amount_cents,
        updated_at = now()
    where id = p_from_bucket_id and household_id = v_household_id;
    update public.accounts a
    set current_balance_cents = (
          select coalesce(sum(b.balance_cents), 0)
          from public.buckets b
          where b.account_id = a.id
        ),
        updated_at = now()
    where a.id = p_from_account_id and a.household_id = v_household_id;
  else
    update public.accounts
    set current_balance_cents = current_balance_cents - p_amount_cents,
        updated_at = now()
    where id = p_from_account_id and household_id = v_household_id;
  end if;

  if p_to_bucket_id is not null then
    update public.buckets
    set balance_cents = balance_cents + p_amount_cents,
        updated_at = now()
    where id = p_to_bucket_id and household_id = v_household_id;
    update public.accounts a
    set current_balance_cents = (
          select coalesce(sum(b.balance_cents), 0)
          from public.buckets b
          where b.account_id = a.id
        ),
        updated_at = now()
    where a.id = p_to_account_id and a.household_id = v_household_id;
  else
    update public.accounts
    set current_balance_cents = current_balance_cents + p_amount_cents,
        updated_at = now()
    where id = p_to_account_id and household_id = v_household_id;
  end if;

  if p_action = 'create' then
    insert into public.transactions (
      household_id,
      occurred_on,
      amount_cents,
      account_id,
      bucket_id,
      paid_to_account_id,
      paid_to_bucket_id,
      movement_type,
      subcategory_id,
      is_withdrawal,
      memo,
      source
    ) values (
      v_household_id,
      p_occurred_on,
      p_amount_cents,
      p_from_account_id,
      p_from_bucket_id,
      p_to_account_id,
      p_to_bucket_id,
      'account_transfer',
      null,
      false,
      coalesce(nullif(trim(p_memo), ''), 'Transfer to ' || v_to_name),
      'manual'
    ) returning id into v_result_id;
  else
    update public.transactions
    set occurred_on = p_occurred_on,
        amount_cents = p_amount_cents,
        account_id = p_from_account_id,
        bucket_id = p_from_bucket_id,
        paid_to_account_id = p_to_account_id,
        paid_to_bucket_id = p_to_bucket_id,
        movement_type = 'account_transfer',
        category_id = null,
        subcategory_id = null,
        payee_id = null,
        is_withdrawal = false,
        memo = coalesce(nullif(trim(p_memo), ''), 'Transfer to ' || v_to_name),
        updated_at = now()
    where id = p_transaction_id
      and household_id = v_household_id
    returning id into v_result_id;
  end if;

  return v_result_id;
end;
$$;

revoke all on function public.mutate_account_transfer(text, uuid, date, bigint, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.mutate_account_transfer(text, uuid, date, bigint, uuid, uuid, uuid, uuid, text) to authenticated;
