@AGENTS.md

# Machine setup (Mac ↔ PC)

This repo is worked on from both a Mac and a PC, in VS Code, using Claude Code CLI (not the VS Code extension) and Claude Desktop for general chat. Both machines point at the same GitHub repo and the same Supabase project — the only thing that doesn't sync automatically is `.env.local` (gitignored on purpose).

## First-time setup on a new machine

1. **Clone the repo** — VS Code: `Ctrl/Cmd+Shift+P` → "Git: Clone" → paste the GitHub repo URL.
2. **Install Node.js LTS** — download the "Prebuilt Installer" from nodejs.org (skip nvm). Verify with `node --version` / `npm --version`.
3. **Fix npm global permissions if `EACCES` shows up on `npm install -g`:**
   ```bash
   mkdir -p ~/.npm-global
   npm config set prefix ~/.npm-global
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zprofile   # or ~/.bash_profile on bash
   source ~/.zprofile
   ```
4. **Install Claude Code CLI:**
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude --version
   ```
   Run `claude` from the project folder's integrated terminal to start a session. This is separate from Claude Desktop — Desktop is for general chat, Claude Code CLI is scoped to this project folder.
5. **Install project dependencies:**
   ```bash
   npm install
   ```
6. **Create `.env.local`** in the project root (never committed — see `.env.example` for the shape):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://mzkvyqiovomurvxjtlni.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key from Supabase dashboard → Project Settings → API>
   ```
   The "publishable" key is Supabase's current name for what used to be called "anon" — safe to expose client-side. Never put the "secret" (service_role) key in this file unless working on the server-side history importer.
7. **Run it:** `npm run dev`, then open `http://localhost:3000`.

## Day-to-day sync

- Pull latest before starting work: VS Code Source Control panel → Sync/Pull, or `git pull`.
- Commit + push through VS Code's Source Control panel (`Ctrl/Cmd+Shift+G`): stage → write a message → Commit → Sync Changes (push).
- Database schema changes are tracked as numbered files in `supabase/migrations/` (`0001`, `0002`, …) — that's the source of truth, not whatever's been run ad hoc in the Supabase SQL Editor. Apply new migration files by pasting them into Supabase → SQL Editor → New query on whichever machine is doing the work; both machines share the same live database so it only needs doing once.
