import { currentMonthFirst } from "@/lib/snapshots";
import { projectSnowball, balanceAtPromoEnd, paymentToClearByPromoEnd, monthsBetweenKeys } from "@/lib/snowball";
import { TransactionsPanel } from "../budget/transactions-panel";
import type { AccountOption, SubOption, TxData } from "../budget/types";
import { SnowballBoard } from "./snowball-board";
import { SnowballSettings } from "./snowball-settings";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { accrueDebtInterest } from "@/lib/debt-interest";
import { throwIfAny } from "@/lib/supabase-result";

export const metadata = { title: "Debt/Loan Snowball · Capitall" };

export default async function SnowballPage() {
  const { supabase, household } = await getSessionContext();

  const currency = household.currency;
  // Manual top-up used ONLY by the classic textbook Snowball (below) — pure
  // "pay minimums + throw this much extra at the smallest debt," independent
  // of whatever's Planned per debt. Kept as a shareable reference method.
  const manualExtraCents = household.snowball_monthly_extra_cents ?? 0;
  const month = currentMonthFirst();

  // Bring installment debts up to date on interest before anything is read.
  // No-op for 0% cards and for anything on the manual-statement method, and
  // idempotent within a month — see lib/debt-interest.ts.
  await accrueDebtInterest(supabase, household.id);

  const [{ data: debts, error: debtsError }, { data: subs, error: subsError }, plans, { data: periodRows, error: periodRowsError }, { data: debtSnapshotRows, error: debtSnapshotRowsError }] =
    await Promise.all([
      supabase
        .from("debts")
        .select("id, subcategory_id, account_id, current_balance_cents, original_balance_cents, min_payment_cents, target_payment_cents, escrow_cents, interest_paid_cents, interest_method, apr, post_promo_apr, promo_apr_ends_on, due_day, debt_kind, paid_off_at")
        .eq("household_id", household.id)
        .eq("tracking_enabled", true),
      supabase
        .from("subcategories")
        .select("id, name")
        .eq("household_id", household.id),
      // Recent months, not just the current one. Budget plans are entered
      // partway through a month, so on the 1st there is nothing planned yet —
      // and reading only the current month made every payoff date jump years
      // into the future until planning was done. The most recent month that
      // actually has a figure is a far better estimate of the standing payment.
      // Every month ever planned, so it grows without bound and will pass
      // PostgREST's 1000-row cap — paged so the payoff maths can't silently
      // start reading a partial plan history.
      fetchAllRows<{ subcategory_id: string; planned_cents: number; month: string }>((from, to) =>
        supabase
          .from("budget_plans")
          .select("subcategory_id, planned_cents, month")
          .eq("household_id", household.id)
          .lte("month", month)
          .order("month", { ascending: true })
          .order("subcategory_id")
          .range(from, to),
      ),
      supabase
        .from("snowball_extra_periods")
        .select("id, start_month, end_month, amount_cents")
        .eq("household_id", household.id)
        .order("start_month"),
      // Recorded month-end balances. The table has been maintained all along
      // and read by Net Worth and Accounts; this page only ever drew a
      // forward projection, so there was no way to see whether the projection
      // matched what actually happened.
      supabase
        .from("debt_snapshots")
        .select("subcategory_id, month, balance_cents")
        .eq("household_id", household.id)
        .lt("month", month)
        .order("month"),
    ]);
  throwIfAny({ debts: debtsError, subs: subsError, periodRows: periodRowsError, debtSnapshotRows: debtSnapshotRowsError });

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  // Rows arrive oldest-first, so later months overwrite earlier ones and each
  // debt ends up with its most recent non-zero planned payment.
  const plannedBySub = new Map<string, number>();
  for (const p of plans ?? []) {
    if ((p.planned_cents ?? 0) > 0) plannedBySub.set(p.subcategory_id, p.planned_cents);
  }

  // All-time total actually paid into each debt (every logged payment), so each
  // card can show progress independent of the current balance.
  const debtSubIds = (debts ?? []).map((d) => d.subcategory_id);
  const paidBySub = new Map<string, number>();
  // Actually paid into each debt THIS month, so the card's "Paid this month"
  // row reflects what really happened rather than the projected schedule.
  const paidThisMonthBySub = new Map<string, number>();
  if (debtSubIds.length) {
    const { data: paidRows, error: paidRowsError } = await supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents, month")
      .eq("household_id", household.id)
      .in("subcategory_id", debtSubIds);
    throwIfAny({ paidRows: paidRowsError });
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
    const [{ data: txRows, error: txRowsError }, { data: payees, error: payeesError }, { data: accounts, error: accountsError }] = await Promise.all([
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
    throwIfAny({ txRows: txRowsError, payees: payeesError, accounts: accountsError });
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
      toAccountId: null,
      fromBucketId: null,
      toBucketId: null,
      kind: "debt",
      movementType: null,
      isCardPayment: false,
      isTransfer: false,
      isInvestmentTransfer: false,
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
      promoEndsOn: (d.promo_apr_ends_on as string | null) ?? null,
      postPromoApr: d.post_promo_apr == null ? null : Number(d.post_promo_apr),
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
  const totalMin = unpaid.reduce((s, r) => s + Math.max(0, r.minCents - r.escrowCents), 0);

  // ---- Mode 1: "My Plan" — each debt paid at ITS OWN Planned amount (or its
  // minimum, whichever's higher), independently. No waterfall, no shared
  // "extra" pool — this is what actually happens if everyone pays exactly
  // what's Planned in Budget every month. Default, since Victor pays a fixed
  // amount per debt to hit promo deadlines rather than snowballing the
  // smallest balance first.
  const focusId = unpaid[0]?.subId ?? null; // still used to badge classic mode
  // Escrow (taxes + insurance on a mortgage) is collected with the payment but
  // never touches principal, so it must come off the top before projecting.
  // Clamped at the minimum so a mis-entered escrow can't zero out a payment.
  const payoffPortion = (paymentCents: number, escrowCents: number) =>
    escrowCents > 0 ? Math.max(0, paymentCents - escrowCents) : paymentCents;
  const plannedTotal = unpaid.reduce(
    (s, r) => s + payoffPortion(Math.max(r.minCents, r.plannedCents), r.escrowCents),
    0,
  );
  const { payoffMonth: plannedPayoff, ledger: plannedLedger } = projectSnowball(
    unpaid.map((r) => ({
      id: r.subId,
      balanceCents: r.balanceCents,
      minCents: payoffPortion(Math.max(r.minCents, r.plannedCents), r.escrowCents),
      apr: r.apr,
      promoEndsOn: r.promoEndsOn,
      postPromoApr: r.postPromoApr,
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
  const { payoffMonth: classicPayoff, ledger: classicLedger, totalInterestCents: classicTotalInterest } = projectSnowball(
    unpaid.map((r) => ({
      id: r.subId,
      balanceCents: r.balanceCents,
      minCents: Math.max(0, r.minCents - r.escrowCents),
      apr: r.apr,
      promoEndsOn: r.promoEndsOn,
      postPromoApr: r.postPromoApr,
    })),
    classicExtraForMonth,
    month,
  );

  // ---- Recorded balance history, for the burndown chart.
  //
  // Household-wide totals only count months where at least one snapshot
  // exists, and sum whatever was recorded that month. Per-debt series feed the
  // single-debt view. Capped to the last 12 months so the chart doesn't
  // compress the projection into the right-hand edge.
  const trackedSubIds = new Set(rows.map((r) => r.subId));
  const historyByMonth = new Map<string, number>();
  const historyBySub = new Map<string, { month: string; balanceCents: number }[]>();
  for (const s of debtSnapshotRows ?? []) {
    if (!trackedSubIds.has(s.subcategory_id)) continue;
    const cents = s.balance_cents ?? 0;
    historyByMonth.set(s.month, (historyByMonth.get(s.month) ?? 0) + cents);
    const arr = historyBySub.get(s.subcategory_id) ?? [];
    arr.push({ month: s.month, balanceCents: cents });
    historyBySub.set(s.subcategory_id, arr);
  }
  const totalHistory = [...historyByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([m, cents]) => ({ month: m, balanceCents: cents }));
  const historyBySubObj = Object.fromEntries(
    [...historyBySub.entries()].map(([subId, arr]) => [
      subId,
      arr.sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
    ]),
  );

  // ---- Avalanche comparison. Same debts, same monthly capacity, different
  // attack order: highest rate first instead of smallest balance first. Where
  // rates differ this is the cheapest possible ordering; where they're all
  // equal (a set of 0% cards) the two are identical and the UI says so rather
  // than manufacturing a win.
  const avalanche = projectSnowball(
    unpaid.map((r) => ({
      id: r.subId,
      balanceCents: r.balanceCents,
      minCents: Math.max(0, r.minCents - r.escrowCents),
      apr: r.apr,
      promoEndsOn: r.promoEndsOn,
      postPromoApr: r.postPromoApr,
    })),
    classicExtraForMonth,
    month,
    480,
    false,
    {},
    "avalanche",
  );
  const sumInterest = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const lastPayoff = (m: Map<string, string | null>) => {
    const months = [...m.values()].filter((v): v is string => !!v);
    return months.length === [...m.keys()].length && months.length > 0
      ? months.sort().at(-1)!
      : null;
  };
  const classicInterest = sumInterest(classicTotalInterest);
  const avalancheInterest = sumInterest(avalanche.totalInterestCents);
  const classicFinish = lastPayoff(classicPayoff);
  const avalancheFinish = lastPayoff(avalanche.payoffMonth);
  const monthsDiff =
    classicFinish && avalancheFinish ? monthsBetweenKeys(avalancheFinish, classicFinish) : 0;
  const payoffComparison = {
    snowballInterestCents: Math.round(classicInterest),
    avalancheInterestCents: Math.round(avalancheInterest),
    interestSavedCents: Math.round(classicInterest - avalancheInterest),
    snowballFinish: classicFinish,
    avalancheFinish,
    monthsSaved: monthsDiff,
  };

  // ---- Promotional-rate outlook. For each debt still inside a 0%/low-rate
  // window, work out what will still be owed the month the promo expires at
  // the payment actually being made, and the level payment that would clear it
  // first. This is the number the page exists to surface: a deadline that
  // arrives on a known date and turns a free loan into an interest-bearing one.
  const promoOutlook = unpaid
    .filter((r) => r.promoEndsOn && r.promoEndsOn >= month)
    .map((r) => {
      const payment = payoffPortion(Math.max(r.minCents, r.plannedCents), r.escrowCents);
      const { balanceCents: leftAtEnd, monthsRemaining } = balanceAtPromoEnd(
        r.balanceCents,
        payment,
        month,
        r.promoEndsOn!,
      );
      const clearPayment = paymentToClearByPromoEnd(r.balanceCents, month, r.promoEndsOn!);
      // Annual cost of carrying the leftover at the go-to rate, when known.
      const annualCostCents =
        r.postPromoApr != null && leftAtEnd > 0
          ? Math.round((leftAtEnd * r.postPromoApr) / 100)
          : null;
      return {
        subId: r.subId,
        name: r.name,
        promoEndsOn: r.promoEndsOn!,
        monthsRemaining,
        currentPaymentCents: payment,
        balanceAtEndCents: leftAtEnd,
        clearPaymentCents: clearPayment,
        postPromoApr: r.postPromoApr,
        annualCostCents,
      };
    })
    .filter((p) => p.balanceAtEndCents > 0)
    .sort((a, b) => a.promoEndsOn.localeCompare(b.promoEndsOn));

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
          promoEndsOn: r.promoEndsOn,
          postPromoApr: r.postPromoApr,
          dueDay: r.dueDay,
          debtKind: r.debtKind,
          accountKind: r.accountKind as "credit_card" | "debt_loan" | "budget",
          interestMethod: r.interestMethod as "monthly_estimate" | "statement_manual",
        }))}
        promoOutlook={promoOutlook}
        payoffComparison={payoffComparison}
        totalHistory={totalHistory}
        historyBySub={historyBySubObj}
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
