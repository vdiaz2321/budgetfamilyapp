import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentMonthFirst } from "@/lib/snapshots";
import { projectSnowball } from "@/lib/snowball";
import { TransactionsPanel } from "../budget/transactions-panel";
import type { AccountOption, SubOption, TxData } from "../budget/types";
import { SnowballBoard } from "./snowball-board";
import { SnowballSettings } from "./snowball-settings";

export const metadata = { title: "Debt/Loan Snowball · Capitall" };

export default async function SnowballPage() {
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

  const { data: household } = await supabase
    .from("households")
    .select("id, currency, snowball_start_date, snowball_monthly_extra_cents")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  const currency = household.currency;
  // Manual top-up used ONLY by the classic textbook Snowball (below) — pure
  // "pay minimums + throw this much extra at the smallest debt," independent
  // of whatever's Planned per debt. Kept as a shareable reference method.
  const manualExtraCents = household.snowball_monthly_extra_cents ?? 0;
  const month = currentMonthFirst();

  const [{ data: debts }, { data: subs }, { data: plans }, { data: periodRows }] =
    await Promise.all([
      supabase
        .from("debts")
        .select("id, subcategory_id, account_id, current_balance_cents, original_balance_cents, min_payment_cents, target_payment_cents, escrow_cents, interest_paid_cents, interest_method, apr, due_day, debt_kind, paid_off_at")
        .eq("household_id", household.id)
        .eq("tracking_enabled", true),
      supabase
        .from("subcategories")
        .select("id, name")
        .eq("household_id", household.id),
      supabase
        .from("budget_plans")
        .select("subcategory_id, planned_cents")
        .eq("household_id", household.id)
        .eq("month", month),
      supabase
        .from("snowball_extra_periods")
        .select("id, start_month, end_month, amount_cents")
        .eq("household_id", household.id)
        .order("start_month"),
    ]);

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents]));

  // All-time total actually paid into each debt (every logged payment), so each
  // card can show progress independent of the current balance.
  const debtSubIds = (debts ?? []).map((d) => d.subcategory_id);
  const paidBySub = new Map<string, number>();
  // Actually paid into each debt THIS month, so the card's "Paid this month"
  // row reflects what really happened rather than the projected schedule.
  const paidThisMonthBySub = new Map<string, number>();
  if (debtSubIds.length) {
    const { data: paidRows } = await supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents, month")
      .eq("household_id", household.id)
      .in("subcategory_id", debtSubIds);
    for (const r of paidRows ?? []) {
      paidBySub.set(r.subcategory_id, (paidBySub.get(r.subcategory_id) ?? 0) + r.actual_cents);
      if (r.month === month) {
        paidThisMonthBySub.set(
          r.subcategory_id,
          (paidThisMonthBySub.get(r.subcategory_id) ?? 0) + r.actual_cents,
        );
      }
    }
  }

  // Debt payment history + the bits the edit modal needs, so payments can be
  // reviewed/searched/edited right here instead of bouncing to Transactions.
  // Every logged debt payment (all-time), newest first.
  let debtTxData: TxData[] = [];
  let accountOptions: AccountOption[] = [];
  const accountKindById = new Map<string, string>();
  if (debtSubIds.length) {
    const [{ data: txRows }, { data: payees }, { data: accounts }] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, cleared, is_withdrawal")
        .eq("household_id", household.id)
        .in("subcategory_id", debtSubIds)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("payees").select("id, name").eq("household_id", household.id),
      supabase
        .from("accounts")
        .select("id, name, kind, is_kids_account")
        .eq("household_id", household.id)
        .eq("active", true)
        .order("name"),
    ]);
    const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));
    const bankingKinds = new Set(["checking", "savings", "cash", "savings_bucket"]);
    accountOptions = (accounts ?? [])
      .filter((a) => !a.is_kids_account && (bankingKinds.has(a.kind) || a.kind === "credit_card"))
      .map((a) => ({
        id: a.id,
        name: a.name,
        group: a.kind === "credit_card" ? "Credit Cards" : "Banking",
      }));
    for (const account of accounts ?? []) accountKindById.set(account.id, account.kind);
    debtTxData = (txRows ?? []).map((t) => ({
      id: t.id,
      date: t.occurred_on,
      amountCents: t.amount_cents,
      memo: t.memo,
      payee: t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
      subId: t.subcategory_id ?? null,
      subName: t.subcategory_id ? nameBySub.get(t.subcategory_id) ?? "Debt" : "Debt",
      accountId: t.account_id ?? null,
      kind: "debt",
      isCardPayment: false,
      cleared: t.cleared ?? false,
      isWithdrawal: t.is_withdrawal ?? false,
    }));
  }

  // Debt line items as pickable options in the edit modal. `remainingCents`
  // shows the debt balance still owed, so the picker reads as "debt left".
  const balanceBySub = new Map((debts ?? []).map((d) => [d.subcategory_id, d.current_balance_cents as number]));
  const debtSubOptions: SubOption[] = debtSubIds.map((id) => ({
    id,
    name: nameBySub.get(id) ?? "Debt",
    kind: "debt",
    linkedBucketId: null,
    remainingCents: balanceBySub.get(id) ?? 0,
  }));

  const periods = (periodRows ?? []).map((p) => ({
    id: p.id as string,
    startMonth: p.start_month as string,
    endMonth: (p.end_month as string | null) ?? null,
    amountCents: p.amount_cents as number,
  }));

  // A paid-off debt keeps showing here through Dec 31 of the year it was
  // paid off, then drops off once the calendar rolls into the next year —
  // it never comes back on the Budget page either way.
  const currentYear = new Date().getFullYear();
  const rows = (debts ?? [])
    .filter((d) => {
      if (d.current_balance_cents > 0 || !d.paid_off_at) return true;
      return new Date(d.paid_off_at).getFullYear() >= currentYear;
    })
    .map((d) => ({
      debtId: d.id,
      subId: d.subcategory_id,
      name: nameBySub.get(d.subcategory_id) ?? "Debt",
      balanceCents: d.current_balance_cents,
      originalBalanceCents: Math.max(
        d.original_balance_cents ?? 0,
        d.current_balance_cents,
        d.current_balance_cents + (paidBySub.get(d.subcategory_id) ?? 0),
      ),
      minCents: d.min_payment_cents,
      plannedCents: Math.max(plannedBySub.get(d.subcategory_id) ?? 0, d.target_payment_cents ?? 0),
      paidCents: paidBySub.get(d.subcategory_id) ?? 0,
      paidThisMonthCents: paidThisMonthBySub.get(d.subcategory_id) ?? 0,
      interestPaidCents: d.interest_paid_cents ?? 0,
      escrowCents: d.escrow_cents ?? 0,
      apr: Number(d.apr),
      dueDay: d.due_day as number | null,
      debtKind: d.debt_kind as string | null,
      accountKind: d.account_id
        ? d.debt_kind === "credit_card" || accountKindById.get(d.account_id) === "credit_card" ? "credit_card" : "debt_loan"
        : "budget",
      interestMethod: d.interest_method === "statement_manual" ? "statement_manual" : "monthly_estimate",
    }));

  // Card order: smallest balance first (used by both modes, purely for
  // display — "My Plan" doesn't attack in any particular order).
  const unpaid = rows.filter((r) => r.balanceCents > 0).sort((a, b) => a.balanceCents - b.balanceCents);
  const paidOff = rows.filter((r) => r.balanceCents <= 0);
  const ordered = [...unpaid, ...paidOff];

  const totalBalance = unpaid.reduce((s, r) => s + r.balanceCents, 0);
  const totalMin = unpaid.reduce((s, r) => s + r.minCents, 0);

  // ---- Mode 1: "My Plan" — each debt paid at ITS OWN Planned amount (or its
  // minimum, whichever's higher), independently. No waterfall, no shared
  // "extra" pool — this is what actually happens if everyone pays exactly
  // what's Planned in Budget every month. Default, since Victor pays a fixed
  // amount per debt to hit promo deadlines rather than snowballing the
  // smallest balance first.
  const focusId = unpaid[0]?.subId ?? null; // still used to badge classic mode
  const plannedTotal = unpaid.reduce((s, r) => s + Math.max(r.minCents, r.plannedCents), 0);
  const { payoffMonth: plannedPayoff, ledger: plannedLedger } = projectSnowball(
    unpaid.map((r) => ({
      id: r.subId,
      balanceCents: r.balanceCents,
      minCents: Math.max(r.minCents, r.plannedCents),
      apr: r.apr,
    })),
    0,     // no shared extra — each debt's own scheduled amount is baked into minCents above
    month,
    480,   // supports long-term mortgages
    true,  // noWaterfall: each debt pays independently, no cascade when one pays off
  );

  // ---- Mode 2: classic textbook Snowball — pay every minimum, throw the
  // extra at the smallest balance. Uses the SAME monthly capacity as My Plan
  // (plannedTotal) so the two modes are an apples-to-apples comparison; any
  // dated extra periods still stack on top for boosts (0% promo windows, etc.).
  const classicExtraBaseline = Math.max(0, plannedTotal - totalMin);
  const classicExtraForMonth = (m: string) =>
    classicExtraBaseline +
    periods.reduce(
      (sum, p) => (m >= p.startMonth && (p.endMonth == null || m <= p.endMonth) ? sum + p.amountCents : sum),
      0,
    );
  const monthlyAttack = totalMin + classicExtraForMonth(month);
  const classicExtraThisMonth = classicExtraForMonth(month);
  const { payoffMonth: classicPayoff, ledger: classicLedger } = projectSnowball(
    unpaid.map((r) => ({ id: r.subId, balanceCents: r.balanceCents, minCents: r.minCents, apr: r.apr })),
    classicExtraForMonth,
    month,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Debt/Loan Snowball</h1>
      </div>

      <SnowballBoard
        rows={ordered.map((r) => ({
          debtId: r.debtId,
          subId: r.subId,
          name: r.name,
          balanceCents: r.balanceCents,
          originalBalanceCents: r.originalBalanceCents,
          minCents: r.minCents,
          plannedCents: r.plannedCents,
          paidCents: r.paidCents,
          paidThisMonthCents: r.paidThisMonthCents,
          interestPaidCents: r.interestPaidCents,
          escrowCents: r.escrowCents,
          apr: r.apr,
          dueDay: r.dueDay,
          debtKind: r.debtKind,
          accountKind: r.accountKind as "credit_card" | "debt_loan" | "budget",
          interestMethod: r.interestMethod as "monthly_estimate" | "statement_manual",
        }))}
        startMonth={month}
        focusId={focusId}
        totalBalanceCents={totalBalance}
        totalMinCents={totalMin}
        plannedTotalCents={plannedTotal}
        currentExtraCents={classicExtraThisMonth}
        monthlyAttackCents={monthlyAttack}
        plannedPayoffMonth={Object.fromEntries(plannedPayoff)}
        plannedLedger={Object.fromEntries(plannedLedger)}
        classicPayoffMonth={Object.fromEntries(classicPayoff)}
        classicLedger={Object.fromEntries(classicLedger)}
        currency={currency}
        settings={
          <SnowballSettings
            key="snowball-settings"
            currency={currency}
            snowballStartDate={household.snowball_start_date}
            snowballMonthlyExtraCents={manualExtraCents}
            periods={periods}
          />
        }
      />

      {debtSubIds.length ? (
        <TransactionsPanel
          monthKey={month.slice(0, 7)}
          monthLabel=""
          firstOfMonth={month}
          currency={currency}
          transactions={debtTxData}
          subOptions={debtSubOptions}
          accountOptions={accountOptions}
          title="Debt Payments"
          subtitle="All debt payments — search or edit"
          addLabel="Add Payment"
          initialKind="debt"
          collapseStorageKey="debt-payments-open"
          initialCollapsed
        />
      ) : null}
    </div>
  );
}
