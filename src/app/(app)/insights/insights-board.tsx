"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
import { Donut, KIND_COLOR, KIND_LABEL, TrendChart, type SelectMode } from "./insights-charts";
import { PeriodPicker } from "./insights-period-picker";
import { computeInsights, todayDate, type InsightsRaw } from "./compute";
import { currentPeriodKey, isGranularity, normalizePeriodKey, type Granularity } from "./period";

export function InsightsBoard({ raw }: { raw: InsightsRaw }) {
  // The period lives in the URL (?g=&p=) so Back and bookmarks work, but
  // changing it never goes to the server: pushState updates useSearchParams
  // and the numbers are recomputed here from rows the page already has.
  const sp = useSearchParams();
  const rawG = sp.get("g");
  const granularity: Granularity = isGranularity(rawG) ? rawG : "monthly";
  // Normalized, never trusted raw: an unparseable ?p= used to crash the page
  // (see normalizePeriodKey), and an off-Monday weekly key silently produced
  // a window no other panel agreed with.
  // ?p= holds one key, or several joined by commas (Ctrl/⌘-click picks).
  const currentKey = currentPeriodKey(granularity, todayDate(raw.today));
  const pParam = sp.get("p") ?? "";
  const picked = [
    ...new Set(
      pParam
        .split(",")
        .map((k) => normalizePeriodKey(granularity, k))
        .filter((k): k is string => k != null),
    ),
  ].sort();
  const keysParam = (picked.length ? picked : [currentKey]).join(",");
  const data: InsightsData = useMemo(
    () => computeInsights(raw, granularity, keysParam.split(",")),
    [raw, granularity, keysParam],
  );
  const go = (g: Granularity, keys: string | string[]) => {
    const p = Array.isArray(keys) ? [...keys].sort().join(",") : keys;
    window.history.pushState(null, "", `/insights?g=${g}&p=${encodeURIComponent(p)}`);
  };
  // Plain click: that period alone — or, on the only selected bar, back to the
  // current period so a stray click can be undone. Ctrl/⌘-click adds or drops
  // a bar; Shift-click selects every bar from the first pick to this one.
  // The page then totals everything selected.
  const selectPeriod = (key: string, mode: SelectMode) => {
    const cur = data.periodKeys;
    if (mode === "toggle") {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      go(data.granularity, next.length ? next : [currentKey]);
    } else if (mode === "range") {
      const order = data.buckets.map((b) => b.key);
      const a = order.indexOf(cur[0]);
      const b = order.indexOf(key);
      if (a < 0 || b < 0) return go(data.granularity, key);
      go(data.granularity, order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      go(data.granularity, cur.length === 1 && cur[0] === key ? currentKey : key);
    }
  };
  const multi = !data.comparable;
  const unit =
    data.granularity === "weekly" ? "weeks"
      : data.granularity === "monthly" ? "months"
      : data.granularity === "quarterly" ? "quarters"
      : "years";
  const combinedNote = multi ? `${data.periodKeys.length} ${unit} combined` : undefined;

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
    // Swings past MUCH_MORE (e.g. month-end pay vs a quiet prior stretch) are
    // real, just not worth a precise figure — StatCard words them "much more".
    return ((current - prior) / Math.abs(prior)) * 100;
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
          periodKey={multi ? "" : data.periodKey}
          label={data.periodLabel}
          minYear={data.minYear}
          onSelect={go}
        />
      </div>

      {/* Hero stats — the selected period */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Income" {...income} color="var(--positive)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} />
        <StatCard label="Spending" {...spending} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} />
        <StatCard label="Savings" {...savings} color="var(--viz-savings)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} />
        <StatCard label="Debt paid" {...debt} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} />
      </div>

      {/* Trend — click a bar to jump the whole page to that period. Clicking
          empty space inside this card (but not a bar) also resets to the
          current period, so a stray selection can be undone without hunting.
          Scoped to just this section so clicks on the donut or tables below
          don't unintentionally reset. */}
      <section
        className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        onClick={(e) => {
          if (!multi && data.periodKey === currentKey) return;
          if ((e.target as HTMLElement).closest("button")) return;
          go(data.granularity, currentKey);
        }}
      >
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Income vs. spending</h2>
          <span className="text-[11px] uppercase tracking-wide text-muted">
            tap a bar to jump to that period
            <span className="hidden sm:inline"> · Ctrl/⌘-click to add more</span>
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
              <table className="mt-4 w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] font-medium uppercase tracking-wide text-muted">
                    <th className="pb-2 text-left font-medium">Category</th>
                    <th className="hidden w-12 sm:w-14 whitespace-nowrap pb-2 text-center font-medium sm:table-cell">% Out</th>
                    {multi ? null : <th className="w-[5.5rem] sm:w-28 whitespace-nowrap pb-2 text-center font-medium">vs {data.priorLabel}</th>}
                    <th className="w-[5.5rem] sm:w-28 whitespace-nowrap pb-2 text-center font-medium">Amount</th>
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
                      showChange={!multi}
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
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-medium uppercase tracking-wide text-muted">
                      <th className="pb-2 text-left font-medium">Category</th>
                      <th className="hidden w-12 sm:w-14 whitespace-nowrap pb-2 text-center font-medium sm:table-cell">% Spend</th>
                      {multi ? null : <th className="w-[5.5rem] sm:w-28 whitespace-nowrap pb-2 text-center font-medium">vs {data.priorLabel}</th>}
                      <th className="w-[5.5rem] sm:w-28 whitespace-nowrap pb-2 text-center font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.categories.map((c) => (
                      <CategoryTableRow
                        key={c.subId}
                        row={c}
                        outTotal={outTotal}
                        currency={data.currency}
                        showChange={!multi}
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

    </div>
  );
}

