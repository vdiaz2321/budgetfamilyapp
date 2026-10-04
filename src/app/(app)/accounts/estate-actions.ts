"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";

// Estate guide (Accounts → "Estate guide"). Every field saves on its own when
// it loses focus, like the other inline fields in the app, so a half-finished
// guide is never lost.

const TRANSFERS = new Set(["beneficiary", "pod", "tod", "joint", "will", "close"]);
const ITEM_KINDS = new Set(["insurance", "benefit", "property", "digital", "other"]);

const text = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

// One field of one account. Only the field that was edited is written, so two
// people filling in different rows can't overwrite each other.
export async function saveAccountEstateField(accountId: string, field: string, value: string) {
  const { supabase, household } = await getSessionContext();
  const v = value.trim() || null;
  const patch: Record<string, string | null> = {};
  if (field === "transfer") patch.estate_transfer = v && TRANSFERS.has(v) ? v : null;
  else if (field === "beneficiary") patch.estate_beneficiary = v;
  else if (field === "contact") patch.estate_contact = v;
  else if (field === "notes") patch.estate_notes = v;
  else if (field === "institution") patch.institution = v;
  // The account's owner: the same `holder` the rest of the app reads.
  else if (field === "holder") patch.holder = v;
  else if (field !== "hidden") return;
  const update: Record<string, string | boolean | null> =
    field === "hidden" ? { estate_hidden: value === "1" } : patch;
  unwrap(
    await supabase.from("accounts").update(update).eq("id", accountId).eq("household_id", household.id),
    "estate account field",
  );
  revalidatePath("/accounts");
  // The owner also decides whose contribution limits an account counts toward.
  if (field === "holder") {
    revalidatePath("/invest");
    revalidatePath("/networth");
  }
}

export async function saveEstateGuideField(field: string, value: string) {
  const { supabase, household } = await getSessionContext();
  const columns = new Set(["executor", "will_location", "attorney", "power_of_attorney", "instructions"]);
  if (!columns.has(field)) return;
  unwrap(
    await supabase
      .from("estate_guides")
      .upsert(
        { household_id: household.id, [field]: value.trim() || null, updated_at: new Date().toISOString() },
        { onConflict: "household_id" },
      ),
    "estate guide",
  );
  revalidatePath("/accounts");
}

export async function addEstateItem(kind: string, name: string) {
  const { supabase, household } = await getSessionContext();
  const clean = name.trim();
  if (!clean) return;
  const { count } = await supabase
    .from("estate_items")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.id);
  unwrap(
    await supabase.from("estate_items").insert({
      household_id: household.id,
      kind: ITEM_KINDS.has(kind) ? kind : "other",
      name: clean,
      sort_order: count ?? 0,
    }),
    "estate item",
  );
  revalidatePath("/accounts");
}

export async function saveEstateItemField(id: string, field: string, value: string) {
  const { supabase, household } = await getSessionContext();
  const patch: Record<string, string | number | null> = { updated_at: new Date().toISOString() };
  if (field === "kind") {
    if (!ITEM_KINDS.has(value)) return;
    patch.kind = value;
  } else if (field === "name") {
    const v = value.trim();
    if (!v) return; // a row always keeps a name
    patch.name = v;
  } else if (field === "amount") {
    patch.amount_cents = value.trim() ? displayToCents(value) : null;
  } else if (field === "beneficiary" || field === "contact" || field === "notes") {
    patch[field] = text(value);
  } else return;
  unwrap(
    await supabase.from("estate_items").update(patch).eq("id", id).eq("household_id", household.id),
    "estate item field",
  );
  revalidatePath("/accounts");
}

export async function deleteEstateItem(id: string) {
  const { supabase, household } = await getSessionContext();
  unwrap(await supabase.from("estate_items").delete().eq("id", id).eq("household_id", household.id), "estate item delete");
  revalidatePath("/accounts");
}
