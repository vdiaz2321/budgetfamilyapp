-- Breakfast on a stay was only ever recorded inside the free-text remarks
-- ("3 x pax / b'fast incl"), so it could be read but never filtered or
-- counted. This makes it a real flag, and backfills it from the phrasing the
-- imported sheet used.
alter table travel_stays
  add column if not exists breakfast_included boolean not null default false;

update travel_stays
set breakfast_included = true
where breakfast_included = false
  and (remarks ilike '%b''fast%' or remarks ilike '%breakfast%');
