-- Per-month planned overrides for subscriptions.
--
-- The Budget card's Plan column is cycle-aware: it derives a row's plan from
-- subscriptions.amount_cents in the months that subscription actually charges,
-- and $0 everywhere else. That is right for the common case, but it leaves a
-- month with real spending and no way to budget for it — an annual sub charged
-- early, a cancelled sub that still billed once, a one-off charge on a
-- subscription card. Those rows show up in the Overspent filter and the Plan
-- cell was inert: typing in it edited the sticker price, which the month's
-- derived plan then ignored.
--
-- A row here overrides the derived plan for one (subscription, month) pair.
-- Months the subscription genuinely charges keep using amount_cents, so a
-- price change still edits the subscription itself rather than one month.
create table if not exists subscription_plans (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references households(id) on delete cascade,
  subscription_id uuid        not null references subscriptions(id) on delete cascade,
  month           date        not null,  -- always the first of the month
  planned_cents   bigint      not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, subscription_id, month)
);

create index if not exists subscription_plans_household_month_idx
  on subscription_plans (household_id, month);

alter table subscription_plans enable row level security;
drop policy if exists subscription_plans_all on subscription_plans;
create policy subscription_plans_all on subscription_plans for all
  using  (household_id = auth_household_id())
  with check (household_id = auth_household_id());
