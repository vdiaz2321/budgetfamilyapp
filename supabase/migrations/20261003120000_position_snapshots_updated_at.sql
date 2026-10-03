-- When a holding was last touched, so Holdings & history can say "Updated
-- Aug 4 · 60 days ago" and flag a ledger that has gone stale.
--
-- as_of_date can't serve: it is the statement date a snapshot belongs to, and
-- editing a holding's figures deliberately leaves it alone (moving it would
-- reshuffle snapshot history and could collide with the per-date unique
-- index). Existing rows start from created_at, the best record there is.

alter table public.investment_position_snapshots
  add column if not exists updated_at timestamptz;

update public.investment_position_snapshots
  set updated_at = created_at
  where updated_at is null;

alter table public.investment_position_snapshots
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- A trigger rather than each server action setting it, so every write path
-- (edit form, re-filing to another account, CSV replace) keeps it honest.
create or replace function public.touch_position_snapshot_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists position_snapshots_touch_updated_at on public.investment_position_snapshots;
create trigger position_snapshots_touch_updated_at
  before update on public.investment_position_snapshots
  for each row execute function public.touch_position_snapshot_updated_at();
