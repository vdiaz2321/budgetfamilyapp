-- Add free-night points limit (hotel brand cards: "up to 35,000 pts per year")
-- and a date for when the benefit was used or scheduled.
alter table credit_card_details
  add column if not exists free_night_points_limit integer,
  add column if not exists benefit_used_on date;
