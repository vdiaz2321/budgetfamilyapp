-- An item's history also records a move to another institution, a new account
-- number or a new owner, so a rollover keeps its date and its old details.
alter table public.kids_account_events
  drop constraint if exists kids_account_events_event_check;

alter table public.kids_account_events
  add constraint kids_account_events_event_check
  check (event in ('closed', 'handed_over', 'reopened', 'beneficiary_changed', 'moved_529', 'details_changed'));
