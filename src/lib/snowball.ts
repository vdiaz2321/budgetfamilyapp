// Debt snowball amortization: monthly-compounding interest + waterfall extra
// payments (classic snowball — smallest starting balance attacked first; once
// a debt is paid off, its minimum payment permanently joins the extra pool for
// whichever debt is next in the fixed attack order).

export type DebtInput = {
  id: string;
  balanceCents: number;
  minCents: number;
  apr: number; // percent, e.g. 2.95
};

export type MonthlyEntry = {
  month: string; // YYYY-MM-01
  paymentCents: number;
  balanceCents: number;
};

export type SnowballResult = {
  // Attack order fixed at the start (smallest balance first) — not re-sorted
  // as balances change, matching the classic snowball method.
  order: string[];
  payoffMonth: Map<string, string | null>; // null = not paid off within the cap
  ledger: Map<string, MonthlyEntry[]>;
};

function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function projectSnowball(
  debts: DebtInput[],
  // Either a flat monthly extra, or a function returning the extra for a given
  // month (YYYY-MM-01) so the amount can vary over date ranges.
  monthlyExtra: number | ((month: string) => number),
  startMonth: string,
  capMonths = 60,
): SnowballResult {
  const extraFor = typeof monthlyExtra === "function" ? monthlyExtra : () => monthlyExtra;
  const unpaid = debts.filter((d) => d.balanceCents > 0);
  const order = [...unpaid].sort((a, b) => a.balanceCents - b.balanceCents).map((d) => d.id);
  const byId = new Map(unpaid.map((d) => [d.id, d]));

  // Working balances in cents as floats during simulation (interest isn't a
  // whole number of cents); rounded only when recorded.
  const balance = new Map<string, number>(unpaid.map((d) => [d.id, d.balanceCents]));
  const paidOff = new Set<string>();
  const payoffMonth = new Map<string, string | null>(order.map((id) => [id, null]));
  const ledger = new Map<string, MonthlyEntry[]>(order.map((id) => [id, []]));

  for (let i = 0; i < capMonths && paidOff.size < order.length; i++) {
    const month = addMonths(startMonth, i);
    // Extra pool this month = configured extra (may vary by month) + minimums
    // freed from debts already paid off in a prior month.
    let extraPool = extraFor(month);
    for (const id of order) {
      if (paidOff.has(id)) extraPool += byId.get(id)!.minCents;
    }

    // First unpaid debt in the fixed order is this month's focus.
    const focusId = order.find((id) => !paidOff.has(id));

    for (const id of order) {
      if (paidOff.has(id)) continue;
      const debt = byId.get(id)!;
      const bal = balance.get(id)!;
      const accrued = bal * (1 + debt.apr / 100 / 12);
      const scheduled = debt.minCents + (id === focusId ? extraPool : 0);
      const payment = Math.min(scheduled, accrued);
      const newBalance = Math.max(0, accrued - payment);

      ledger.get(id)!.push({
        month,
        paymentCents: Math.round(payment),
        balanceCents: Math.round(newBalance),
      });
      balance.set(id, newBalance);

      if (newBalance <= 0.5) {
        paidOff.add(id);
        payoffMonth.set(id, month);
      }
    }
  }

  return { order, payoffMonth, ledger };
}
