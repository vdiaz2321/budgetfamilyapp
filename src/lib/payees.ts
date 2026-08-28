import type { SupabaseClient } from "@supabase/supabase-js";

/** The key two spellings of the same payee share. */
export function payeeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Find-or-create payees by name, matching existing rows case-insensitively.
 *
 * Typing "aldi" when "Aldi" already exists used to create a second payee, and
 * the Annual Overview then listed the same shop twice, each with part of the
 * year's spend. Callers used to upsert on (household_id, name) — an exact
 * match — which is what let the pair through.
 *
 * Returns a map keyed by `payeeKey(name)`, so callers look up with whatever
 * casing the user typed. The stored spelling is whatever got there first; this
 * never renames an existing payee.
 */
export async function resolvePayeeIds(
  supabase: SupabaseClient,
  householdId: string,
  names: string[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>(); // key -> name as typed
  for (const raw of names) {
    const name = raw.trim();
    if (name) wanted.set(payeeKey(name), name);
  }
  const resolved = new Map<string, string>();
  if (wanted.size === 0) return resolved;

  const { data: existing } = await supabase
    .from("payees")
    .select("id, name")
    .eq("household_id", householdId);
  for (const row of existing ?? []) {
    const key = payeeKey(row.name as string);
    if (wanted.has(key)) resolved.set(key, row.id as string);
  }

  const missing = [...wanted.entries()].filter(([key]) => !resolved.has(key));
  if (missing.length > 0) {
    const { data: inserted } = await supabase
      .from("payees")
      .upsert(
        missing.map(([, name]) => ({ household_id: householdId, name })),
        { onConflict: "household_id,name" },
      )
      .select("id, name");
    for (const row of inserted ?? []) resolved.set(payeeKey(row.name as string), row.id as string);
  }

  return resolved;
}

/** Single-payee convenience wrapper. */
export async function resolvePayeeId(
  supabase: SupabaseClient,
  householdId: string,
  name: string,
): Promise<string | null> {
  const map = await resolvePayeeIds(supabase, householdId, [name]);
  return map.get(payeeKey(name)) ?? null;
}
