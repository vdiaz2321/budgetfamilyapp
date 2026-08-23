@AGENTS.md

# Environment rules

- `.env.local` is gitignored and never committed. Never put the Supabase
  **secret** (`service_role`) key in it — only the publishable/anon key, which
  is safe client-side. The one exception is the server-side history importer.
- Database schema changes live as numbered files in `supabase/migrations/`
  (`0001`, `0002`, …). Those files are the source of truth — NOT whatever has
  been run ad hoc in the Supabase SQL Editor. Both machines share one live
  database, so each migration is applied once, from whichever machine is doing
  the work.

Machine setup (first-time install on a new Mac or PC, day-to-day git sync) is
in [docs/machine-setup.md](docs/machine-setup.md).
