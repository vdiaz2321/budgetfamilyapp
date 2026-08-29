-- Recurring budget items (utilities, paycheck deductions) charge close to the
-- same amount every month. Flagging one turns on the "Prev Mo Spent" prefill
-- in the item panel, so last month's actual can be re-logged in one click
-- instead of being retyped. Off by default: most items are not recurring, and
-- the chip should not appear on groceries or dining.
alter table subcategories
  add column if not exists is_recurring boolean not null default false;

comment on column subcategories.is_recurring is
  'When true, the budget item panel offers a one-click prefill from last month''s actual spend.';
