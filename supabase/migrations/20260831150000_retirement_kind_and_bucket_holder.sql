-- Explicit retirement classification, and a holder on buckets.
--
-- The contribution-cap card used to work out which limit applied by pattern
-- matching the account/bucket NAME ("roth", "ira", "tsp"). That produces false
-- figures in two ways:
--
--  1. A Roth IRA and a Traditional IRA share ONE annual limit per person, and
--     so do two Roth IRAs at different brokerages. Read off names, each slot
--     looked like an independent cap — the card offered a full extra $7,500 of
--     room in a second Roth IRA that was already partly used elsewhere.
--  2. A "Roth" TSP/401k is governed by the elective-deferral limit, not the
--     IRA limit, and only a name-precedence hack kept those apart.
--
-- `retirement_kind` states it instead of inferring it. NULL still falls back to
-- the name-based inference, so nothing regresses before the field is filled in.
--
-- Traditional and Roth are separate values even though they share a limit: the
-- distinction drives nothing in the cap maths today, but it is what the user
-- actually knows about the account, and conflating them at entry would make the
-- field feel wrong to fill in.
--
-- `buckets.holder` exists because the cap is per PERSON and a single brokerage
-- account holds more than one person's money — the Fidelity account carries a
-- Roth for each spouse plus a taxable bucket. Grouping by `accounts.holder`
-- alone cannot separate them.

alter table accounts add column if not exists retirement_kind text;
alter table buckets add column if not exists retirement_kind text;
alter table buckets add column if not exists holder text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_retirement_kind_check'
  ) then
    alter table accounts add constraint accounts_retirement_kind_check
      check (retirement_kind is null or retirement_kind in
        ('traditional_ira', 'roth_ira', 'elective_deferral'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'buckets_retirement_kind_check'
  ) then
    alter table buckets add constraint buckets_retirement_kind_check
      check (retirement_kind is null or retirement_kind in
        ('traditional_ira', 'roth_ira', 'elective_deferral'));
  end if;
end $$;

comment on column accounts.retirement_kind is
  'Which annual contribution limit governs this account: traditional_ira / roth_ira (shared per-person IRA limit) or elective_deferral (401k/TSP/403b/457). NULL = infer from the name.';
comment on column buckets.retirement_kind is
  'Per-bucket override of accounts.retirement_kind, for a brokerage holding several kinds of money.';
comment on column buckets.holder is
  'Whose money this bucket is. IRA limits are per person, and one brokerage account can hold a Roth for each spouse. NULL falls back to accounts.holder.';
