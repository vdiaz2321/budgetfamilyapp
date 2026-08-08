// Payoff projections use a monthly APR estimate. Actual lender statements stay
// authoritative, especially for credit cards that compound daily or have more
// than one APR bucket.

export type DebtInput = {
  id: string;
  balanceCents: number;
  minCents: number;
  apr: number; // percent, e.g. 6.25
};

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

export function monthsBetween(startMonth: string, endMonth: string | null): number | null {
  if (!endMonth) return null;
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  return Math.max(0, (ey - sy) * 12 + em - sm + 1);
}

export function projectSnowball(
  debts: DebtInput[],
  monthlyExtra: number | ((month: string) => number),
  startMonth: string,
  capMonths = 480,
  noWaterfall = false,
  extras: PayoffExtras = {},
): SnowballResult {
  const extraFor = typeof monthlyExtra === "function" ? monthlyExtra : () => monthlyExtra;
  const unpaid = debts.filter((d) => d.balanceCents > 0);
  const order = [...unpaid]
    .sort((a, b) => a.balanceCents - b.balanceCents)
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
      const interest = Math.max(0, startingBalance * Math.max(0, debt.apr) / 100 / 12);
      const amountDue = startingBalance + interest;
      const scheduled = Math.max(0, debt.minCents) + (id === focusId ? extraPool : 0);
      const payment = Math.min(scheduled, amountDue);
      const principal = payment - interest;
      const newBalance = Math.max(0, amountDue - payment);

      if (startingBalance > 0 && payment <= interest && debt.apr > 0) {
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

