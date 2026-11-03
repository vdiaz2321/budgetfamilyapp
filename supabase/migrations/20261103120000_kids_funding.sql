-- Kids Funding is organised by child, because everything that matters about
-- these accounts (who it's for, when it hands over, what a sibling can receive)
-- is per child, not per brokerage login.
--
--   kids                 the children, set once: name, birth month, UTMA age
--   accounts / buckets   who each one is for and who controls it, plus the last
--                        four and institution a bucket had nowhere to keep
--   kids_account_events  closes, hand-overs and beneficiary changes, so an item
--                        keeps its story and its balance history after it ends
--
-- A bucket keeps its id, so its snapshots and Budget links are untouched. Names
-- and birth months are not seeded here: this file lives in a public repository.

create table if not exists public.kids (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  name               text not null,
  -- First of the birth month. The year and month decide every hand-over date.
  birth_month        date not null,
  -- Set when the UTMA was opened and fixed by state law, so it's stored rather
  -- than assumed. 21 is Florida's default for a gift.
  utma_handover_age  smallint not null default 21 check (utma_handover_age between 18 and 25),
  created_at         timestamptz not null default now(),
  unique (household_id, name)
);

alter table public.kids enable row level security;

drop policy if exists kids_all on public.kids;
create policy kids_all on public.kids
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

grant select, insert, update, delete on public.kids to authenticated;
grant select, insert, update, delete on public.kids to service_role;

alter table public.accounts
  add column if not exists kid_id uuid references public.kids(id) on delete set null,
  add column if not exists controlled_by text,
  add column if not exists successor_owner text,
  add column if not exists closed_reason text
    check (closed_reason is null or closed_reason in ('closed', 'handed_over'));

alter table public.buckets
  add column if not exists kid_id uuid references public.kids(id) on delete set null,
  add column if not exists institution text,
  add column if not exists account_number text,
  add column if not exists controlled_by text,
  add column if not exists successor_owner text,
  add column if not exists date_closed date,
  add column if not exists closed_reason text
    check (closed_reason is null or closed_reason in ('closed', 'handed_over'));

create table if not exists public.kids_account_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  event         text not null
    check (event in ('closed', 'handed_over', 'reopened', 'beneficiary_changed', 'moved_529')),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  bucket_id     uuid references public.buckets(id) on delete cascade,
  from_kid_id   uuid references public.kids(id) on delete set null,
  to_kid_id     uuid references public.kids(id) on delete set null,
  -- The balance that left on a close or hand-over (what Reopen puts back), or
  -- the amount of a 529 move.
  amount_cents  bigint,
  -- Names as they read that day, so history survives a rename.
  detail        text,
  note          text,
  occurred_on   date not null,
  created_at    timestamptz not null default now()
);

create index if not exists kids_account_events_item_idx
  on public.kids_account_events (household_id, account_id, bucket_id, occurred_on desc);

alter table public.kids_account_events enable row level security;

drop policy if exists kids_account_events_all on public.kids_account_events;
create policy kids_account_events_all on public.kids_account_events
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

grant select, insert, update, delete on public.kids_account_events to authenticated;
grant select, insert, update, delete on public.kids_account_events to service_role;

