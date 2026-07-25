-- Credit Card management: add card-specific fields to accounts, and link
-- subscriptions/irregular_bills to the card they charge on.

-- Card-specific metadata. Only meaningful for credit_card accounts, but
-- stored on the general accounts table (same pattern as subtype, bank_group).
alter table accounts
  add column if not exists annual_fee_cents bigint,
  add column if not exists fee_waived boolean not null default false,
  add column if not exists date_opened date,
  add column if not exists date_closed date;

-- Link subscriptions and irregular bills to the credit card they charge to.
-- ON DELETE SET NULL so deleting a card doesn't cascade-delete billing items.
alter table subscriptions
  add column if not exists account_id uuid references accounts(id) on delete set null;

alter table irregular_bills
  add column if not exists account_id uuid references accounts(id) on delete set null;