// Above this, a percentage stops meaning anything useful (+1,089% because
// last month's pay hadn't landed yet), so it reads "much more" instead of
// being hidden behind a "no prior data" that isn't true.
const MUCH_MORE = 500;
function changeWords(pct: number): string {
  if (pct > MUCH_MORE) return "much more";
  return `${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "more" : "less"}`;
}

function StatCard({
  label,
  value,
  color,
  currency,
  delta,
  deltaGoodWhen,
  priorLabel,
  note,
}: {
  label: string;
  value: number;
  color: string;
  currency: string;
  delta: number | null;
  deltaGoodWhen: "up" | "down";
  priorLabel: string;
  // Replaces the comparison line (e.g. "3 months combined" for a multi-pick).
  note?: string;
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
      {note ? (
        <p className="mt-0.5 text-xs text-muted">{note}</p>
      ) : delta == null ? (
        <p className="mt-0.5 text-xs text-muted">no prior data</p>
      ) : flat ? (
        <p className="mt-0.5 text-xs text-muted">about the same as <span className="whitespace-nowrap">{priorLabel}</span></p>
      ) : (
        <p className="mt-0.5 text-xs">
          <span className={good ? "font-semibold text-positive" : "font-semibold text-negative"}>
            {changeWords(delta)}
          </span>{" "}
          <span className="text-muted">than <span className="whitespace-nowrap">{priorLabel}</span></span>
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
  showChange,
}: {
  slice: KindSlice;
  priorAmount: number | null;
  outTotal: number;
  currency: string;
  showChange: boolean;
}) {
  const pctOut = outTotal > 0 ? (slice.amount / outTotal) * 100 : null;
  let changePct: number | null = null;
  if (priorAmount != null && Math.abs(priorAmount) >= 10_00) {
    const raw = ((slice.amount - priorAmount) / Math.abs(priorAmount)) * 100;
    changePct = raw;
  }
  const changeText =
    changePct == null
      ? "—"
      : Math.abs(changePct) < 0.5
      ? "flat"
      : changeWords(changePct);
  const changeClass =
    changePct == null || Math.abs(changePct) < 0.5
      ? "text-muted"
      : changePct < 0
      ? "font-semibold text-positive"
      : "font-semibold text-negative";

  return (
    <tr className="text-sm">
      {/* The table is table-fixed: the figure columns take the set widths on
          their <th>, and the name gets what's left and truncates — so the
          figures keep breathing room and nothing runs past the card. */}
      <td className="py-2 pr-2">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[slice.kind] }}
          />
          <span className="truncate">{KIND_LABEL[slice.kind]}</span>
        </span>
      </td>
      {/* Hidden on phones, like % Spend below: the name needs the width. */}
      <td className="hidden whitespace-nowrap py-2 text-center tabular-nums text-muted sm:table-cell">
        {pctOut == null ? "—" : `${pctOut.toFixed(0)}%`}
      </td>
      {showChange ? <td className={`whitespace-nowrap py-2 text-center tabular-nums ${changeClass}`}>{changeText}</td> : null}
      <td className="whitespace-nowrap py-2 text-center font-semibold tabular-nums">
        {formatMoney(slice.amount, currency)}
      </td>
    </tr>
  );
}

function CategoryTableRow({
  row,
  outTotal,
  currency,
  showChange,
}: {
  row: CategoryRow;
  outTotal: number;
  currency: string;
  showChange: boolean;
}) {
  const pctSpend = outTotal > 0 ? (row.amount / outTotal) * 100 : null;
  const prior = row.priorAmount;
  // Change vs prior period — suppressed when the prior amount is missing or
  // near-zero (avoids nonsense percentages like +4690% when last period had $1).
  let changePct: number | null = null;
  if (prior != null && Math.abs(prior) >= 10_00) {
    const raw = ((row.amount - prior) / Math.abs(prior)) * 100;
    changePct = raw;
  }
  const changeText =
    changePct == null
      ? "—"
      : Math.abs(changePct) < 0.5
      ? "flat"
      : changeWords(changePct);
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
      {/* The table is table-fixed: the figure columns take the set widths on
          their <th>, and the name gets what's left and truncates — so the
          figures keep breathing room and nothing runs past the card. */}
      <td className="py-2 pr-2">
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[row.kind] }}
          />
          <span className="truncate">{row.name}</span>
        </span>
      </td>
      {/* Hidden on phones: the category name needs that width more. */}
      <td className="hidden whitespace-nowrap py-2 text-center tabular-nums text-muted sm:table-cell">
        {pctSpend == null ? "—" : `${pctSpend.toFixed(0)}%`}
      </td>
      {showChange ? <td className={`whitespace-nowrap py-2 text-center tabular-nums ${changeClass}`}>{changeText}</td> : null}
      <td className="whitespace-nowrap py-2 text-center font-semibold tabular-nums">
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
