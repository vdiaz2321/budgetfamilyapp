---
name: month-end-check
description: Read-only month-end check of Victor's budget app data in Supabase — bank and debt roll-forwards (start + activity = end), card payments, the Month-end update checklist, stale balances, and the biggest spending changes vs last month. Use when Victor asks to "run the month-end check", "check the month", "does everything add up", or types /month-end-check. Optional argument: the month to check as YYYY-MM (default: last completed month).
---

# Month-end check

Adapted from the Month-End Closer and GL Reconciler agents in
github.com/anthropics/financial-services: roll each balance forward, flag what
doesn't tie, explain the biggest changes. Scaled down to one household.

## Rules

- **Read-only.** Only `execute_sql` SELECTs on the Supabase project
  `xgrvrbydzwprmrvsqoiz`. Never insert, update, delete, or apply a migration
  from this skill. If something needs fixing, say what and where in the app —
  Victor fixes it, or asks for a fix separately.
- **A gap is a question, not an error.** Bank and savings balances are typed in
  by hand (Accounts, Month-end update), so a roll-forward gap usually means a
  hand-typed balance, bank interest, or a payment whose date moved. Name the
  likely cause; don't call it wrong.
- Pre-August 2026 rows are CSV imports with no account — expected, not a bug.
- In the report never write "Not paid"; say "no payment logged".
- Money as $1,234.56. Months as "Sep 2026".

## Month

