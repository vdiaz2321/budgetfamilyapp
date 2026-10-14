-- A Type per bucket.
--
-- One login at a bank or brokerage routinely holds several kinds of account:
-- the kids' Fidelity holds a 529 and a UTMA for each child (and soon a Trump
-- Account), and the kids' Capital One holds a checking and a savings account.
-- accounts.subtype could only say one of those, so the whole group was forced
-- into a single Type — or split into separate accounts, which is what buckets
-- exist to avoid.
--
-- This mirrors how Monarch, Empower and the bank sites themselves model it:
-- the institution is a grouping, and the Type belongs to each account inside
-- it. NULL means "same as the account", so every existing bucket reads exactly
-- as before until a Type is picked for it.
--
-- Banking buckets already have their own Checking/Savings tag in
-- buckets.bank_group (migration 0019); this column is for the Investments and
-- Kids Funding vocabulary (529, UTMA, Roth IRA, Trump Account, …).

alter table buckets add column if not exists subtype text;

comment on column buckets.subtype is
  'This bucket''s own account Type (e.g. 529, UTMA, Trump Account). NULL = same as accounts.subtype.';
