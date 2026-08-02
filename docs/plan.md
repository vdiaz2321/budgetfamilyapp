# Capitall — Current Work & Roadmap

Last updated: 2026-08-02

---

## What was just finished (Aug 2026)

- Budget sticky bar: "Planned Budget | Income Left | Actual Spent"
- Subscriptions modal: widened, compacted rows
- Monthly subscription due-day bug fixed (was showing 00/15)
- Net Worth 12-month grid: expanded to 12 months, newest left, horizontal scroll
- SQL seed: `supabase/seeds/account_history_2026_h1.sql` (Jan–Jun 2026 backfill)
- Sticky column bleed fix on Net Worth grid
- Hover-X delete button on budget rows
- Rollover manual override (`override_cents` on `budget_rollovers`, migration `0032`)
- Subscriptions `/mo` total now shows only monthly subs (not annuals prorated)
- Subscriptions & Irregular Bills planned amounts are now auto-calculated (read-only)

---

## Active plan: Path A — Deploy + Mobile Polish

### Step 1 — Deploy to Vercel (15 min, do this first)

Repo is already on GitHub. Steps are manual (Victor does in browser):

1. Sign up at vercel.com with GitHub account (free, no card)
2. "Add New Project" → import the Budget Family App repo
3. Add env vars in Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://mzkvyqiovomurvxjtlni.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = publishable key from Supabase → Project Settings → API
4. Click Deploy (first build ~2 min)
5. Supabase Dashboard → Authentication → URL Configuration → add the Vercel URL to Site URL + Redirect URLs
6. Both Victor + Johana: Safari → Share → Add to Home Screen

Every `git push` to `main` re-deploys automatically.

### Step 2 — Mobile-responsive polish (priority order)

**Do these in order — each is independently useful:**

1. **Mobile bottom tab bar** — `src/app/(app)/layout.tsx`
   - Wrap current sidebar in `hidden md:block`
   - Add fixed-bottom nav visible only under `md:` with 4 icons: Budget, Transactions, Accounts, More
   - "More" opens full-screen sheet: Savings, Snowball, Net Worth, Annual, Insights, sign-out
   - Uses `lucide-react` icons already in the sidebar

2. **Budget row stacked layout** — `src/app/(app)/budget/budget-row.tsx`
   - Under `sm:` the 12-col grid crushes. Stack to 2-line layout:
     - Line 1: name + `$spent / $planned`
     - Line 2: full-width progress bar
   - Hide the % column on mobile (redundant with bar)
   - Keep the hover-X delete button but make it always-visible on mobile

3. **Budget group headers simplified** — `src/app/(app)/budget/budget-group.tsx`
   - On mobile, drop inline totals (`Spent: $X · Plan: $Y · Left: $Z`)
   - Show: dot + name + item count left, `$spent / $planned` right
   - Full totals only when group is expanded

4. **Add Transaction modal full-height** — `src/app/(app)/budget/transaction-modal.tsx`
   - `h-full` on mobile, `max-h-[85vh]` on desktop
   - Confirm amount inputs use `inputMode="decimal"` for number pad
   - Sticky Save button at bottom

5. **Transactions page → card layout** — `src/app/(app)/transactions/*.tsx`
   - Under `sm:` collapse row to a card:
     - Line 1: date + amount (right-aligned, color by kind)
     - Line 2: subcategory + payee
   - Hide Cleared / account columns on mobile

**Lower priority (after Johana confirms daily use works):**

6. Accounts page — single-column on mobile, Net Worth pill at top
7. Net Worth grid — hide below `md:`, show summary card + "View on desktop" hint
8. Snowball, Savings — read-only on mobile is fine

All changes are Tailwind responsive utilities only (`hidden md:block`, etc.) — no new deps.

---

## Path B — Native Expo app (later, only if Path A hits a wall)

Defer until:
- Receipt scanning in a browser is painful enough to need native camera + OCR
- Johana wants a true installed app (not home-screen bookmark)
- Push notifications needed ("bill due tomorrow")
- Ready to publish to App Store for friends & family

Stack when we get there: Expo SDK 52, expo-router v4, NativeWind v4, Supabase direct, React Query, EAS Build → TestFlight.

---

## Pending web app tasks (in priority order)

| # | Task | Status |
|---|------|--------|
| 13 | Accounts page | in progress |
| 14 | Monthly snapshot engine | pending |
| 15 | Net Worth page improvements | pending |
| 16 | Annual Overview page (Year tab) | pending |
| 17 | Insights page (charts) | pending |
| 18 | Goals page (light family info) | pending |
| 19 | Budget cleanup: income/refund/transfer txns | pending |
| 6  | Optional history importer (Log → DB) | later |
| 20 | Invest Accrued tracker | deferred |
| 21 | APY Yields interest ledger | deferred |

---

## Key technical notes

- **Migration 0032** (`supabase/migrations/0032_rollover_override.sql`): adds `override_cents` to `budget_rollovers`. Must be run in Supabase SQL Editor if not already done.
- **Auto-planned rows**: Subscriptions and Irregular Bills budget rows derive their planned amount from the subscriptions/irregular-bills data — the planned input is read-only on those rows.
- **Supabase project**: `mzkvyqiovomurvxjtlni.supabase.co`
- **Stack**: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase Postgres with RLS
