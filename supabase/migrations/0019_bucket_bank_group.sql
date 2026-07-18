-- Lets each bucket inside a Banking account carry its own Checking/Savings
-- tag, for accounts that hold both kinds of money as separate buckets (e.g.
-- "Cap One V" with a "Cap One Checking" bucket and a "Cap One Savings"
-- bucket) — previously the whole account was forced into one type.
alter table buckets
  add column if not exists bank_group text
    check (bank_group in ('savings', 'spending'));

-- Backfill: accounts created before this had no way to set bank_group except
-- via the Edit form, so plenty are still null and show no Checking/Savings
-- badge at all. Derive it from the type picked when the account was added
-- (kind), so every existing Banking account gets a badge without needing a
-- manual edit.
update accounts
set bank_group = case when kind = 'savings_bucket' then 'savings' else 'spending' end
where kind in ('checking', 'savings_bucket') and bank_group is null;
