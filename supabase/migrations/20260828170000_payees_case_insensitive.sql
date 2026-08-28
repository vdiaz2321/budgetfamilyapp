-- Payees: one row per name, regardless of how it was typed.
--
-- The unique index was (household_id, name), which is case sensitive, so
-- "Kaufland", "kaufland", "DM", "Dm" and "dm" were separate payees. They then
-- showed up as separate lines on the Annual Overview breakdown — "iCloud" and
-- "icloud" sitting one above the other, each with part of the year's total.
--
-- Two parts: merge what is already there, then make the collision impossible.

-- 1. Merge. The surviving row per (household, lower(name)) is chosen for how it
--    READS, not for how much it is used: a name with a capital in it beats an
--    all-lowercase one ("iCloud" over "icloud"), one that starts with a capital
--    beats one that doesn't, and only then does transaction count break the tie
--    ("Aldi" over "ALdi"). The C collation on the final tiebreak keeps
--    acronyms ("CYS", "MWR") ahead of their title-case twins.
with ranked as (
  select
    p.id,
    p.household_id,
    lower(trim(p.name)) as key,
    first_value(p.id) over (
      partition by p.household_id, lower(trim(p.name))
      order by
        (p.name ~ '[A-Z]') desc,
        (p.name ~ '^[A-Z]') desc,
        (select count(*) from transactions t where t.payee_id = p.id) desc,
        p.name collate "C"
    ) as keep_id
  from payees p
)
update transactions t
set payee_id = r.keep_id
from ranked r
where t.payee_id = r.id
  and r.id <> r.keep_id;

with ranked as (
  select
    p.id,
    first_value(p.id) over (
      partition by p.household_id, lower(trim(p.name))
      order by
        (p.name ~ '[A-Z]') desc,
        (p.name ~ '^[A-Z]') desc,
        (select count(*) from transactions t where t.payee_id = p.id) desc,
        p.name collate "C"
    ) as keep_id
  from payees p
)
delete from payees p
using ranked r
where p.id = r.id
  and r.id <> r.keep_id;

-- 2. Prevent the next one. The old exact-name index stays: the app's payee
--    upserts still target (household_id, name), and the app now resolves an
--    existing payee case-insensitively before inserting, so this index is the
--    backstop rather than the thing callers hit.
create unique index if not exists payees_household_id_lower_name_key
  on public.payees (household_id, lower(trim(name)));
