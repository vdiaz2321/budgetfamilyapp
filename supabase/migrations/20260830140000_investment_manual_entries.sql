-- Manual monthly entry for brokerages with no CSV export (Schwab, TSP, M1).
--
-- Nothing about the CSV path changes: manual rows land in the same ongoing
-- ledger as imported ones. `entry_source` only records who typed the row, so
-- the table can label it and a later CSV re-import can report what it replaced.

alter table public.investment_performance_snapshots
  add column entry_source text not null default 'csv'
  check (entry_source in ('csv', 'manual'));

alter table public.investment_position_snapshots
  add column entry_source text not null default 'csv'
  check (entry_source in ('csv', 'manual'));

-- One performance row per month per ledger. Nothing enforced this before, so a
-- double-submit or an overlapping re-import could leave two rows for one month
-- and silently double the ledger's totals.
create unique index investment_performance_snapshots_month_uniq
  on public.investment_performance_snapshots (import_batch_id, as_of_date);

-- Positions legitimately hold many rows per date (one per holding), so the
-- holding itself is part of the key.
create unique index investment_position_snapshots_holding_uniq
  on public.investment_position_snapshots (import_batch_id, as_of_date, coalesce(symbol, security_name));
