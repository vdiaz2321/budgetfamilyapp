import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The signed-in user, verified. `getClaims()` checks the session token's
 * signature locally against the project's cached public key (this project
 * signs with an asymmetric ES256 key — see src/lib/supabase/middleware.ts),
 * so it costs no trip to the auth server. `getUser()` asked the auth server
 * every time: ~300ms in front of every page and every save. It stays as the
 * fallback if local verification ever fails, which is what the middleware
 * does too.
 */
async function verifiedUser(supabase: SupabaseClient): Promise<{ id: string; email: string | null } | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims?.sub) {
      return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
    }
  } catch {
    // fall through to the auth server
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

// Request-scoped auth + household resolver. Both the app layout and every
// (app)/page.tsx need { user, profile, household } to render — without this,
// each page independently re-runs the same sequential Supabase queries,
// doubling the round-trip cost on every navigation. React.cache dedupes calls
// made during a single render, so the chain runs exactly once per request.
export const getSessionContext = cache(async () => {
  const supabase = await createClient();

  const user = await verifiedUser(supabase);
  if (!user) redirect("/login");

  // Profile and its household in ONE query (profiles.household_id is a
  // foreign key), where it used to be two round trips back to back.
  const { data: row, error: profileError } = await supabase
    .from("profiles")
    .select("household_id, display_name, avatar_url, households(id, name, currency, snowball_monthly_extra_cents, snowball_start_date)")
    .eq("user_id", user.id)
    .maybeSingle();
  // A failed read is not "this user has no household" — redirecting on it
  // would drop a signed-in user into onboarding and invite a second household.
  if (profileError) throw new Error(`Could not load your profile: ${profileError.message}`);
  if (!row) redirect("/onboarding");

  type Household = {
    id: string;
    name: string;
    currency: string;
    snowball_monthly_extra_cents: number | null;
    snowball_start_date: string | null;
  };
  const joined = row.households as unknown as Household | Household[] | null;
  const household = Array.isArray(joined) ? joined[0] : joined;
  if (!household) redirect("/onboarding");

  const profile = { household_id: row.household_id as string, display_name: row.display_name, avatar_url: row.avatar_url };
  return { supabase, user, profile, household };
});
