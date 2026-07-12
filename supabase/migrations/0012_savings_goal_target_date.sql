-- A target date on a savings goal (e.g. "by Dec 2027") lets the dashboard
-- tell you whether your current Monthly contribution is on pace to hit it,
-- rather than just tracking progress with no deadline.

alter table savings_goals
  add column if not exists target_date date;
