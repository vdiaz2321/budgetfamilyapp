-- Per-subscription "Recurring" flag. Subscriptions all share one Bills
-- subcategory, so subcategories.is_recurring can only say "subscriptions in
-- general repeat" — it can't carry the per-row answer, and the Prev Mo Spent
-- prefill built on it would offer the combined subscriptions total instead of
-- the one row's charge. This column is that per-row answer: when true, the
-- Due-this-week entry offers a one-click prefill from what this subscription
-- actually cost last month (its card and payee come from the row itself).
alter table subscriptions
  add column if not exists is_recurring boolean not null default false;

comment on column subscriptions.is_recurring is
  'When true, Due this week offers a one-click prefill from this subscription''s own previous-month charge.';
