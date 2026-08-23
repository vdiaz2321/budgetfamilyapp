-- Retirement contribution caps, enterable from the app.
--
-- The IRS sets these by COLA and publishes next year's figures in late
-- October or November. Until now they lived only in a hardcoded table in
-- lib/contribution-limits.ts, which meant every new tax year needed a code
-- change or the Retirement contributions card would go blank on 1 January.
--
-- This table lets the caps be entered from the Savings page instead. Lookup
-- order is: row here for the tax year, then the hardcoded table, then the
-- "not published yet" state. So an empty table changes nothing — this only
-- ever adds years the code doesn't already know.
--
-- Caps are federal law and identical for everyone, but the row is
-- household-scoped anyway so RLS matches every other table here and one
-- household's entry can't affect another's.

create table if not exists contribution_caps (
  id                       uuid primary key default uuid_generate_v4(),
  household_id             uuid not null references households(id) on delete cascade,
  tax_year                 int  not null,
  elective_deferral_cents  bigint not null,
  ira_cents                bigint not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (household_id, tax_year)
);

create index if not exists contribution_caps_household_idx
  on contribution_caps (household_id, tax_year);

alter table contribution_caps enable row level security;

drop policy if exists contribution_caps_all on contribution_caps;
create policy contribution_caps_all on contribution_caps for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

comment on table contribution_caps is
  'Per-tax-year IRS contribution caps entered from the Savings page. Overrides the hardcoded table in lib/contribution-limits.ts; absent rows fall back to it.';
