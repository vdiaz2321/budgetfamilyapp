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

// Kinds whose subcategories have a Due day (day-of-month).
export const KINDS_WITH_DUE: CategoryKind[] = ["bills", "debt"];

export type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  sort_order: number;
};

// Ensure the five canonical categories exist for a household. Idempotent.
export async function ensureCategories(
  supabase: SupabaseClient,
  householdId: string,
): Promise<CategoryRow[]> {
  const { data: existing } = await supabase
    .from("categories")
    .select("id, name, kind, sort_order")
    .eq("household_id", householdId);

  const byKind = new Map((existing ?? []).map((c) => [c.kind, c]));
  const missing = CATEGORY_KINDS.filter((c) => !byKind.has(c.kind));

  if (missing.length) {
    await supabase.from("categories").insert(
      missing.map((c) => ({
        household_id: householdId,
        name: c.name,
        kind: c.kind,
        sort_order: c.sortOrder,
      })),
    );
  }

  const { data: fresh } = await supabase
    .from("categories")
    .select("id, name, kind, sort_order")
    .eq("household_id", householdId)
    .order("sort_order");

  return (fresh ?? []) as CategoryRow[];
}
