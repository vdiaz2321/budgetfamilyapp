// Payoff projections use a monthly APR estimate. Actual lender statements stay
// authoritative, especially for credit cards that compound daily or have more
// than one APR bucket.

export type DebtInput = {
  id: string;
  balanceCents: number;
  minCents: number;
  apr: number; // percent, e.g. 6.25 — the rate in effect today
  // Promotional-rate window. While `promoEndsOn` is in the future the debt
  // accrues at `apr`; from the first month after it, `postPromoApr` takes over.
  // A 0% balance-transfer card is the common case: apr = 0 until the deadline,
  // then the go-to rate applies to whatever is left. Leaving `postPromoApr`
  // null means "rate unknown" and the projection keeps using `apr`.
  promoEndsOn?: string | null; // YYYY-MM-DD
  postPromoApr?: number | null; // percent
};

// The APR actually in force during a given projection month. Months are
// "YYYY-MM-01"; the promo counts as active through the month its deadline
// falls in, so a promo ending 2027-01-25 still charges 0% for January 2027.
export function aprForMonth(debt: DebtInput, month: string): number {
  if (debt.promoEndsOn && debt.postPromoApr != null && month > debt.promoEndsOn) {
    return Math.max(0, debt.postPromoApr);
  }
  return Math.max(0, debt.apr);
}

// Balance still outstanding when a promotional rate expires, given a fixed
// monthly payment. This is the number that decides whether a 0% card is a
// free loan or a deferred-interest trap.
export function balanceAtPromoEnd(
  balanceCents: number,
  monthlyPaymentCents: number,
  startMonth: string,
  promoEndsOn: string,
): { balanceCents: number; monthsRemaining: number } {
  let bal = balanceCents;
  let months = 0;
  for (let i = 0; i < 480; i++) {
    const month = addMonths(startMonth, i);
    if (month > promoEndsOn) break;
    months = i + 1;
    bal = Math.max(0, bal - Math.max(0, monthlyPaymentCents));
    if (bal <= 0) break;
  }
  return { balanceCents: Math.round(bal), monthsRemaining: months };
}

// Level payment that clears `balanceCents` by the promo deadline. Interest-free
// by construction, since it only ever applies inside the promo window.
export function paymentToClearByPromoEnd(
  balanceCents: number,
  startMonth: string,
  promoEndsOn: string,
): number | null {
  let months = 0;
  for (let i = 0; i < 480; i++) {
    if (addMonths(startMonth, i) > promoEndsOn) break;
    months = i + 1;
  }
  if (months <= 0) return null;
  return Math.ceil(balanceCents / months);
}

export type MonthlyEntry = {
  month: string; // YYYY-MM-01
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  balanceCents: number;
};

export type SnowballResult = {
  order: string[];
  payoffMonth: Map<string, string | null>;
  ledger: Map<string, MonthlyEntry[]>;
  totalInterestCents: Map<string, number>;
  totalPaymentsCents: Map<string, number>;
  negativeAmortization: Set<string>;
};

export type PayoffExtras = {
  oneTimeMonth?: string;
  oneTimeExtraCents?: number;
};

export function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Whole months from one YYYY-MM-01 key to another. Positive when `to` is later.
export function monthsBetweenKeys(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function monthsBetween(startMonth: string, endMonth: string | null): number | null {
  if (!endMonth) return null;
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  return Math.max(0, (ey - sy) * 12 + em - sm + 1);
}

// Which debt the shared extra attacks first.
//   snowball  — smallest balance first (fastest first win, the motivational play)
//   avalanche — highest rate first (mathematically cheapest)
export type PayoffOrder = "snowball" | "avalanche";

export function projectSnowball(
  debts: DebtInput[],
  monthlyExtra: number | ((month: string) => number),
  startMonth: string,
  capMonths = 480,
  noWaterfall = false,
  extras: PayoffExtras = {},
  payoffOrder: PayoffOrder = "snowball",
): SnowballResult {
  const extraFor = typeof monthlyExtra === "function" ? monthlyExtra : () => monthlyExtra;
  const unpaid = debts.filter((d) => d.balanceCents > 0);
  const order = [...unpaid]
    .sort((a, b) =>
      payoffOrder === "avalanche"
        // Highest current rate first; balance breaks ties so the ordering is
        // deterministic when several debts share a rate (e.g. a set of 0% cards).
        ? (Math.max(0, b.apr) - Math.max(0, a.apr)) || (a.balanceCents - b.balanceCents)
        : a.balanceCents - b.balanceCents,
    )
    .map((d) => d.id);
  const byId = new Map(unpaid.map((d) => [d.id, d]));
  const balance = new Map(unpaid.map((d) => [d.id, d.balanceCents]));
  const paidOff = new Set<string>();
  const payoffMonth = new Map<string, string | null>(order.map((id) => [id, null]));
  const ledger = new Map<string, MonthlyEntry[]>(order.map((id) => [id, []]));
  const totalInterestCents = new Map<string, number>(order.map((id) => [id, 0]));
  const totalPaymentsCents = new Map<string, number>(order.map((id) => [id, 0]));
  const negativeAmortization = new Set<string>();

  for (let i = 0; i < capMonths && paidOff.size < order.length; i++) {
    const month = addMonths(startMonth, i);
    let extraPool = Math.max(0, extraFor(month));
    if (month === extras.oneTimeMonth) {
      extraPool += Math.max(0, extras.oneTimeExtraCents ?? 0);
    }
    if (!noWaterfall) {
      for (const id of order) {
        if (paidOff.has(id)) extraPool += Math.max(0, byId.get(id)!.minCents);
      }
    }

    const focusId = order.find((id) => !paidOff.has(id));
    for (const id of order) {
      if (paidOff.has(id)) continue;
      const debt = byId.get(id)!;
      const startingBalance = balance.get(id)!;
      // Rate can change mid-projection when a promotional window expires.
      const effectiveApr = aprForMonth(debt, month);
      const interest = Math.max(0, startingBalance * effectiveApr / 100 / 12);
      const amountDue = startingBalance + interest;
      const scheduled = Math.max(0, debt.minCents) + (id === focusId ? extraPool : 0);
      const payment = Math.min(scheduled, amountDue);
      const principal = payment - interest;
      const newBalance = Math.max(0, amountDue - payment);

      if (startingBalance > 0 && payment <= interest && effectiveApr > 0) {
        negativeAmortization.add(id);
      }

      const entry: MonthlyEntry = {
        month,
        paymentCents: Math.round(payment),
        interestCents: Math.round(interest),
        principalCents: Math.round(principal),
        balanceCents: Math.round(newBalance),
      };
      ledger.get(id)!.push(entry);
      totalInterestCents.set(id, (totalInterestCents.get(id) ?? 0) + entry.interestCents);
      totalPaymentsCents.set(id, (totalPaymentsCents.get(id) ?? 0) + entry.paymentCents);
      balance.set(id, newBalance);

      if (newBalance <= 0.5) {
        paidOff.add(id);
        payoffMonth.set(id, month);
      }
    }
  }

  return {
    order,
    payoffMonth,
    ledger,
    totalInterestCents,
    totalPaymentsCents,
    negativeAmortization,
  };
}

