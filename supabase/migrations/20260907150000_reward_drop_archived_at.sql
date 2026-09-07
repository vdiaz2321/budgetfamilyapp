-- Archive was a visibility flag that moved no balance, and once entries could
-- be deleted (and the delete gives the points back) it had no job left. The
-- UI is gone; the column never held a non-null value.
alter table public.credit_card_reward_activities drop column if exists archived_at;
