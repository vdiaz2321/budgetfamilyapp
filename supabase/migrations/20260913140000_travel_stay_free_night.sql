-- Two gaps in the stay form, found together.
--
-- 1. A free-night certificate had no way to be recorded. The only thing that
--    stamped a card's Booked date was a points booking, so a night paid with
--    the certificate either went unrecorded or had to pretend to be points.
--    free_night_used marks it; free_night_points is the certificate's cap for
--    that stay (pre-filled from the card's free_night_points_limit).
--
-- 2. Every stay in the log came over from the spreadsheet import on
--    2026-09-05, and their points were never taken off a card by the app — the
--    balances were typed in from the bank sites. Editing one still posted the
--    difference to the reward ledger, so correcting a typo in an imported
--    stay handed back points the card never lost. moves_card_points is true
--    only for stays created in the app; imported rows keep the default false
--    and their edits no longer touch a card's balance.
alter table public.travel_stays
  add column if not exists free_night_used boolean not null default false,
  add column if not exists free_night_points integer check (free_night_points is null or free_night_points >= 0),
  add column if not exists moves_card_points boolean not null default false;
