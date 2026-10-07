"use server";

import { getSessionContext } from "@/lib/auth-context";
import { resolveMonth } from "@/lib/month";
import { loadTxFormData, type TxFormOptions } from "@/lib/tx-form-options";

// The transaction modal's pickers for a page that opens the modal without
// loading them up front (Travel Log's "Add transaction"). Fetched when the
// button is tapped, so the page itself loads no slower.
export async function loadTxFormOptions(): Promise<TxFormOptions & { month: { key: string; firstOfMonth: string } }> {
  const { supabase, household } = await getSessionContext();
  const month = resolveMonth(undefined);
  const { options } = await loadTxFormData(supabase, household.id, month.firstOfMonth);
  return { ...options, month: { key: month.key, firstOfMonth: month.firstOfMonth } };
}
