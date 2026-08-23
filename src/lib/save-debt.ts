import type { SupabaseClient } from "@supabase/supabase-js";

// One write path for `debts`.
//
// Two editors used to upsert this table independently with disjoint field
// sets: Budget wrote balance/min/apr/due/kind/notes/promo/account, while
// Accounts wrote those plus original_balance, target_payment, escrow, term,
// loan_start, interest_method and tracking_enabled. Whichever screen created a
// debt determined which fields it would ever have — a debt made in Budget kept
// `original_balance_cents = 0` forever, which is what made Snowball's
// "principal paid" percentage measure against a zero baseline.
//
// Everything optional here is genuinely optional: a caller that doesn't manage
// a field simply omits it and the stored value is preserved. That's the point —
// a partial editor can no longer blank a column it doesn't know about.

export type SaveDebtInput = {
  subcategoryId: string;
  balanceCents: number;
  minPaymentCents: number;
  apr: number;
  // Undefined = "this editor doesn't manage the field"; the existing value is kept.
  accountId?: string | null;
  dueDay?: number | null;
  debtKind?: string | null;
  notes?: string | null;
  promoAprEndsOn?: string | null;
  postPromoApr?: number | null;
  originalBalanceCents?: number;
  targetPaymentCents?: number;
  escrowCents?: number;
  termMonths?: number | null;
  loanStartDate?: string | null;
  interestMethod?: string | null;
  trackingEnabled?: boolean;
};

/**
 * Create or update a debt, preserving any column the caller doesn't manage.
 *
 * `original_balance_cents` is seeded from the current balance on first save and
 * never reduced afterwards — it's the historical opening figure, so a later
 * balance edit must not overwrite it. `paid_off_at` is stamped when the balance
 * first reaches zero and cleared if it rises again, matching how a logged
 * payment behaves.
 */
export async function saveDebt(
  supabase: SupabaseClient,
  householdId: string,
  input: SaveDebtInput,
): Promise<{ error?: string }> {
  if (!input.subcategoryId) return { error: "Missing budget item." };

  type StoredDebt = {
    paid_off_at: string | null;
    original_balance_cents: number | null;
    target_payment_cents: number | null;
    escrow_cents: number | null;
    term_months: number | null;
    loan_start_date: string | null;
    interest_method: string | null;
    tracking_enabled: boolean | null;
    due_day: number | null;
    debt_kind: string | null;
    notes: string | null;
    promo_apr_ends_on: string | null;
    post_promo_apr: number | null;
    account_id: string | null;
  };

  const { data } = await supabase
    .from("debts")
    .select("paid_off_at, original_balance_cents, target_payment_cents, escrow_cents, term_months, loan_start_date, interest_method, tracking_enabled, due_day, debt_kind, notes, promo_apr_ends_on, post_promo_apr, account_id")
    .eq("subcategory_id", input.subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  const existing = (data ?? null) as StoredDebt | null;

  const balanceCents = Math.max(0, Math.round(input.balanceCents));

  // Highest of: what the caller supplied, what's stored, and the current
  // balance. A debt can't have opened for less than it currently owes.
  const originalBalanceCents = Math.max(
    input.originalBalanceCents ?? 0,
    Number(existing?.original_balance_cents ?? 0),
    balanceCents,
  );

  const paidOffAt =
    balanceCents <= 0
      ? existing?.paid_off_at ?? new Date().toISOString().slice(0, 10)
      : null;

  // `?? existing ?? fallback` is the whole preservation rule: an omitted field
  // keeps its stored value rather than being reset.
  const keep = <T>(supplied: T | undefined, stored: T, fallback: T): T =>
    supplied !== undefined ? supplied : (stored ?? fallback);

  const { error } = await supabase.from("debts").upsert(
    {
      household_id: householdId,
      subcategory_id: input.subcategoryId,
      current_balance_cents: balanceCents,
      original_balance_cents: originalBalanceCents,
      min_payment_cents: Math.max(0, Math.round(input.minPaymentCents)),
      apr: Number.isFinite(input.apr) ? Math.max(0, input.apr) : 0,
      paid_off_at: paidOffAt,
      account_id: keep(input.accountId, existing?.account_id ?? null, null),
      due_day: keep(input.dueDay, existing?.due_day ?? null, null),
      debt_kind: keep(input.debtKind, existing?.debt_kind ?? null, null),
      notes: keep(input.notes, existing?.notes ?? null, null),
      promo_apr_ends_on: keep(input.promoAprEndsOn, existing?.promo_apr_ends_on ?? null, null),
      post_promo_apr: keep(input.postPromoApr, existing?.post_promo_apr ?? null, null),
      target_payment_cents: keep(
        input.targetPaymentCents,
        existing?.target_payment_cents ?? 0,
        0,
      ),
      escrow_cents: keep(input.escrowCents, existing?.escrow_cents ?? 0, 0),
      term_months: keep(input.termMonths, existing?.term_months ?? null, null),
      loan_start_date: keep(input.loanStartDate, existing?.loan_start_date ?? null, null),
      interest_method: keep(
        input.interestMethod,
        existing?.interest_method ?? null,
        "monthly_estimate",
      ),
      tracking_enabled: keep(input.trackingEnabled, existing?.tracking_enabled ?? true, true),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,subcategory_id" },
  );

  return error ? { error: error.message } : {};
}
