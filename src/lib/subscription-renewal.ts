import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A subscription's next_renewal_date used to move only when Pay was clicked in
 * Due this week, so a charge logged any other way left it stuck in the past and
 * the subscription dropped out of Due this week for good (Spotify sat at
 * 2026-08-28 into October). These helpers keep the date current from every
 * path: saving, paying, and every Budget page load.
 */

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The renewal one billing cycle after `iso` (YYYY-MM-DD). */
export function nextRenewalAfter(iso: string, cycle: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  switch (cycle) {
    case "weekly":    next.setDate(next.getDate() + 7); break;
    case "quarterly": next.setMonth(next.getMonth() + 3); break;
    case "annual":    next.setFullYear(next.getFullYear() + 1); break;
    case "monthly":
    default:          next.setMonth(next.getMonth() + 1); break;
  }
  return toIso(next);
}

/** First day of the current month — the floor a renewal date is rolled up to. */
export function currentMonthStart(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Roll a renewal date forward by whole cycles until it reaches `floor`. A date
 * earlier in the current month stays put: it's due (or overdue) and unpaid
 * until Pay moves it on.
 */
export function rollRenewalForward(iso: string, cycle: string, floor = currentMonthStart()): string {
  let date = iso;
  // 600 cycles covers ~11 years of weekly — a guard against a malformed date.
  for (let i = 0; date < floor && i < 600; i++) date = nextRenewalAfter(date, cycle);
  return date;
}

/**
 * Fix any active subscription whose saved date fell behind the current month,
 * both in the rows passed in and in the database, so every page and the plan
 * resolver read the same current date.
 */
export async function healStaleRenewals<
  T extends { id: string; is_active: boolean | null; next_renewal_date: string | null; billing_cycle: string },
>(supabase: SupabaseClient, householdId: string, rows: T[]): Promise<T[]> {
  const floor = currentMonthStart();
  const fixes: { id: string; date: string }[] = [];
  const healed = rows.map((row) => {
    if (!row.is_active || !row.next_renewal_date || row.next_renewal_date >= floor) return row;
    const date = rollRenewalForward(row.next_renewal_date, row.billing_cycle, floor);
    fixes.push({ id: row.id, date });
    return { ...row, next_renewal_date: date };
  });
  if (fixes.length) {
    const results = await Promise.all(
      fixes.map((fix) =>
        supabase
          .from("subscriptions")
          .update({ next_renewal_date: fix.date })
          .eq("id", fix.id)
          .eq("household_id", householdId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) console.error("Could not roll subscription renewal dates forward:", failed.error.message);
  }
  return healed;
}
