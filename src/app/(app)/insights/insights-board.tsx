"use client";

import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import {
  outflowOf,
  spendingOf,
  type CategoryRow,
  type Flows,
  type InsightsData,
  type KindSlice,
  type OutflowKind,
} from "./types";
import { Donut, KIND_COLOR, KIND_LABEL, TrendChart } from "./insights-charts";
import { PeriodPicker } from "./insights-period-picker";
import { currentPeriodKey } from "./period";
import { CardPaymentsLedger } from "@/components/card-payments-ledger";

export function InsightsBoard({ data }: { data: InsightsData }) {
  const router = useRouter();
  // Toggle behavior: clicking the bar that's already selected returns to the
  // current period at the same granularity, so a stray click can be undone
  // without hunting through the menu.
  const selectPeriod = (key: string) => {
    const target = key === data.periodKey ? currentPeriodKey(data.granularity) : key;
    router.push(`/insights?g=${data.granularity}&p=${encodeURIComponent(target)}`);
  };

  const outTotal = outflowOf(data.totals);
  const hasData = data.totals.income !== 0 || outTotal !== 0;

  // Only compare against the prior period when it holds meaningful activity,
  // and drop a metric's delta when its own prior base is too small to yield a
  // sane percentage.
  const curActivity = data.totals.income + outTotal;
  const priorActivity = data.prior.income + outflowOf(data.prior);
  // Only compare when the prior period has real activity overall (guards the
  // "YTD 2026 vs barely-tracked 2025" case). Then, per metric, drop a delta
  // whose prior is near-zero or whose swing is absurd — a small-but-real base
  // (e.g. $5.9k of debt) still compares fine.
  const priorComparable = priorActivity >= curActivity * 0.1;
  const deltaFor = (current: number, prior: number): number | null => {
    if (!priorComparable || Math.abs(prior) < 10_00) return null;
    const pct = ((current - prior) / Math.abs(prior)) * 100;
    return Math.abs(pct) > 500 ? null : pct;
  };

  const stat = (pick: (f: Flows) => number) => ({
    value: pick(data.totals),
    delta: deltaFor(pick(data.totals), pick(data.prior)),
  });
  const income = stat((f) => f.income);
  const spending = stat(spendingOf);
  const savings = stat((f) => f.savings);
  const debt = stat((f) => f.debt);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <PeriodPicker
          granularity={data.granularity}
          periodKey={data.periodKey}
          label={data.periodLabel}
          minYear={data.minYear}
        />
      </div>

      {/* Hero stats — the selected period */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Income" {...income} color="var(--positive)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} />
        <StatCard label="Spending" {...spending} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} />
        <StatCard label="Savings" {...savings} color="var(--viz-savings)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} />
        <StatCard label="Debt paid" {...debt} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} />
      </div>

      {/* Trend — click a bar to jump the whole page to that period. Clicking
          empty space inside this card (but not a bar) also resets to the
          current period, so a stray selection can be undone without hunting.
          Scoped to just this section so clicks on the donut or tables below
          don't unintentionally reset. */}
      <section
        className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        onClick={(e) => {
          if (data.periodKey === currentPeriodKey(data.granularity)) return;
          if ((e.target as HTMLElement).closest("button")) return;
          router.push(
            `/insights?g=${data.granularity}&p=${encodeURIComponent(
              currentPeriodKey(data.granularity),
            )}`,
          );
        }}
      >
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Income vs. spending</h2>
          <span className="text-[11px] uppercase tracking-wide text-muted">
            tap a bar to jump to that period
          </span>
        </div>
        <TrendChart buckets={data.buckets} currency={data.currency} onSelect={selectPeriod} />
      </section>

      {!hasData ? (
        <div className="rounded-2xl bg-surface px-6 py-12 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-lg font-semibold">No activity in {data.periodLabel}</p>
          <p className="mt-1 text-sm text-muted">
            There are no transactions in this period yet. Pick another from the
            chart above or the period menu.
          </p>
        </div>
      ) : (
        <>
          {/* Where it went: donut + ranked categories */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Total outflow</h2>
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  {data.periodLabel}
                </span>
              </div>
              <Donut slices={data.kinds} total={outTotal} currency={data.currency} />
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] font-medium uppercase tracking-wide text-muted">
                    <th className="pb-2 text-left font-medium">Category</th>
                    <th className="pb-2 text-right font-medium">% Out</th>
                    <th className="pb-2 text-right font-medium">Change</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.kinds.map((k) => (
                    <KindTableRow
                      key={k.kind}
                      slice={k}
                      priorAmount={priorForKind(k.kind, data.prior)}
                      outTotal={outTotal}
                      currency={data.currency}
                    />
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Top outflow</h2>
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  {data.periodLabel}
                </span>
              </div>
              {data.categories.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No categorized spending in this period.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-medium uppercase tracking-wide text-muted">
                      <th className="pb-2 text-left font-medium">Category</th>
                      <th className="pb-2 text-right font-medium">% Spend</th>
                      <th className="pb-2 text-right font-medium">Change</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.categories.map((c) => (
                      <CategoryTableRow
                        key={c.subId}
                        row={c}
                        outTotal={outTotal}
                        currency={data.currency}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* Merchants + largest purchases — transaction detail only (2026+) */}
          {data.detailAvailable ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">Top merchants</h2>
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    {data.periodLabel}
                  </span>
                </div>
                {data.merchants.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">No merchant activity in this period.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.merchants.map((m) => (
                      <li key={m.name} className="flex items-center justify-between py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="text-xs text-muted">
                            {m.count} {m.count === 1 ? "transaction" : "transactions"}
                          </span>
                        </span>
                        <span className="ml-2 shrink-0 font-semibold tabular-nums">
                          {formatMoney(m.total, data.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">Largest purchases</h2>
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    {data.periodLabel}
                  </span>
                </div>
                {data.purchases.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">No purchases in this period.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.purchases.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.payee}</span>
                          <span className="text-xs text-muted">{formatDate(p.date)} · {p.sub}</span>
                        </span>
                        <span className="ml-2 shrink-0 font-semibold tabular-nums text-negative">
                          {formatMoney(p.amount, data.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : (
            <div className="rounded-2xl bg-surface px-5 py-4 text-sm text-muted shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              {`${data.periodLabel} comes from your imported annual totals, so category amounts are shown but per-merchant and per-purchase detail isn't available. Those appear for 2026 onward, where individual transactions are tracked.`}
            </div>
          )}
        </>
      )}

      {/* Card payments — its own report with its own year filter, so it shows
          the full history regardless of the period selected above. */}
      <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <CardPaymentsLedger
          payments={data.cardPayments}
          cardNames={data.cardNames}
          sourceNames={data.sourceNames}
          currency={data.currency}
          storageKey="insights-card-payments-open"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  currency,
  delta,
  deltaGoodWhen,
  priorLabel,
}: {
  label: string;
  value: number;
  color: string;
  currency: string;
  delta: number | null;
  deltaGoodWhen: "up" | "down";
  priorLabel: string;
}) {
  // No arrows: the wording ("less than" / "more than") already carries
  // direction, and the color carries whether that direction is good — an arrow
  // on top of both just reads as a contradiction.
  const flat = delta != null && Math.abs(delta) < 0.5;
  const good =
    delta == null || flat
      ? null
      : deltaGoodWhen === "up"
      ? delta > 0
      : delta < 0;

  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums" style={{ color }}>
        {formatMoney(value, currency)}
      </p>
      {delta == null ? (
        <p className="mt-0.5 text-xs text-muted">no prior data</p>
      ) : flat ? (
        <p className="mt-0.5 text-xs text-muted">about the same as {priorLabel}</p>
      ) : (
        <p className="mt-0.5 text-xs">
          <span className={good ? "font-semibold text-positive" : "font-semibold text-negative"}>
            {Math.abs(delta).toFixed(0)}% {delta > 0 ? "more" : "less"}
          </span>{" "}
          <span className="text-muted">than {priorLabel}</span>
        </p>
      )}
    </div>
  );
}

// Prior-period amount for a donut slice's kind. "uncategorized" tx amounts get
// folded into `expenses` on the flow rollup, so we don't have a clean prior
// number to compare against — surfacing it would just misattribute a change.
function priorForKind(kind: OutflowKind, prior: Flows): number | null {
  if (kind === "uncategorized") return null;
  return prior[kind];
}

function KindTableRow({
  slice,
  priorAmount,
  outTotal,
  currency,
}: {
  slice: KindSlice;
  priorAmount: number | null;
  outTotal: number;
  currency: string;
}) {
  const pctOut = outTotal > 0 ? (slice.amount / outTotal) * 100 : null;
  let changePct: number | null = null;
  if (priorAmount != null && Math.abs(priorAmount) >= 10_00) {
    const raw = ((slice.amount - priorAmount) / Math.abs(priorAmount)) * 100;
    if (Math.abs(raw) <= 500) changePct = raw;
  }
  const changeText =
    changePct == null
      ? "—"
      : Math.abs(changePct) < 0.5
      ? "flat"
      : `${Math.abs(changePct).toFixed(0)}% ${changePct > 0 ? "more" : "less"}`;
  const changeClass =
    changePct == null || Math.abs(changePct) < 0.5
      ? "text-muted"
      : changePct < 0
      ? "font-semibold text-positive"
      : "font-semibold text-negative";

  return (
    <tr className="text-sm">
      <td className="py-2 pr-2">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[slice.kind] }}
          />
          <span className="truncate">{KIND_LABEL[slice.kind]}</span>
        </span>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-muted">
        {pctOut == null ? "—" : `${pctOut.toFixed(0)}%`}
      </td>
      <td className={`py-2 pr-2 text-right tabular-nums ${changeClass}`}>{changeText}</td>
      <td className="py-2 text-right font-semibold tabular-nums">
        {formatMoney(slice.amount, currency)}
      </td>
    </tr>
  );
}

function CategoryTableRow({
  row,
  outTotal,
  currency,
}: {
  row: CategoryRow;
  outTotal: number;
  currency: string;
}) {
  const pctSpend = outTotal > 0 ? (row.amount / outTotal) * 100 : null;
  const prior = row.priorAmount;
  // Change vs prior period — suppressed when the prior amount is missing or
  // near-zero (avoids nonsense percentages like +4690% when last period had $1).
  let changePct: number | null = null;
  if (prior != null && Math.abs(prior) >= 10_00) {
    const raw = ((row.amount - prior) / Math.abs(prior)) * 100;
    if (Math.abs(raw) <= 500) changePct = raw;
  }
  const changeText =
    changePct == null
      ? "—"
      : Math.abs(changePct) < 0.5
      ? "flat"
      : `${Math.abs(changePct).toFixed(0)}% ${changePct > 0 ? "more" : "less"}`;
  // Category spending: a drop is good (green), a rise is bad (red). "flat" and
  // "—" stay muted so they never masquerade as feedback.
  const changeClass =
    changePct == null || Math.abs(changePct) < 0.5
      ? "text-muted"
      : changePct < 0
      ? "font-semibold text-positive"
      : "font-semibold text-negative";

  return (
    <tr className="text-sm">
      <td className="py-2 pr-2">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[row.kind] }}
          />
          <span className="truncate">{row.name}</span>
        </span>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-muted">
        {pctSpend == null ? "—" : `${pctSpend.toFixed(0)}%`}
      </td>
      <td className={`py-2 pr-2 text-right tabular-nums ${changeClass}`}>{changeText}</td>
      <td className="py-2 text-right font-semibold tabular-nums">
        {formatMoney(row.amount, currency)}
      </td>
    </tr>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const MON = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MON[m - 1]} ${d}, ${y}`;
}
