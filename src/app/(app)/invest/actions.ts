"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

// Store (or override) one investment account's contributed / accrued for a year.
// Writing a row "locks in" that year — the /invest page shows the stored value
// instead of the live-derived one. Only the edited field is changed; the other
// keeps whatever was already stored (or 0 for a brand-new row).
export async function setInvestmentYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const accountId = String(formData.get("accountId") ?? "");
  const year = Number(formData.get("year"));
  const field = String(formData.get("field") ?? "");
  if (!accountId || !Number.isInteger(year) || year < 2000 || year > 2100) return;
  if (field !== "contributed" && field !== "accrued") return;

  const valueCents = displayToCents(String(formData.get("value") ?? "0"));

  // Confirm the account belongs to this household before writing.
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return;

  // Preserve the sibling column when it already exists.
  const { data: existing } = await supabase
    .from("investment_years")
    .select("contributed_cents, accrued_cents, est_contribute_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("year", year)
    .maybeSingle();

  const row = {
    household_id: householdId,
    account_id: accountId,
    year,
    contributed_cents:
      field === "contributed" ? valueCents : existing?.contributed_cents ?? 0,
    accrued_cents: field === "accrued" ? valueCents : existing?.accrued_cents ?? 0,
    est_contribute_cents: existing?.est_contribute_cents ?? 0,
    updated_at: new Date().toISOString(),
  };

  await supabase
    .from("investment_years")
    .upsert(row, { onConflict: "household_id,account_id,year" });

  revalidatePath("/invest");
}
