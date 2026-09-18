# Database backups

On the 1st of each month at 9:00, your Mac saves a copy of every table in
the app's database to `~/BudgetBackups/budget-YYYY-MM-DD.sql.gz`. It keeps the
last 12, and puts a second copy in **iCloud Drive → Budget Backups** (also
the last 12) so a backup survives losing the Mac. A Mac notification says
whether it worked. If the Mac is asleep at
9:00, the backup runs when it wakes.

One machine is enough. Set this up on the Mac you use most.

## Setup (once per Mac)

1. **Get the database password.** Open the project's database settings:
   https://supabase.com/dashboard/project/xgrvrbydzwprmrvsqoiz/database/settings
   (or: open the project → gear icon **Project Settings** → **Database**).
   Click **Reset database password**, let it generate one, and copy it.
   Save it in your password manager too.

2. **Install the schedule** (already done on the MacBook; run again after
   any change to `backup-db.sh`):

   ```bash
   bash scripts/install-backup.sh
   ```

3. **Save the password and run the first backup:**

   ```bash
   bash scripts/save-backup-password.sh
   ```

   Paste the password when asked (it stays hidden) and press Return. The
   script checks the password, saves it to `~/.config/budget-backup/db-url`
   (readable only by you), and runs the first backup. Run it again any time
   the password is reset.

The log is at `~/BudgetBackups/backup.log`.

## Seeing the live database

Supabase dashboard → your project → **Table Editor**:
https://supabase.com/dashboard/project/xgrvrbydzwprmrvsqoiz/editor

Each table (transactions, accounts, subscriptions, …) opens as a
spreadsheet. **Edits there change the live app immediately, with no undo.**
Use it for looking; make changes in the app.

## Restoring

The backup is plain SQL. It holds your login accounts (`auth.users`) and
everything the app stores (the `public` schema). To load it into a **new
Supabase project**:

```bash
gunzip -c ~/BudgetBackups/budget-YYYY-MM-DD.sql.gz | psql "<new project's Session pooler connection string>"
```

Then put the new project's URL and anon key in `.env.local` and the hosting
settings. You sign in with the same email and password as before.

It also loads into plain Postgres (Neon, a local install), but the app's
login code and security rules are written for Supabase, so the app itself
would need rework there. The data would be safe either way.

## Moving off Supabase

Two kinds of login are involved, and they're separate:

- **The app's login** (the Capitall sign-in page) uses email and password.
  Those accounts are in the backup, so they come back with a restore and
  work exactly as before.
- **Your Supabase and Vercel dashboard login** is your GitHub account.
  It isn't in the backup and doesn't need to be. It only gets you into
  the dashboards. Keep two-factor login and recovery codes on GitHub,
  because losing that account means losing the dashboards. The backup
  still protects the data itself.

The database password (used in `~/.config/budget-backup/db-url`) is its own
password, separate from GitHub. Reset it under Project Settings → Database
if you lose it.

### Option 1 — another Supabase project (no code changes)

Use this if Supabase's free plan changes or the project breaks.

1. Create a new Supabase project (Supabase-hosted or
   [self-hosted](https://supabase.com/docs/guides/self-hosting); it's open
   source).
2. Restore the latest backup into it (see **Restoring** above).
3. Put the new project's URL and anon key in `.env.local` and in the
   hosting settings (Vercel → Project → Settings → Environment Variables).
4. In the new project, go to Authentication → URL Configuration and add the
   app's web address.
5. Update the `project_id` Claude uses for database work (the Supabase MCP
   connection) to the new project.

### Option 2 — plain Postgres (Neon, Railway, Render, AWS)

Use this only if Supabase itself is gone. The data restores as-is, but three
parts of the app depend on Supabase and would need rebuilding:

- **Login.** `src/app/(auth)/login` and `src/app/auth/callback` call
  Supabase Auth. They would need another login service (for example
  Auth.js or Clerk).
- **Data reads and writes.** Every page talks to the database through the
  Supabase client (`src/lib/supabase/`). Those calls would move to a
  Postgres library.
- **Security rules.** Each table's row-level security uses
  `auth_household_id()`, which reads Supabase's login. The same household
  check would have to move into the app code.

That's a multi-week rebuild, so treat it as a last resort. The backup
ensures no data is lost while it happens.

## Moving the backup to the PC (before selling this Mac)

The backup files don't depend on this Mac. They're plain `.sql.gz` files,
and the iCloud copies stay in iCloud after the Mac is gone. Only the
**monthly schedule** runs here, so it has to move before the Mac is sold:

1. **On the PC, set up a Windows version of the backup.** It needs
   PostgreSQL's `pg_dump` for Windows and a Task Scheduler job in place of
   launchd. Build it from a Claude session running *on the PC*, so it can be
   tested there. Get the database password from the password manager.
2. **Check that the PC's first backup worked** before touching the Mac.
3. **On this Mac, remove the schedule and the saved password:**

   ```bash
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.budgetfamilyapp.backup.plist; rm ~/Library/LaunchAgents/com.budgetfamilyapp.backup.plist ~/.local/bin/budget-backup.sh; rm -r ~/.config/budget-backup
   ```

4. Erase the Mac as usual (System Settings → General → Transfer or Reset →
   Erase All Content and Settings). Signing out of iCloud there keeps the
   iCloud copies safe in your account.
