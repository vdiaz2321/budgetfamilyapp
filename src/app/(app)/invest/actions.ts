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
// (plus live current-year transactions) instead of the live-derived one alone.
// When bucketId is passed, the row is bucket-level (Fidelity → Roth IRA Vic);
// otherwise it's account-level.
export async function setInvestmentYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const accountId = String(formData.get("accountId") ?? "");
  const bucketIdRaw = String(formData.get("bucketId") ?? "");
  const bucketId = bucketIdRaw && bucketIdRaw !== "null" ? bucketIdRaw : null;
  const year = Number(formData.get("year"));
  const field = String(formData.get("field") ?? "");
  if (!accountId || !Number.isInteger(year) || year < 2000 || year > 2100) return;
  if (!["contributed", "accrued", "start", "end"].includes(field)) return;

  const valueCents = displayToCents(String(formData.get("value") ?? "0"));

  // Confirm the account belongs to this household before writing.
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return;

  // If a bucket was passed, confirm it belongs to this account.
  if (bucketId) {
    const { data: bucket } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketId)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (!bucket) return;
  }

  // Preserve sibling columns when a row already exists for this bucket slot.
  // Two partial unique indexes back this — one for bucket_id IS NULL and one
  // for bucket_id IS NOT NULL — so a plain upsert can't target both. Instead
  // we select first, then update (by id) or insert.
  let existingQuery = supabase
    .from("investment_years")
    .select("id, contributed_cents, accrued_cents, est_contribute_cents, start_cents, end_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("year", year);
  existingQuery = bucketId
    ? existingQuery.eq("bucket_id", bucketId)
    : existingQuery.is("bucket_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const patch = {
    contributed_cents:
      field === "contributed" ? valueCents : existing?.contributed_cents ?? 0,
    accrued_cents: field === "accrued" ? valueCents : existing?.accrued_cents ?? 0,
    est_contribute_cents: existing?.est_contribute_cents ?? 0,
    start_cents: field === "start" ? valueCents : (existing?.start_cents ?? null),
    end_cents: field === "end" ? valueCents : (existing?.end_cents ?? null),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("investment_years").update(patch).eq("id", existing.id);
  } else {
    await supabase.from("investment_years").insert({
      household_id: householdId,
      account_id: accountId,
      bucket_id: bucketId,
      year,
      ...patch,
    });
  }

  revalidatePath("/invest");
}
