-- The day of the month a credit card's payment is due (1–31), set once on the
-- card. The Accounts page's card tiles show the next due date from it, in red
-- within a week, so a payment isn't missed (two late fees prompted this —
-- Victor, 2026-10-14).
--
-- One field for the card: a card tracked as payoff debt used to keep its due
-- day only on its debts row (Debt tab). The card form now has a single
-- "Payment due day" that feeds both, so seed it from those rows.
alter table public.accounts
  add column if not exists payment_due_day smallint
    check (payment_due_day is null or payment_due_day between 1 and 31);

update public.accounts a
set payment_due_day = d.due_day
from public.debts d
where d.account_id = a.id
  and a.kind = 'credit_card'
  and a.payment_due_day is null
  and d.due_day between 1 and 31;
