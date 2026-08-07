-- Add direct indexes for the foreign keys introduced by investment_import_foundation.
create index investment_import_batches_account_id_idx
  on public.investment_import_batches (account_id);

create index investment_import_batches_bucket_id_idx
  on public.investment_import_batches (bucket_id);

create index investment_position_snapshots_account_id_idx
  on public.investment_position_snapshots (account_id);

create index investment_position_snapshots_bucket_id_idx
  on public.investment_position_snapshots (bucket_id);

create index investment_performance_snapshots_import_batch_id_idx
  on public.investment_performance_snapshots (import_batch_id);

create index investment_performance_snapshots_account_id_idx
  on public.investment_performance_snapshots (account_id);

create index investment_performance_snapshots_bucket_id_idx
  on public.investment_performance_snapshots (bucket_id);
