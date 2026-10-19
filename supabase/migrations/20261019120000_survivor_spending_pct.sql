-- Survivor spending % (Victor, 2026-10-19): on the "If you die first" card,
-- the share of the family's planned spending that carries on after his
-- death. 100 = no change.

alter table retirement_plan
  add column if not exists survivor_spending_pct numeric(5,2) not null default 100
    check (survivor_spending_pct > 0 and survivor_spending_pct <= 100);
