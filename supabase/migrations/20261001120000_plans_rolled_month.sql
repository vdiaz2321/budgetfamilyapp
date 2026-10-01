-- The last month whose plan was rolled in from the month before it. A new
-- month starts with last month's plan automatically: the first page load in
-- that month claims it here (a conditional update, so two tabs can't both
-- roll), then copies the plan forward. Null until the first auto roll-in.
alter table households
  add column if not exists plans_rolled_month date;
