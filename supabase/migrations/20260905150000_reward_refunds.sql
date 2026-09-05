-- The reward ledger could only ever spend: both deltas were checked <= 0. A
-- travel stay can now be edited, cancelled or deleted after it was booked, and
-- each of those has to hand the points and the night credit back to the card,
-- so the ledger needs entries that add.
alter table public.credit_card_reward_activities
  drop constraint if exists credit_card_reward_activities_points_delta_check;
alter table public.credit_card_reward_activities
  drop constraint if exists credit_card_reward_activities_hotel_credit_delta_cents_check;

alter table public.credit_card_reward_activities
  drop constraint if exists credit_card_reward_activities_activity_type_check;
alter table public.credit_card_reward_activities
  add constraint credit_card_reward_activities_activity_type_check
  check (activity_type in (
    'points_redemption',
    'hotel_credit_redemption',
    'free_night_booking',
    'reward_refund'
  ));
