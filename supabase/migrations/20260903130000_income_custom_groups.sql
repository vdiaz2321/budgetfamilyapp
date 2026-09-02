-- Custom category groups may be Income.
--
-- Rental income is the case that forced this: expenses for a property can
-- already be grouped ("123 Main St"), but every income line was stuck inside
-- the one system Income group, so a property's rent could not be read as its
-- own section. Debt stays system-only — a debt group is created through
-- Accounts/Debts, which keys off the single system Debt category.
--
-- Mirrors CUSTOM_GROUP_KINDS in src/app/(app)/budget/actions.ts.
alter table categories drop constraint if exists categories_custom_kind_check;
alter table categories add constraint categories_custom_kind_check
  check (is_system or kind = any (array['income'::category_kind, 'bills'::category_kind, 'expenses'::category_kind, 'savings'::category_kind]));
