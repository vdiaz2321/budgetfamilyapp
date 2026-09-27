-- Retirement Plan, phase 3: debt payoffs lower spending.
--
-- Each current debt is projected like Debt/Loans' "My Plan" (its own planned
-- payment, escrow excluded). Once a debt is paid off, the payment it no longer
-- needs comes off that year's spending. Stored per year so the table can say
-- so: spending_cents = base_spending_cents + healthcare − debt_freed_cents.

alter table networth_projection
  add column if not exists debt_freed_cents bigint not null default 0
    check (debt_freed_cents >= 0);
