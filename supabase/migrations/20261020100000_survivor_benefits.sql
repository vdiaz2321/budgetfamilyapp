-- Military survivor benefits and children (Victor, 2026-10-20).
--
-- children: [{ "birthYear": 2015, "college": true }, …] — drives the DIC
--   child add-ons, DIC for a child 18–23 in school, and the SBP child ages.
-- sgli_cents: SGLI coverage held on active duty, $0 (declined) to $500,000
--   in $50,000 steps. Paid on an active-duty death.
-- vgli_*: VGLI after retirement — kept only if converted from SGLI, never
--   more than the SGLI amount. Paid on a death after retirement.
-- *_payout: 'lump' or 'monthly36' (36 equal monthly payments). The member
--   can lock in 36; otherwise the beneficiary chooses.

alter table retirement_plan
  add column if not exists children jsonb not null default '[]'::jsonb,
  add column if not exists sgli_cents bigint not null default 50000000
    check (sgli_cents between 0 and 50000000),
  add column if not exists sgli_payout text not null default 'lump'
    check (sgli_payout in ('lump', 'monthly36')),
  add column if not exists vgli_enabled boolean not null default false,
  add column if not exists vgli_cents bigint not null default 0
    check (vgli_cents between 0 and 50000000),
  add column if not exists vgli_payout text not null default 'lump'
    check (vgli_payout in ('lump', 'monthly36'));
