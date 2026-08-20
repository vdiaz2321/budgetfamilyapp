-- Archive old reward-ledger entries without deleting their audit history.
alter table credit_card_reward_activities
  add column if not exists archived_at timestamptz;

create index if not exists credit_card_reward_activities_active_date_idx
  on credit_card_reward_activities (household_id, occurred_on desc, created_at desc)
  where archived_at is null;
