-- Social Security earnings record (Victor, 2026-10-22).
--
-- The plan took one typed benefit per Social Security line, and the SSA
-- statement behind it assumes the worker keeps earning until he claims and
-- dies "this year". Neither holds for a soldier who leaves the Army in 2033,
-- and a survivor benefit depends on the earnings up to the year of death. So
-- the plan now keeps the record itself and works the benefit out (lib/ssa):
--
--   * social_security_records — one row per person with a record. The
--     statement PDF is read in the browser and never uploaded; only these
--     numbers are saved, no name or birth date (birth_month alone, for the
--     claiming-age months).
--       earnings   [{ "year": 2025, "cents": 9336800, "split": false }, ...]
--                  Past years as SSA posted them; future years as planned,
--                  in that year's dollars. "split" marks a year spread out of
--                  a combined range on the statement ("1991-2000").
--       statement  the statement's own figures, kept to compare against:
--                  { "statementDate", "retirementByAge": { "62": cents, ... },
--                    "disabilityCents", "survivors": { childCents,
--                    caregiverCents, spouseAtFraCents, familyMaxCents },
--                    "assumedEarningsCents" }
--   * retirement_plan.spouse_ss_claim_age — the age a spouse with no record
--     of her own starts the spousal benefit (half the worker's PIA at her full
--     retirement age, less before it). Null = no spousal benefit.

create table if not exists public.social_security_records (
  household_id   uuid not null references public.households(id) on delete cascade,
  person         text not null default 'self' check (person in ('self', 'spouse')),
  birth_month    smallint check (birth_month is null or (birth_month between 1 and 12)),
  statement_date date,
  statement      jsonb,
  earnings       jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (household_id, person)
);

alter table public.social_security_records enable row level security;

drop policy if exists social_security_records_all on public.social_security_records;
create policy social_security_records_all on public.social_security_records
  for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

grant select, insert, update, delete on public.social_security_records to authenticated;
grant select, insert, update, delete on public.social_security_records to service_role;

alter table public.retirement_plan
  add column if not exists spouse_ss_claim_age smallint
    check (spouse_ss_claim_age is null or (spouse_ss_claim_age between 62 and 70));
