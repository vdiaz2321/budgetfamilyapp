-- Annual Breakdown history — a faithful, read-only multi-year view of Victor's
-- Google Sheet "Annual Breakdown" tab for the pre-app years (2018–2025). Every
-- income/expense/savings/investment line item has an ANNUAL total per year (the
-- sheet has no month-by-month detail for these years), so this powers a multi-year
-- table (line item × year) on the Annual Overview page rather than the existing
-- month-by-month view.
--
-- Deliberately SELF-CONTAINED: the sheet's own taxonomy is carried as text labels,
-- NOT foreign keys to `subcategories`. The live DB has only a handful of budget
-- subcategories; the ~100 historical sheet line items are display-only history and
-- must not pollute live budgeting (Budget page pickers, actuals, etc.). Nothing
-- here touches net-worth or budget math — it's a standalone historical record.
--
-- The sheet groups two levels deep (a parent group that is a subtotal, e.g.
-- "Grocery/Hygiene", over its leaf line items, e.g. "Groceries"). Only LEAF rows
-- are stored; parents are recomputed as subtotals when rendered. Its own 4-way
-- grouping is Income / Expenses / Savings / Investment.
create table if not exists annual_breakdown_history (
  household_id uuid   not null references households(id) on delete cascade,
  kind         text   not null,   -- 'income' | 'expenses' | 'savings' | 'investment'
  group_label  text   not null,   -- parent group ('Income' for the flat income section)
  line_label   text   not null,   -- leaf line item
  year         int    not null,
  amount_cents bigint not null default 0,  -- positive magnitude, as printed in the sheet
  group_sort   int    not null default 0,
  line_sort    int    not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, kind, group_label, line_label, year),
  constraint annual_breakdown_history_kind_check
    check (kind in ('income', 'expenses', 'savings', 'investment'))
);

create index if not exists annual_breakdown_history_household_year_idx
  on annual_breakdown_history (household_id, year);

alter table annual_breakdown_history enable row level security;

drop policy if exists annual_breakdown_history_all on annual_breakdown_history;
create policy annual_breakdown_history_all on annual_breakdown_history for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());
