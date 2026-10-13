-- How much Victor expects to contribute into savings and investments in a
-- projected year — typed in the year popup and compared there against the
-- Contributed figure the Invest / Savings page records.
--
-- Tracking only. Moving money from the bank into an investment account does
-- not change net worth, so this never enters EOY = BOY + income − spending +
-- gains + one-off. It is also not the same as income − spending: what is left
-- over can stay in the bank as cash.
--
-- Null = no estimate typed for that year. Like the one-off, it never carries
-- forward — it is a statement about one year.
alter table networth_projection
  add column if not exists contributed_cents bigint;

comment on column networth_projection.contributed_cents is
  'Estimated contributions into savings/investments that year. Tracking only — not part of EOY. Null = no estimate.';