-- An item ending: the balance leaves, the row and its past months stay. Earlier
-- months are never rewritten, same rule as every other snapshot in the app.
create or replace function public.kids_end_item(
  p_account_id uuid,
  p_bucket_id uuid,
  p_reason text,
  p_on date,
  p_note text default null
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_household_id uuid := public.auth_household_id();
  v_amount bigint;
  v_kid uuid;
  v_closed date;
  v_bucket_count integer;
begin
  if v_household_id is null then
    raise exception 'No household is available for this user.';
  end if;
  if p_reason not in ('closed', 'handed_over') then
    raise exception 'Unsupported action.';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'Pick a date that isn''t in the future.';
  end if;
  if not exists (
    select 1 from public.accounts
    where id = p_account_id and household_id = v_household_id and is_kids_account is true
    for update
  ) then
    raise exception 'That isn''t a Kids Funding account.';
  end if;

  if p_bucket_id is not null then
    select balance_cents, kid_id, date_closed into v_amount, v_kid, v_closed
    from public.buckets
    where id = p_bucket_id and account_id = p_account_id and household_id = v_household_id
    for update;
    if not found then raise exception 'Bucket not found.'; end if;
    if v_closed is not null then raise exception 'This one is already closed.'; end if;

    update public.buckets
    set balance_cents = 0, date_closed = p_on, closed_reason = p_reason, updated_at = now()
    where id = p_bucket_id;
    update public.accounts a
    set current_balance_cents = (select coalesce(sum(b.balance_cents), 0) from public.buckets b where b.account_id = a.id),
        updated_at = now()
    where a.id = p_account_id;
  else
    select count(*) into v_bucket_count
    from public.buckets where account_id = p_account_id and household_id = v_household_id;
    if v_bucket_count > 0 then
      raise exception 'Pick which bucket of this account is ending.';
    end if;
    select current_balance_cents, kid_id, date_closed into v_amount, v_kid, v_closed
    from public.accounts where id = p_account_id;
    if v_closed is not null then raise exception 'This one is already closed.'; end if;

    update public.accounts
    set current_balance_cents = 0, active = false, date_closed = p_on, closed_reason = p_reason, updated_at = now()
    where id = p_account_id;
    -- An inactive account drops out of captureSnapshots, so its current month
    -- has to be settled here.
    update public.account_snapshots
    set balance_cents = 0, updated_at = now()
    where account_id = p_account_id and household_id = v_household_id
      and month = date_trunc('month', current_date)::date;
  end if;

  insert into public.kids_account_events
    (household_id, event, account_id, bucket_id, from_kid_id, amount_cents, note, occurred_on)
  values
    (v_household_id, p_reason, p_account_id, p_bucket_id, v_kid, v_amount, nullif(trim(p_note), ''), p_on);
end;
$$;

-- Undoes a close or hand-over entered by mistake, balance included.
create or replace function public.kids_reopen_item(
  p_account_id uuid,
  p_bucket_id uuid
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_household_id uuid := public.auth_household_id();
  v_amount bigint;
  v_kid uuid;
begin
  if v_household_id is null then
    raise exception 'No household is available for this user.';
  end if;

  select amount_cents, from_kid_id into v_amount, v_kid
  from public.kids_account_events
  where household_id = v_household_id
    and account_id = p_account_id
    and bucket_id is not distinct from p_bucket_id
    and event in ('closed', 'handed_over')
  order by created_at desc
  limit 1;
  if not found then raise exception 'Nothing to reopen.'; end if;

  if p_bucket_id is not null then
    update public.buckets
    set balance_cents = coalesce(v_amount, 0), date_closed = null, closed_reason = null, updated_at = now()
    where id = p_bucket_id and account_id = p_account_id and household_id = v_household_id;
    update public.accounts a
    set current_balance_cents = (select coalesce(sum(b.balance_cents), 0) from public.buckets b where b.account_id = a.id),
        updated_at = now()
    where a.id = p_account_id and a.household_id = v_household_id;
  else
    update public.accounts
    set current_balance_cents = coalesce(v_amount, 0), active = true, date_closed = null, closed_reason = null, updated_at = now()
    where id = p_account_id and household_id = v_household_id;
  end if;

  insert into public.kids_account_events
    (household_id, event, account_id, bucket_id, to_kid_id, amount_cents, occurred_on)
  values
    (v_household_id, 'reopened', p_account_id, p_bucket_id, v_kid, v_amount, current_date);
end;
$$;

-- A 529's beneficiary. Only a 529: a UTMA and a Trump Account legally belong to
-- their child. The child's name also moves in the item's own name, so
-- "529 Ben (4830)" can't keep saying Ben on every other page.
create or replace function public.kids_change_beneficiary(
  p_account_id uuid,
  p_bucket_id uuid,
  p_to_kid_id uuid,
  p_on date,
  p_note text default null
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_household_id uuid := public.auth_household_id();
  v_type text;
  v_from_kid uuid;
  v_from_name text;
  v_to_name text;
  v_name text;
  v_new_name text;
begin
  if v_household_id is null then
    raise exception 'No household is available for this user.';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'Pick a date that isn''t in the future.';
  end if;

  select name into v_to_name from public.kids where id = p_to_kid_id and household_id = v_household_id;
  if v_to_name is null then raise exception 'Pick who it''s for now.'; end if;

  if p_bucket_id is not null then
    select coalesce(b.subtype, a.subtype), b.kid_id, b.name into v_type, v_from_kid, v_name
    from public.buckets b join public.accounts a on a.id = b.account_id
    where b.id = p_bucket_id and b.account_id = p_account_id and b.household_id = v_household_id
      and a.is_kids_account is true and b.date_closed is null
    for update of b;
  else
    select subtype, kid_id, name into v_type, v_from_kid, v_name
    from public.accounts
    where id = p_account_id and household_id = v_household_id
      and is_kids_account is true and date_closed is null
    for update;
  end if;
  if v_name is null then raise exception 'Account not found.'; end if;
  if v_type is distinct from '529' then
    raise exception 'Only a 529 can change beneficiary.';
  end if;
  if v_from_kid is not distinct from p_to_kid_id then
    raise exception 'It''s already for %.', v_to_name;
  end if;

  select name into v_from_name from public.kids where id = v_from_kid and household_id = v_household_id;
  v_new_name := case when v_from_name is null then v_name
    else regexp_replace(v_name, '\m' || v_from_name || '\M', v_to_name, 'g') end;

  if p_bucket_id is not null then
    update public.buckets set kid_id = p_to_kid_id, name = v_new_name, updated_at = now() where id = p_bucket_id;
  else
    update public.accounts
    set kid_id = p_to_kid_id, name = v_new_name, holder = v_to_name, updated_at = now()
    where id = p_account_id;
  end if;

  insert into public.kids_account_events
    (household_id, event, account_id, bucket_id, from_kid_id, to_kid_id, note, occurred_on)
  values
    (v_household_id, 'beneficiary_changed', p_account_id, p_bucket_id, v_from_kid, p_to_kid_id, nullif(trim(p_note), ''), p_on);
end;
$$;

grant execute on function public.kids_end_item(uuid, uuid, text, date, text) to authenticated, service_role;
grant execute on function public.kids_reopen_item(uuid, uuid) to authenticated, service_role;
grant execute on function public.kids_change_beneficiary(uuid, uuid, uuid, date, text) to authenticated, service_role;

-- Two buckets of one account can now move money between them (529 Ben → 529 Leo
-- both sit under the kids' Fidelity), and two Kids Funding accounts can move
-- money even if one is held as an investment. A closed bucket takes no money.
create or replace function public.mutate_account_transfer(
  p_action text,
  p_transaction_id uuid default null::uuid,
  p_occurred_on date default null::date,
  p_amount_cents bigint default null::bigint,
  p_from_account_id uuid default null::uuid,
  p_to_account_id uuid default null::uuid,
  p_from_bucket_id uuid default null::uuid,
  p_to_bucket_id uuid default null::uuid,
  p_memo text default null::text
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_household_id uuid := public.auth_household_id();
  v_tx public.transactions%rowtype;
  v_result_id uuid;
  v_from_kind text;
  v_to_kind text;
  v_from_name text;
  v_to_name text;
  v_from_kids boolean;
  v_to_kids boolean;
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
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Pick two different accounts.';
  end if;
  -- One account is fine only between two of its own buckets.
  if p_from_account_id = p_to_account_id
    and (p_from_bucket_id is null or p_to_bucket_id is null or p_from_bucket_id = p_to_bucket_id) then
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

  select kind::text, name, is_kids_account into v_from_kind, v_from_name, v_from_kids
  from public.accounts
  where id = p_from_account_id
    and household_id = v_household_id
    and active is true;
  select kind::text, name, is_kids_account into v_to_kind, v_to_name, v_to_kids
  from public.accounts
  where id = p_to_account_id
    and household_id = v_household_id
    and active is true;
  if v_from_kind is null or v_to_kind is null then
    raise exception 'Account not found.';
  end if;
  if v_from_kind = 'credit_card' or v_to_kind = 'credit_card'
    or ((v_from_kind = 'investment' or v_to_kind = 'investment')
        and not (v_from_kids is true and v_to_kids is true)) then
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
      and date_closed is null
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
      and date_closed is null
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
$function$;
