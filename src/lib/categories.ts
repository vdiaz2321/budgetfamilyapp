import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Start tab has exactly these five columns, in this order.
export const CATEGORY_KINDS = [
  { kind: "income", name: "Income", sortOrder: 0 },
  { kind: "savings", name: "Savings", sortOrder: 1 },
  { kind: "bills", name: "Bills", sortOrder: 2 },
  { kind: "expenses", name: "Expenses", sortOrder: 3 },
  { kind: "debt", name: "Debt", sortOrder: 4 },
] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number]["kind"];

// Kinds whose subcategories can have a due/planned day (day-of-month).
// Expenses keep the field for planning, but only Bills feed the manual
// upcoming-due card on Budget.
export const KINDS_WITH_DUE: CategoryKind[] = ["bills", "expenses", "debt"];

export type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  sort_order: number;
  is_system: boolean;
};

// Ensure the five canonical categories exist for a household. Idempotent.
// Wrapped in React.cache so a single request can call it from multiple places
// (page + helper) without re-running the read/insert pair — the getSessionContext
// helper hands the same supabase client to every caller, so cache keys match.
export const ensureCategories = cache(async (
  supabase: SupabaseClient,
  householdId: string,
): Promise<CategoryRow[]> => {
  const { data: existing } = await supabase
    .from("categories")
    .select("id, name, kind, sort_order, is_system")
    .eq("household_id", householdId);

  const byKind = new Map((existing ?? []).filter((c) => c.is_system).map((c) => [c.kind, c]));
  const missing = CATEGORY_KINDS.filter((c) => !byKind.has(c.kind));

  // Common path: all five system categories already exist. Skip the second
  // ordered read and just sort what we already have — one query instead of two.
  if (!missing.length && existing?.length) {
    return [...existing].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    ) as CategoryRow[];
  }

  if (missing.length) {
    await supabase.from("categories").insert(
      missing.map((c) => ({
        household_id: householdId,
        name: c.name,
        kind: c.kind,
        sort_order: c.sortOrder,
        is_system: true,
      })),
    );
  }

  const { data: fresh } = await supabase
    .from("categories")
    .select("id, name, kind, sort_order, is_system")
    .eq("household_id", householdId)
    .order("sort_order");

  return (fresh ?? []) as CategoryRow[];
});
