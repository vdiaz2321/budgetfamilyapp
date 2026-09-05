-- A reservation that falls through is not a mistake to be deleted: it stays in
-- the archive so the trip's history is complete, but it must not count toward
-- what was spent or saved. "Cancel booking" sets this; restoring clears it.
alter table public.travel_stays
  add column if not exists cancelled_at timestamptz;
