alter table public.accounts
  add column if not exists institution text,
  add column if not exists account_number text,
  add column if not exists ownership text not null default 'sole'
    check (ownership in ('sole', 'joint')),
  add column if not exists debt_tracking_mode text not null default 'budget'
    check (debt_tracking_mode in ('budget', 'account'));
