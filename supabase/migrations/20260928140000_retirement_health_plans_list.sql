-- Retirement Plan: more than one health plan.
--
-- Replaces the single health_plan_kind / health_plan_annual_cents pair (added
-- in 20260928130000, never filled in) with a list, so two plans can run side
-- by side — e.g. TRICARE Select plus a private supplement. Each entry is
-- { "kind": "tricare_prime" | "tricare_select" | "private", "annualCents": n }
-- and runs from the military retirement month until TRICARE For Life starts.
-- An empty list means no health plan premium.

alter table retirement_plan
  add column if not exists health_plans jsonb not null default '[]'::jsonb;

alter table retirement_plan
  drop column if exists health_plan_kind,
  drop column if exists health_plan_annual_cents;