`M` = the argument (YYYY-MM → first of month), else the last completed month
(today's month minus one). `P` = the month before `M`. Replace the dates in the
`m` CTE of every query below.

## Checks — run all, then report

### 1. Bank roll-forward

Plain bank accounts (no buckets — bucketed and investment balances are kept by
hand, so there is nothing to roll). Expected end = last month's snapshot + the
month's transactions; compare with this month's snapshot.

```sql
with m as (select date 'M' cur, date 'P' prev),
acct as (
  select a.* from accounts a
  where a.active and a.kind::text in ('checking','savings_bucket','cash') and not a.is_kids_account
    and not exists (select 1 from buckets b where b.account_id = a.id)),
flow as (
  select a.id, coalesce(sum(case
      when t.paid_to_account_id = a.id then t.amount_cents        -- money in from a transfer
      when t.movement_type is not null then -t.amount_cents       -- card payment / transfer out
      when c.kind = 'income' then t.amount_cents
      else -t.amount_cents end), 0) net,
    count(t.id) n
  from acct a cross join m
  left join transactions t on (t.account_id = a.id or t.paid_to_account_id = a.id)
    and t.occurred_on >= m.cur and t.occurred_on < m.cur + interval '1 month'
  left join categories c on c.id = t.category_id
  group by a.id)
select a.name, p.balance_cents start_cents, f.net activity_cents, f.n tx_count,
  s.balance_cents end_cents, s.balance_cents - (p.balance_cents + f.net) gap_cents
from acct a join flow f on f.id = a.id cross join m
left join account_snapshots p on p.account_id = a.id and p.month = m.prev
left join account_snapshots s on s.account_id = a.id and s.month = m.cur
order by abs(coalesce(s.balance_cents - (p.balance_cents + f.net), 0)) desc;
```

Gap 0 → ties. Small positive gap on a savings account → likely interest. Large
gap → check this first: **rows dated in the month but entered or changed after
the month's snapshot was last saved.** A snapshot freezes when the month ends,
so anything back-dated into it later (Victor often dates contributions to the
budget month, e.g. a TSP payment dated Sep 1 but entered Oct 1) is in the
roll-forward but not in the snapshot. The amount left after those is usually a
payment whose amount was edited after the month closed — it shows up as the
same unexplained figure on both the bank and the debt it paid.

```sql
with m as (select date 'M' cur)
select t.occurred_on, t.created_at::date entered, t.amount_cents, t.movement_type,
  coalesce(s.name, t.memo) what
from transactions t cross join m
join account_snapshots snap on snap.account_id = (select id from accounts where name = 'ACCOUNT NAME')
  and snap.month = m.cur
left join subcategories s on s.id = t.subcategory_id
where (t.account_id = snap.account_id or t.paid_to_account_id = snap.account_id)
  and t.occurred_on >= m.cur and t.occurred_on < m.cur + interval '1 month'
  and t.created_at > snap.updated_at
order by t.created_at;
```

Since Oct 3 2026 `transactions.updated_at` is set by a trigger whenever the
amount, date, reimbursed, account, budget item, payee or note changes (not on
Cleared). So for edits after that date, also list rows dated in the month whose
`updated_at > snap.updated_at` — that names an amount edited after the month
closed. Edits before Oct 3 2026 left no trace; infer them when the leftover gap
matches a debt gap.

### 2. Debt roll-forward

Expected end = last month's debt snapshot − payments filed under the debt that
month.

```sql
with m as (select date 'M' cur, date 'P' prev)
select s.name, p.balance_cents start_cents,
  coalesce(pay.paid, 0) paid_cents, e.balance_cents end_cents,
  e.balance_cents - (p.balance_cents - coalesce(pay.paid, 0)) gap_cents,
  d.current_balance_cents now_cents, d.apr
from debts d join subcategories s on s.id = d.subcategory_id cross join m
left join debt_snapshots p on p.subcategory_id = d.subcategory_id and p.month = m.prev
left join debt_snapshots e on e.subcategory_id = d.subcategory_id and e.month = m.cur
left join lateral (
  select sum(t.amount_cents) paid from transactions t
  where t.subcategory_id = d.subcategory_id
    and t.occurred_on >= m.cur and t.occurred_on < m.cur + interval '1 month') pay on true
where d.current_balance_cents > 0 or p.balance_cents > 0
order by s.name;
```

A gap on a 0% APR debt isn't interest — it usually means that month's snapshot
was captured before a payment and never refreshed, or the balance was edited on
the Debt/Loan page. Say which looks likely (compare `now_cents`).

### 3. Card payments

Cards charged in `P` should have a payment logged in `M` — through Pay card, or
as a debt payment on Budget for a card tracked as a debt.

```sql
with m as (select date 'M' cur, date 'P' prev)
select a.name, sp.spend_cents charged_prev_cents,
  coalesce(pay.paid, 0) paid_cents, v.owed_cents owed_now_cents
from accounts a cross join m
join v_card_month_spend sp on sp.account_id = a.id and sp.month = m.prev
left join v_card_balances v on v.account_id = a.id
left join lateral (
  select sum(t.amount_cents) paid from transactions t
  left join debts d on d.subcategory_id = t.subcategory_id
  where (t.paid_to_account_id = a.id or (t.paid_to_account_id is null and d.account_id = a.id))
    and t.occurred_on >= m.cur and t.occurred_on < m.cur + interval '1 month') pay on true
where a.kind = 'credit_card' and a.active and sp.spend_cents > 0
order by coalesce(pay.paid, 0), a.name;
```

Report only cards with `paid_cents = 0` ("no payment logged in Sep") and any
card whose `owed_now_cents` is above $0 — one line each.

### 4. Month-end update checklist

Same list the Accounts → Month-end update popup uses: Investments, Savings and
Kids Funding accounts (each bucket separately when the account has buckets).

```sql
with m as (select date 'M' mon),
items as (
  select a.id account_id, null::uuid bucket_id, a.name label from accounts a
  where a.active and (a.is_kids_account or a.kind::text in ('investment','savings_bucket'))
    and not exists (select 1 from buckets b where b.account_id = a.id)
  union all
  select null, b.id, a.name || ' · ' || b.name from buckets b join accounts a on a.id = b.account_id
  where a.active and (a.is_kids_account or a.kind::text in ('investment','savings_bucket')))
select count(*) total,
  count(*) filter (where exists (select 1 from month_end_checks c cross join m
    where c.month = m.mon and (c.account_id = i.account_id or c.bucket_id = i.bucket_id))) done,
  string_agg(label, '; ') filter (where not exists (select 1 from month_end_checks c cross join m
    where c.month = m.mon and (c.account_id = i.account_id or c.bucket_id = i.bucket_id))) missing
from items i;
```

### 5. Stale balances

Same rule as the red "updated … ago" line in the app: hand-typed balances older
than 45 days.

```sql
select a.name, b.name bucket, coalesce(b.balance_updated_at, a.balance_updated_at)::date updated
from accounts a left join buckets b on b.account_id = a.id
where a.active and a.kind::text in ('investment','savings_bucket','checking','cash')
  and coalesce(b.balance_updated_at, a.balance_updated_at) < now() - interval '45 days'
order by 3;
```

### 6. Biggest spending changes

Top 5 budget items by change vs last month (card payments and transfers left
out — they aren't spending).

```sql
with m as (select date 'M' cur, date 'P' prev),
x as (
  select s.name item, c.kind,
    coalesce(sum(t.amount_cents) filter (where t.occurred_on >= m.cur and t.occurred_on < m.cur + interval '1 month'), 0) cur_cents,
    coalesce(sum(t.amount_cents) filter (where t.occurred_on >= m.prev and t.occurred_on < m.cur), 0) prev_cents
  from transactions t cross join m
  join subcategories s on s.id = t.subcategory_id
  join categories c on c.id = t.category_id
  where t.occurred_on >= m.prev and t.occurred_on < m.cur + interval '1 month'
    and t.movement_type is null and c.kind <> 'income'
  group by 1, 2)
select *, cur_cents - prev_cents diff_cents from x
order by abs(cur_cents - prev_cents) desc limit 5;
```

For each, one short reason from the month's rows (e.g. "one-off $900 car
repair on Sep 12") — query the transactions behind it if needed.

## Report

Follow the repo's short-reply rule: a one-line result, then one short section
per check, problems first. Skip a section that has nothing to say ("All 5 bank
accounts tie" is enough). Example shape:

```
Sep 2026 month-end check: 3 things to look at.

Bank roll-forward
- Main checking: off by $1,234.56 — three contributions dated Sep 1 were entered Oct 1, after September closed.
- Savings: +$1.00 — likely interest.
Debts
- Card loan: Sep snapshot $100.00 higher than start − payments; today's balance matches, so the snapshot is stale.
Month-end update: 28 of 28 done.
Biggest changes: Travel −$250.00 vs Aug (last month’s trip).
```

End with at most one suggestion. Change nothing.
