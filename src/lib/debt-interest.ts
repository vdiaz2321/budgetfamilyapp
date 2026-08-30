import type { SupabaseClient } from "@supabase/supabase-js";

// Monthly interest accrual for installment-style debts.
//
// The problem this solves: `adjustDebtBalance` applies a payment entirely to
// the balance. That is correct only if interest has separately been added to
// that balance. Credit cards do this through "Record statement interest", where
// the lender's statement is authoritative. Ordinary loans had no equivalent, so
// interest never accrued at all and every projection inherited a balance that
// drifted optimistic month after month.
//
// Deliberately NOT implemented as a per-payment interest/principal split: the
// manual statement flow already adds interest to the balance, so splitting
// payments as well would count the same interest twice. Accruing monthly keeps
// exactly one mechanism per debt, chosen by `interest_method`.
//
// Ordering note: interest is charged on the balance as it stands when accrual
// runs, i.e. after the previous month's payments have been logged. That
// approximates a lender charging on the outstanding balance and errs slightly
// in the borrower's favour, which is the safe direction for a planning tool.

const MAX_CATCHUP_MONTHS = 12;

function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return firstOfMonth(d);
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export type AccrualResult = {
  debtsTouched: number;
  interestChargedCents: number;
};

/**
 * Bring every `monthly_estimate` debt up to date on interest.
 *
 * Idempotent: `interest_accrued_through` records the last month already
 * charged, so running twice in the same month does nothing. A debt that has
 * never accrued starts from the current month and is charged nothing for it —
 * turning this on can't retroactively invent interest for past months.
 */
export async function accrueDebtInterest(
  supabase: SupabaseClient,
  householdId: string,
): Promise<AccrualResult> {
  const thisMonth = firstOfMonth(new Date());

  const { data: debts, error: debtsError } = await supabase
    .from("debts")
    .select("id, current_balance_cents, apr, interest_method, interest_accrued_through, interest_paid_cents")
    .eq("household_id", householdId)
    .eq("tracking_enabled", true)
    .gt("current_balance_cents", 0);

  // A swallowed error looked like "no debts accrue interest", so the monthly
  // accrual this function exists to apply was silently skipped.
  if (debtsError) throw new Error(`Could not read debts: ${debtsError.message}`);
  if (!debts?.length) return { debtsTouched: 0, interestChargedCents: 0 };

  let debtsTouched = 0;
  let interestChargedCents = 0;

  for (const d of debts) {
    // Credit cards keep the manual statement flow — the lender's number wins.
    if (d.interest_method === "statement_manual") continue;
    const apr = Number(d.apr ?? 0);
    if (!(apr > 0)) continue;

    const through = (d.interest_accrued_through as string | null) ?? null;
    // First time seeing this debt: adopt the current month as the watermark
    // without charging for it, so enabling accrual is never retroactive.
    if (!through) {
      await supabase
        .from("debts")
        .update({ interest_accrued_through: thisMonth })
        .eq("id", d.id);
      continue;
    }

    const elapsed = monthsBetween(through, thisMonth);
    if (elapsed <= 0) continue;
    // A stale or mis-set watermark shouldn't trigger a years-long catch-up in
    // one go; cap it and let subsequent months close the gap.
    const months = Math.min(elapsed, MAX_CATCHUP_MONTHS);

    let balance = d.current_balance_cents as number;
    let charged = 0;
    const monthlyRate = apr / 100 / 12;
    for (let i = 0; i < months; i++) {
      const interest = Math.round(balance * monthlyRate);
      if (interest <= 0) break;
      balance += interest;
      charged += interest;
    }
    if (charged <= 0) {
      await supabase
        .from("debts")
        .update({ interest_accrued_through: addMonths(through, months) })
        .eq("id", d.id);
      continue;
    }

    await supabase
      .from("debts")
      .update({
        current_balance_cents: balance,
        interest_paid_cents: (d.interest_paid_cents ?? 0) + charged,
        interest_accrued_through: addMonths(through, months),
      })
      .eq("id", d.id);

    debtsTouched += 1;
    interestChargedCents += charged;
  }

  return { debtsTouched, interestChargedCents };
}
