-- Out-of-pocket on a stay is never cash and never undecided: Victor always
-- pays with one of his credit cards. Replace 'cash'/'tbd' with 'card'.
alter table public.travel_stays
  drop constraint if exists travel_stays_pocket_paid_with_check;

update public.travel_stays
   set pocket_paid_with = 'card'
 where pocket_paid_with in ('cash', 'tbd');

alter table public.travel_stays
  alter column pocket_paid_with set default 'card';

alter table public.travel_stays
  add constraint travel_stays_pocket_paid_with_check
  check (pocket_paid_with in ('card', 'points', 'credit'));
