import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Request-scoped auth + household resolver. Both the app layout and every
// (app)/page.tsx need { user, profile, household } to render — without this,
// each page independently re-runs the same three sequential Supabase queries
// (getUser → profile → household), doubling the round-trip cost on every
// navigation. React.cache dedupes calls made during a single render, so the
// chain runs exactly once per request.
export const getSessionContext = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id, display_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: household } = await supabase
    .from("households")
    .select("id, name, currency, snowball_monthly_extra_cents, snowball_start_date")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  return { supabase, user, profile, household };
});
