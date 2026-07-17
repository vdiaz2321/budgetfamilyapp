-- Kids Funding: a standalone account group (any kind — checking, savings,
-- investment) that's tracked on Accounts but excluded from Assets / Net
-- Worth everywhere, since it's the kids' money, not the household's.
--
-- is_kids_account routes an account into that group regardless of its
-- underlying kind. subtype is a free-text label ("Roth IRA", "Trump
-- Account", "UTMA", "529", whatever) shown as a chip — never a restricted
-- list, since new account types show up faster than this app can track them.
-- include_net_worth is auto-derived from is_kids_account (see actions.ts)
-- and is what the rest of the app actually reads.
alter table accounts
  add column if not exists subtype text,
  add column if not exists is_kids_account boolean not null default false,
  add column if not exists include_net_worth boolean not null default true;

-- The original unique(household_id, name) constraint blocked reusing a name
-- across groups (e.g. a household "Fidelity" and a separate kids' "Fidelity"
-- under Kids Funding). Scope uniqueness to (household_id, name,
-- is_kids_account) instead — still no duplicate names within the same group,
-- but the same institution name can appear once on each side.
alter table accounts
  drop constraint if exists accounts_household_id_name_key;
alter table accounts
  add constraint accounts_household_id_name_kids_key unique (household_id, name, is_kids_account);
