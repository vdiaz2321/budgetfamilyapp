@AGENTS.md

# Never commit or push — Victor does that himself

Do NOT run `git commit`, `git push`, `git reset`, or anything else that
rewrites history in this repo. Not after a verified change, not "to keep the
work safe", not because the change is finished. Victor stages and commits
every change himself through VS Code's Source Control panel (see
[docs/machine-setup.md](docs/machine-setup.md)) — the history is his to shape,
and he works across two machines on one repo, so an unasked-for commit lands
in a log he has to untangle later.

Leave finished work uncommitted in the working tree and say what changed. If
a commit genuinely seems warranted, offer it in a sentence and wait for a yes.

Reading git is always fine — `git status`, `git log`, `git diff`, `git show`
are how you answer questions about the code's history.

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
