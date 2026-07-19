-- Investment performance — separates, per investment account per year, how much
-- was CONTRIBUTED (deposits) from how much the account GREW on its own
-- (interest / unrealized gains). Powers the /invest page's year-end review
-- ("keep investing here?"). Balances themselves are unchanged — they still live
-- in account_snapshots; this only decomposes the year-over-year movement.

-- 1) investment_years — the authoritative/reviewed numbers per investment
--    account per calendar year. Two sources feed it:
--      * a one-time historical SEED from Victor's sheet (2023–2026), since no
--        per-account snapshots or transactions exist for those years, and
--      * a manual override/"lock-in" of the derived values at year-end review.
--    When no row exists for an account+year, the /invest page derives the
--    numbers live (contributions from transactions, accrual from balance deltas).
--    est_contribute_cents holds the sheet's forward-looking "~Contribute" plan.
create table if not exists investment_years (
  household_id         uuid   not null references households(id) on delete cascade,
  account_id           uuid   not null references accounts(id) on delete cascade,
  year                 int    not null,
  contributed_cents    bigint not null default 0, -- actual contributed that year
  accrued_cents        bigint not null default 0, -- interest / unrealized gain
  est_contribute_cents bigint not null default 0, -- sheet's "~Contribute" estimate
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (household_id, account_id, year)
);

create index if not exists investment_years_household_year_idx
  on investment_years (household_id, year);

alter table investment_years enable row level security;

drop policy if exists investment_years_all on investment_years;
create policy investment_years_all on investment_years for all
  using (household_id = auth_household_id())
  with check (household_id = auth_household_id());

-- 2) v_investment_contributions — net contributions per investment account per
--    year, derived from transactions. Amounts are stored unsigned with the
--    direction in is_withdrawal, so a withdrawal subtracts. Only transactions
--    tagged to a kind='investment' account count, so this depends on the account
--    being selected on the transaction (going-forward habit; history is seeded).
create or replace view v_investment_contributions as
select
  t.household_id,
  t.account_id,
  extract(year from t.occurred_on)::int as year,
  sum(case when t.is_withdrawal then -t.amount_cents else t.amount_cents end)::bigint
    as net_contribution_cents
from transactions t
join accounts a on a.id = t.account_id
where a.kind = 'investment'
group by t.household_id, t.account_id, extract(year from t.occurred_on)::int;
