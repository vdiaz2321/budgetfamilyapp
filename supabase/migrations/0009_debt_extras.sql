-- Debt panel additions: type/kind (mirrors EveryDollar's Auto/Student/Mortgage
-- etc.), free-form notes, and a promo-APR end date (0% intro period reminder).

alter table debts
  add column if not exists debt_kind text,
  add column if not exists notes text,
  add column if not exists promo_apr_ends_on date;
