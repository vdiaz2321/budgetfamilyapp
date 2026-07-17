-- Budget rollover: carry a month's *actual* leftover cash (income received
-- minus what was actually spent) forward as money available to budget the
-- next month. Each row just flags a source month as "rolled over" — the
-- amount itself is always recomputed live from that month's actuals, so it
-- stays correct when transactions are added, edited, or deleted after the
-- toggle was flipped.

create table if not exists budget_rollovers (
  household_id  uuid not null references households(id) on delete cascade,
  month         date not null,           -- source month (first-of-month)
  created_at    timestamptz not null default now(),
  primary key (household_id, month)
);

alter table budget_rollovers enable row level security;

drop policy if exists budget_rollovers_all on budget_rollovers;
create policy budget_rollovers_all on budget_rollovers for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
