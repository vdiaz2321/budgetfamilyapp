# Budget Family App

A family budgeting webpage (and later, mobile app) that replaces a heavily customized 3-year Google Sheet. Built to log transactions fast, roll them up into planned-vs-actual budgets, and — eventually — auto-fill a transaction from a scanned receipt.

## Status

**Phase 1 — Webpage MVP.** Data currently lives in the browser (`localStorage`). Supabase gets wired in once the UI is real.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- ESLint 9
- Storage: `localStorage` today → Supabase (Postgres + Auth + Storage) later
- Deploy target: Vercel

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint

## Roadmap

1. Scaffold + landing page ✅
2. `lib/domain` types + `lib/db` localStorage adapter
3. Settings page (categories, subcategories, accounts, planned amounts)
4. Log page (transaction entry)
5. Budget page (planned vs. actual)
6. Annual ↔ Year toggle page
7. Supabase migration + history import from the spreadsheet
8. Deploy to Vercel
9. Phase 2 — receipt scan, mobile app (Expo)
