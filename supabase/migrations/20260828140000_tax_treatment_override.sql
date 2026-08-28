-- Explicit tax treatment for investment accounts and buckets.
--
-- Today /invest decides whether a holding is taxable, tax-deferred, tax-free or
-- education by REGEXING ITS NAME (`classifyTax` in invest-board.tsx): "roth"
-- means tax-free, "401k/tsp/ira/traditional" means tax-deferred, "529/utma"
-- means education, and anything matching nothing silently falls through to
-- taxable. Nothing is stored anywhere.
--
-- That makes a display of real tax exposure depend on spelling. Renaming the
-- "TSP Roth" bucket to something without "Roth" in it would quietly reclassify
-- $40,126 from tax-free to taxable, with no warning and no way to correct it
-- short of renaming the bucket back. Equally, a holding whose name carries no
-- hint — "Fundrise", "Tangem Card", "Kraken" — is only filed correctly by
-- luck of its account's subtype.
--
-- This adds a stored override at both levels. It does NOT remove the
-- inference: NULL keeps today's behaviour exactly, so nothing changes on the
-- day this runs and the guess stays as the default for anything unset. The
-- column is only consulted when it holds a value.
--
-- Both levels are needed because one account can hold more than one treatment:
-- TSP holds Traditional and Roth, Fidelity holds a taxable brokerage bucket
-- alongside two Roth buckets. A single per-account field could not express
-- either, which is exactly why the bucket column exists.
--
-- Resolution order the app should apply (most specific wins):
--   1. bucket.tax_treatment      -- explicit, on the exact holding
--   2. classifyTax(bucket.name)  -- inferred, on the exact holding
--   3. account.tax_treatment     -- explicit, on the container
--   4. classifyTax(account.subtype)
--   5. 'taxable'                 -- final fallback, unchanged
--
-- An account-level override therefore acts as the default for that account's
-- buckets whose own names imply nothing — it deliberately does not override a
-- bucket that names its own treatment, since the bucket is the more specific
-- statement about the money.

do $$ begin
  create type tax_treatment as enum ('taxable', 'deferred', 'free', 'education');
exception when duplicate_object then null; end $$;

alter table accounts add column if not exists tax_treatment tax_treatment;
alter table buckets   add column if not exists tax_treatment tax_treatment;

comment on column accounts.tax_treatment is
  'Explicit tax treatment override. NULL = infer from the account subtype (default). Acts as the default for this account''s buckets that do not imply a treatment in their own name.';

comment on column buckets.tax_treatment is
  'Explicit tax treatment override for this holding. NULL = infer from the bucket name, then the parent account. Wins over every inferred value.';
