import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Full household dump as JSON — one download that captures everything so the
// user can leave the app without losing their data.
const HOUSEHOLD_TABLES = [
  "households",
  "profiles",
  "categories",
  "subcategories",
  "payees",
  "accounts",
  "transactions",
  "transaction_splits",
  "budget_plans",
  "budget_rollovers",
  "debts",
  "snowball_extra_periods",
  "savings_goals",
  "buckets",
  "bucket_snapshots",
  "account_snapshots",
  "debt_snapshots",
  "networth_history",
  "annual_breakdown_history",
  "subscriptions",
  "irregular_bills",
  "investment_years",
  "credit_card_details",
] as const;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "no household" }, { status: 404 });
  }

  const results: Record<string, unknown> = {
    _meta: {
      exportedAt: new Date().toISOString(),
      exportedBy: user.email,
      householdId: profile.household_id,
      appVersion: process.env.npm_package_version ?? null,
    },
  };

  for (const table of HOUSEHOLD_TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    // Missing tables (e.g. transaction_splits, not in every install) or RLS
    // gaps just get logged and skipped — an export shouldn't crash mid-flight.
    results[table] = error ? { _skipped: error.message } : data ?? [];
  }

  const filename = `capitall-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(results, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
