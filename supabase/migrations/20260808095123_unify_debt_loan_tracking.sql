-- Unify account-created loans and opt-in revolving cards with the existing
-- Budget debt / payoff simulator without changing normal credit-card behavior.

alter table public.debts
  add column if not exists original_balance_cents bigint,
  add column if not exists target_payment_cents bigint not null default 0,
  add column if not exists escrow_cents bigint not null default 0,
  add column if not exists loan_start_date date,
  add column if not exists term_months integer,
  add column if not exists tracking_enabled boolean not null default true,
  add column if not exists interest_method text not null default 'monthly_estimate',
  add column if not exists interest_paid_cents bigint not null default 0;

update public.debts
set original_balance_cents = greatest(current_balance_cents, 0)
where original_balance_cents is null;

alter table public.debts
  alter column original_balance_cents set default 0,
  alter column original_balance_cents set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'debts_nonnegative_payoff_fields'
      and conrelid = 'public.debts'::regclass
  ) then
    alter table public.debts
      add constraint debts_nonnegative_payoff_fields check (
        original_balance_cents >= 0
        and current_balance_cents >= 0
        and min_payment_cents >= 0
        and target_payment_cents >= 0
        and escrow_cents >= 0
        and interest_paid_cents >= 0
        and (term_months is null or term_months > 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'debts_interest_method_valid'
      and conrelid = 'public.debts'::regclass
  ) then
    alter table public.debts
      add constraint debts_interest_method_valid check (
        interest_method in ('monthly_estimate', 'statement_manual')
      );
  end if;
end $$;

create table if not exists public.debt_interest_entries (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references public.households(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  occurred_on date not null default current_date,
  amount_cents bigint not null check (amount_cents > 0),
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists debt_interest_entries_household_date_idx
  on public.debt_interest_entries (household_id, occurred_on desc);
create index if not exists debt_interest_entries_debt_idx
  on public.debt_interest_entries (debt_id);
create index if not exists debts_household_tracking_idx
  on public.debts (household_id, tracking_enabled)
  where tracking_enabled = true;

alter table public.debt_interest_entries enable row level security;

drop policy if exists debt_interest_entries_all on public.debt_interest_entries;
create policy debt_interest_entries_all
  on public.debt_interest_entries
  for all
  to authenticated
  using (household_id = (select auth_household_id()))
  with check (
    household_id = (select auth_household_id())
    and exists (
      select 1
      from public.debts d
      where d.id = debt_id
        and d.household_id = (select auth_household_id())
    )
  );

-- New projects can opt out of automatic Data API grants. Keep these grants
-- explicit and let RLS enforce household isolation.
grant select, insert, update, delete on table public.debt_interest_entries to authenticated;
grant select, insert, update, delete on table public.debts to authenticated;
