-- Victor doesn't want to record a cash value per redemption, and won't be
-- logging statement-credit redemptions at all. The column never held a row.
alter table public.credit_card_reward_activities drop column if exists value_cents;
