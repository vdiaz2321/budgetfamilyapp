-- A Trump Account is a traditional IRA by law (IRC 530A), but until the year the
-- child turns 18 it has its own contribution limit instead of the IRA limit, so
-- it needs its own retirement_kind rather than sharing 'traditional_ira'.

alter table accounts drop constraint if exists accounts_retirement_kind_check;
alter table accounts add constraint accounts_retirement_kind_check
  check (retirement_kind is null or retirement_kind in
    ('traditional_ira', 'roth_ira', 'elective_deferral', 'trump_account'));

alter table buckets drop constraint if exists buckets_retirement_kind_check;
alter table buckets add constraint buckets_retirement_kind_check
  check (retirement_kind is null or retirement_kind in
    ('traditional_ira', 'roth_ira', 'elective_deferral', 'trump_account'));

comment on column accounts.retirement_kind is
  'Which annual contribution limit governs this account: traditional_ira / roth_ira (shared per-person IRA limit), elective_deferral (401k/TSP/403b/457) or trump_account (its own limit). NULL = infer from the name.';
