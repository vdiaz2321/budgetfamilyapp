-- Add card_url and benefit_cadence to credit_card_details
-- (replaces the per-benefit fields from credit_card_benefits)
ALTER TABLE credit_card_details
  ADD COLUMN IF NOT EXISTS card_url        text,
  ADD COLUMN IF NOT EXISTS benefit_cadence text;
