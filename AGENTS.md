<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Server-component pages in (app)/

Every page under `src/app/(app)/` MUST get its auth + household from `getSessionContext()` in `src/lib/auth-context.ts` — do NOT re-run the `getUser → profile → household` chain manually. The layout already calls it; `getSessionContext` is `React.cache`'d so both share one result. Skipping this doubles the auth round-trips per page load, which is our biggest latency cost.

```ts
import { getSessionContext } from "@/lib/auth-context";

export default async function SomePage() {
  const { supabase, household } = await getSessionContext();
  // ... use supabase client + household.id / household.currency here
}
```

The helper returns `{ supabase, user, profile, household }`. Household includes `id, name, currency, snowball_monthly_extra_cents, snowball_start_date` — if you need another column on `households`, add it there rather than re-querying. Same rule for server actions that read auth: prefer `getSessionContext()` over hand-rolling the chain.

# No purple / no orange in charts, stats, or accents

Victor has repeatedly rejected purple/indigo and amber-orange in the app's visualizations and stat displays. Read this before styling any chart, stat card, badge, progress bar, subtitle text, filter chip, or category dot — anywhere you'd otherwise reach for `text-brand`, `bg-brand`, `bg-brand-soft`, `--brand`, `text-accent`, `--cat-orange`, `--cat-bills` (amber), or `--cat-expenses` (amber). These are all violations in a stat/chart context.

**Use the `--viz-*` palette instead** (declared in `src/app/globals.css`, both light and dark blocks):
- `--viz-income` (deep navy) + `--viz-spending` (light blue) — the income/spending bar pair
- `--viz-savings` (blue-700), `--viz-bills` (teal-600), `--viz-expenses` (sky-400), `--viz-debt` (rose-600) — flow colors
- `--viz-grid` (chart gridlines), `--viz-sel` (selected-period wash)

For non-flow accents (subtitle text, filter chips, hover backgrounds, ranked bars), use neutral tokens: `text-muted`, `bg-black/5 dark:bg-white/10`, or a `--viz-*` color that matches the metric.

**The `--brand` indigo stays confined to app chrome** — the sidebar, the primary CTA buttons, focus rings on inputs. Everything a user reads as *data* (money values, category dots, chart marks, deltas, "% of income" text, hero-card colored numbers) uses the `--viz-*` palette.

When picking a color for a metric card whose kind is savings/bills/expenses/debt, use the matching `--viz-*` token via inline style (`style={{ color: "var(--viz-savings)" }}`), NOT `text-brand` / `text-accent`. For income use `--positive`, for spending/debt use `--negative`. See `feedback_no_purple_no_orange_charts` memory for the full rationale.
