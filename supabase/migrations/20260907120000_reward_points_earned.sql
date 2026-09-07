-- Points only ever went DOWN by hand. Everyday spending earns them, so the
-- balance on a card drifted below reality until it was typed over in the
-- card's edit form — which left no record of where the points came from.
-- 'points_earned' is a positive-delta entry; the existing trigger already adds
-- whatever delta it is given.
--
-- (A value_cents column shipped alongside this on the same day and was dropped
-- the same day, unused — see 20260907130000_reward_drop_value_cents.sql.)
alter table public.credit_card_reward_activities
  drop constraint if exists credit_card_reward_activities_activity_type_check;
alter table public.credit_card_reward_activities
  add constraint credit_card_reward_activities_activity_type_check
  check (activity_type in (
    'points_redemption',
    'hotel_credit_redemption',
    'free_night_booking',
    'reward_refund',
    'points_earned'
  ));
