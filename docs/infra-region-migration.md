# Infrastructure: US East region migration (2026-08-24)

## Why

Victor is stationed in Stuttgart, Germany (military), moving to Fort Bragg, NC
next summer. The app was originally deployed with Vercel functions in `sfo1`
(San Francisco) and the database in `us-west-1` — the worst possible pairing
for both the current location (transatlantic + cross-country to reach the
West Coast) and the future one (Fort Bragg is on the East Coast). US East is
correct for both timelines, so there was no tradeoff to weigh.

## What changed

| | Before | After |
|---|---|---|
| Vercel function region | `sfo1` | `iad1` (Washington DC) |
| Supabase project | `mzkvyqiovomurvxjtlni` (us-west-1) | `xgrvrbydzwprmrvsqoiz` (us-east-1) |

- **Vercel region** is set in [`vercel.json`](../vercel.json) at the repo root
  (`"regions": ["iad1"]`). This is the source of truth — check that file, not
  just the dashboard, when changing it again.
- **Supabase project ref** lives in `.env.local` on each machine
  (`NEXT_PUBLIC_SUPABASE_URL`) and in Vercel's project environment variables
  (Settings → Environment Variables, all three environments).

## Why moving Vercel alone made things temporarily worse

Doing the Vercel region move first (without also moving Supabase) briefly
made the app **slower**, not faster: Next.js prefetches every sidebar link's
React Server Component payload in the background on page load. With the
function in `iad1` and the database still in `us-west-1`, six of those
prefetches fired concurrently, each making a cross-country round trip — two
measured at **13.9s and 13.2s** on the live site. After the database also
moved to `us-east-1`, the same prefetches dropped to **~1s worst case**, and
full page load went from ~2.5s to ~1.5s.

**Lesson:** the Vercel function region and the Supabase database region must
move together. Splitting the migration across a delay makes the interim state
worse than either fully-aligned option, because every server-rendered page
makes several database round trips.

## The gotcha: `pg_dump --schema=public` does not include Supabase auth

The migration used `pg_dump --schema=public` to copy schema and data into the
new project, which is correct for every app table — but Supabase's login
accounts live in the separate `auth` schema (`auth.users`, `auth.identities`),
which that flag deliberately excludes. The new project ended up with a full
copy of `profiles` and `households` (which reference `auth.users.id` by
foreign key) but **zero actual accounts to sign in with** — the public data
looked complete, but sign-in failed with "Invalid login credentials."

**Fix:** the two `auth.users` rows and their matching `auth.identities` rows
were copied directly from the old project into the new one, preserving the
exact same `id` (UUID) so the already-restored `profiles.user_id` foreign
keys resolved correctly, and preserving the `encrypted_password` bcrypt hash
so existing passwords kept working without a reset. This is a manual,
one-time step — not something the app or its migrations need to handle again
unless another full project migration happens.

**If you ever migrate Supabase projects again:** either include `--schema=auth`
in the dump (and handle the fact that GoTrue owns and manages that schema —
some columns, like `confirmed_at`, are generated and will reject a direct
`INSERT` of a literal value), or repeat the manual copy above. Verify by
actually signing in on the new project before considering the migration done
— a row-count match on `public.profiles` will look successful while sign-in
is completely broken.

## Rollback

The old project (`mzkvyqiovomurvxjtlni`, us-west-1) was verified against the
new one — every table's row count and every category's planned-budget total
matched exactly — before being deleted on 2026-08-24. There is no live
fallback after that point; any future recovery would require Supabase support
or a point-in-time restore, if one exists for a free-tier project (unlikely —
confirm before assuming).

## Local backup

A full schema+data dump of the pre-migration database was saved to
`~/capitall-backup.sql` on the Mac during the migration. It is **not**
committed to the repo (it contains real financial data) and is not covered by
any automated backup — if it still exists, it is the only offline copy of the
pre-migration state. Worth relocating somewhere more durable than a home
directory if it's being kept long-term.
