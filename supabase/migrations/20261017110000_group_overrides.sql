-- Typed contributions and withdrawals per account group, per year.
--
-- The year popup's By Account Group table worked out every group's
-- contributions and withdrawals from the group settings. Victor wants to type
-- them himself (2026-10-17): a Proj Contributed / Proj Withdraw box per group,
-- with the real figures beside them once the year arrives.
--
-- Stored only on the year the figure was typed:
--   { "roth": { "add": 1914900 }, "pretax": { "take": 2000000 } }
-- The recompute carries each typed figure into every later year until another
-- year types a new one (a withdrawal grows with inflation from the year it was
-- typed, as typed spending does; a contribution stays flat). A missing key
-- means the group settings decide. Null = nothing typed that year.

alter table networth_projection
  add column if not exists group_overrides jsonb;

comment on column networth_projection.group_overrides is
  'Typed per-group contributions/withdrawals for that year, in cents: {kind: {add?, take?}}. Carried forward by the recompute.';
