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

# Verify UI changes at mobile width, not just desktop

Every UI change on any `(app)/` page MUST be verified at **mobile width (375×812)** before it's called done, in addition to desktop. Victor uses the app on both, and the majority of "the layout broke" reports have been mobile-only issues that never surfaced in the browser preview because it wasn't resized. Row overflows, cut-off amounts, wrapped headers, footer buttons that run off the edge — these all only appear in the mobile viewport.

**The pattern:** after editing a page or shared component that renders anywhere in `(app)/`, run `resize_window` to `mobile`, reload, screenshot, and confirm no element is clipped or awkward. Then restore to `desktop` before finishing. If the mobile view has issues, fix them in the same turn — don't ship the desktop fix and defer mobile.

Common breakage patterns worth eyeballing on mobile: `grid-cols-[fixed-widths]` (use `grid-cols-1 sm:grid-cols-…` instead), `whitespace-nowrap` on long labels, footer button rows without `flex-wrap`, hero cards with 4–5 columns (use `grid-cols-2 sm:grid-cols-…`).

# Never add tooltips (title="…") unless Victor asks

Do NOT add `title="…"` attributes, hover tooltips, or any other hover-only affordance to buttons, chips, filter controls, stat tiles, or icons unless Victor explicitly asks for one. Victor has repeatedly asked to have these removed after they were added unprompted. Rationale: unsolicited tooltips clutter the UI, don't show on mobile at all, and imply the button isn't self-explanatory — which it should be.

**If the intent isn't clear without a tooltip, the fix is to relabel the control, not to bolt a `title=""` on top.** Make the button obviously clickable — clearer text, an icon, active/inactive styling — instead. When removing tooltips, delete the whole `title="…"` prop; don't leave it "just in case".

This applies to every new control you add and every existing one you touch. If Victor explicitly asks for a tooltip on something specific, that's the only case where it's fine.
