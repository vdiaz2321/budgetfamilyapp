-- Monthly interest accrual watermark.
--
-- Until now interest only ever reached a balance through the manual
-- "Record statement interest" action. For a credit card that is correct — the
-- statement is authoritative. For an ordinary installment loan it meant
-- interest simply never accrued, so every logged payment reduced principal by
-- its full amount and balances drifted steadily optimistic.
--
-- Rather than split each payment (which would double-count against the manual
-- statement flow), interest is accrued once per calendar month for debts on
-- `interest_method = 'monthly_estimate'`. This column records the last month
-- already accrued, making the catch-up idempotent: re-running it in the same
-- month is a no-op.
--
-- Null means "never accrued". The accrual routine treats null as the current
-- month and charges nothing for it, so switching an existing debt onto
-- monthly_estimate never back-charges history.
alter table public.debts
  add column if not exists interest_accrued_through date;

comment on column public.debts.interest_accrued_through is
  'Last month (YYYY-MM-01) for which monthly_estimate interest was accrued. Null = never; accrual starts from the current month.';
