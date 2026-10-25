-- A GS pension (FERS basic annuity) as an income line (Victor, 2026-10-25).
--
-- kind 'fers' reuses the line's columns for what was typed:
--   * start_year / start_month — first month in the GS job;
--   * end_year / end_month     — last month in it (separation);
--   * annual_cents             — the expected high-3 average salary, per year.
-- The pension's own start date and amount are worked out from those and the
-- owner's birth year (lib/fers), never stored.
--
-- New columns, meaningful on 'fers' lines only:
--   * owner            — whose GS career it is: 'self' or 'spouse';
--   * survivor_pct     — the survivor annuity elected: 0, 25 or 50 (%);
--   * fers_start_early — with 10–29 years, take the reduced annuity at the
--                        minimum retirement age instead of waiting for 62.
--
-- Columns on an existing table: its grants and RLS policy already cover them.

alter table public.retirement_income_lines drop constraint if exists retirement_income_lines_kind_check;
alter table public.retirement_income_lines add constraint retirement_income_lines_kind_check
  check (kind in ('pay', 'va', 'social_security', 'job', 'spouse', 'other', 'fers'));

alter table public.retirement_income_lines
  add column if not exists owner text not null default 'self'
    check (owner in ('self', 'spouse')),
  add column if not exists survivor_pct smallint not null default 0
    check (survivor_pct in (0, 25, 50)),
  add column if not exists fers_start_early boolean not null default false;
