import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfAny } from "@/lib/supabase-result";

/**
 * This month's Budget plan and what's been paid so far, per budget item.
 *
 * The Pay Card popup prefills the plan for a card carried as a debt, and shows
 * the paid-so-far figure next to it so a payment already made this month isn't
 * made twice. Accounts and Travel Log both build card data, so both read it
 * from here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadDebtMonthPlans(
  supabase: SupabaseClient<any, any, any>,
  householdId: string,
): Promise<Map<string, { plannedCents: number; paidCents: number }>> {
  const out = new Map<string, { plannedCents: number; paidCents: number }>();

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [plans, actuals] = await Promise.all([
    supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", firstOfMonth),
    supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents")
      .eq("household_id", householdId)
      .eq("month", firstOfMonth),
  ]);
  throwIfAny({ budget_plans: plans.error, v_monthly_actuals: actuals.error });

  // One row per budget item for a single month — well under the row cap.
  const entry = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { plannedCents: 0, paidCents: 0 }));
    return e;
  };
  for (const p of plans.data ?? []) if (p.subcategory_id) entry(p.subcategory_id).plannedCents += p.planned_cents ?? 0;
  for (const a of actuals.data ?? []) if (a.subcategory_id) entry(a.subcategory_id).paidCents += Number(a.actual_cents ?? 0);
  return out;
}
