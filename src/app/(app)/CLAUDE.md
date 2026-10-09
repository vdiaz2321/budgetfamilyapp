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
