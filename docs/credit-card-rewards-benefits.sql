-- Capitall credit-card rewards and benefits extension.
-- Apply manually in the Supabase SQL Editor. Codex does not apply migrations.

alter table credit_card_details
  add column if not exists rewards_category text
    check (rewards_category in ('travel', 'hotel')),
  add column if not exists rewards_program text,
  add column if not exists points_value_micros bigint,
  add column if not exists five24_countable boolean not null default true;

create table if not exists credit_card_benefits (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references accounts(id) on delete cascade,
  household_id          uuid not null references households(id) on delete cascade,
  name                  text not null,
  benefit_type          text not null default 'credit',
  cadence               text not null default 'annual',
  max_value_cents       bigint,
  required_spend_cents  bigint,
  requirement_text      text,
  enrollment_required   boolean not null default false,
  period_start          date,
  period_end            date,
  used_amount_cents     bigint not null default 0,
  status                text not null default 'available',
  action_url            text,
  source_url            text,
  notes                 text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint credit_card_benefits_status_check
    check (status in ('available', 'in_progress', 'used', 'expired', 'not_applicable')),
  constraint credit_card_benefits_cadence_check
    check (cadence in ('monthly', 'quarterly', 'annual', 'anniversary', 'milestone', 'one_time')),
  constraint credit_card_benefits_amounts_check
    check (coalesce(max_value_cents, 0) >= 0 and coalesce(used_amount_cents, 0) >= 0)
);

create index if not exists credit_card_benefits_household_idx
  on credit_card_benefits (household_id, account_id, active);

alter table credit_card_benefits enable row level security;
drop policy if exists credit_card_benefits_all on credit_card_benefits;
create policy credit_card_benefits_all on credit_card_benefits for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

