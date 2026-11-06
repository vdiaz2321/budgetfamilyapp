"use client";

import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/money";
import {
  outflowOf,
  spendingOf,
  type CategoryRow,
  type ChartBucket,
  type Flows,
  type InsightsData,
  type OutflowKind,
} from "./types";
import { Donut, KIND_COLOR, KIND_LABEL, TrendChart, type SelectMode } from "./insights-charts";
import { PeriodPicker } from "./insights-period-picker";
import { computeInsights, todayDate, type InsightsRaw } from "./compute";
import { currentPeriodKey, isGranularity, normalizePeriodKey, priorKey, type Granularity } from "./period";

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
  // Short period names for the table headers, so each column says which
  // period it is: "Oct amount", "% of Oct out", "vs Sep" (or "vs Oct 1–6"
  // while the month is still running).
  const curShort = multi ? "Total" : shortPeriod(data.granularity, data.periodKey);
  const priorShort = data.priorShortLabel.includes("–")
    ? data.priorShortLabel
    : data.granularity === "weekly"
      ? "last week"
      : shortPeriod(data.granularity, priorKey(data.granularity, data.periodKey));
  const unit =
    data.granularity === "weekly" ? "weeks"
      : data.granularity === "monthly" ? "months"
      : data.granularity === "quarterly" ? "quarters"
      : "years";
  const combinedNote = multi ? `${data.periodKeys.length} ${unit} combined` : undefined;

  const outTotal = outflowOf(data.totals);
  // Biggest kind first, in both the donut and its table.
  const kindsBySize = [...data.kinds].sort((a, b) => b.amount - a.amount);
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
  const kids = stat((f) => f.kids);

  // The trend series each tile's sparkline draws, with the selected period's
  // point marked.
  const spark = (pick: (b: ChartBucket) => number) =>
    data.buckets.map((b) => ({ value: pick(b), selected: b.selected }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <PeriodPicker
          granularity={data.granularity}
          periodKey={multi ? "" : data.periodKey}
          label={data.periodLabel}
          minYear={data.minYear}
          since={data.firstTxDate}
          onSelect={go}
        />
      </div>

      {/* Hero stats — the selected period, each over its own trend */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Income" {...income} color="var(--positive)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} trend={spark((b) => b.income)} />
        <StatCard label="Bills & Expenses" {...spending} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} trend={spark((b) => b.spending)} />
        <StatCard label="Savings" {...savings} color="var(--viz-savings)" deltaGoodWhen="up" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} trend={spark((b) => b.savings)} />
        <StatCard label="Debt paid" {...debt} color="var(--negative)" deltaGoodWhen="down" currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} trend={spark((b) => b.debt)} />
        <StatCard label="Kids funding" {...kids} color="var(--foreground)" deltaGoodWhen={null} currency={data.currency} priorLabel={data.priorLabel} note={combinedNote} trend={spark((b) => b.kids)} className="col-span-2 sm:col-span-1" />
      </div>

      {/* Trend — click a bar to jump the whole page to that period. Clicking
          empty space inside this card (but not a bar) also resets to the
          current period, so a stray selection can be undone without hunting.
          Scoped to just this section so clicks on the donut or tables below
          don't unintentionally reset. */}
      <section
        className={CARD}
        onClick={(e) => {
          if (!multi && data.periodKey === currentKey) return;
          if ((e.target as HTMLElement).closest("button")) return;
          go(data.granularity, currentKey);
        }}
      >
        <CardHead
          title="Income vs. bills & expenses"
          note={
            <>
              Tap a bar to look at that period
              <span className="hidden sm:inline"> · Ctrl/⌘-click to add more</span>
            </>
          }
        />
        <TrendChart buckets={data.buckets} currency={data.currency} onSelect={selectPeriod} />
      </section>

      {!hasData ? (
        <div className={`${CARD} px-6 py-12 text-center`}>
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
            <section className={CARD}>
              <CardHead
                title="Where it went"
                note={multi ? `${data.periodLabel}` : `${data.periodLabel} · vs ${data.priorLabel}`}
              />
              <div className="flex justify-center">
                <Donut slices={kindsBySize} total={outTotal} currency={data.currency} />
              </div>
              <table className="mt-4 w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-semibold">
                    <th className="pb-2 text-left">Category</th>
                    <th className="hidden w-12 whitespace-nowrap pb-2 text-center sm:table-cell sm:w-24">% of {curShort}</th>
                    {multi ? null : <th className="w-[5.5rem] whitespace-nowrap pb-2 text-center sm:w-28">{priorShort} amount</th>}
                    <th className="w-24 whitespace-nowrap pb-2 text-center sm:w-28">{curShort} amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {kindsBySize.map((k) => {
                    // "uncategorized" folds into expenses on the prior rollup,
                    // so it has no clean prior to compare against.
                    const prior = k.kind === "uncategorized" ? null : data.prior[k.kind];
                    const changePct = prior != null && Math.abs(prior) >= 10_00 ? ((k.amount - prior) / Math.abs(prior)) * 100 : null;
                    return (
                      <tr key={k.kind}>
                        <td className="py-2 pr-2">
                          <span className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: KIND_COLOR[k.kind] }} />
                            <span className="truncate">{KIND_LABEL[k.kind]}</span>
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap py-2 text-center tabular-nums sm:table-cell">
                          {outTotal > 0 ? `${Math.round((k.amount / outTotal) * 100)}%` : "—"}
                        </td>
                        {multi ? null : (
                          <td className="whitespace-nowrap py-2 text-center tabular-nums">
                            {prior == null ? "—" : formatMoney(prior, data.currency)}
                          </td>
                        )}
                        <td className={`whitespace-nowrap py-2 text-center font-semibold tabular-nums ${multi ? "" : amountTone(changePct, k.kind)}`}>
                          {formatMoney(k.amount, data.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className={CARD}>
              <CardHead
                title="Top categories"
                note={multi ? data.periodLabel : `${data.periodLabel} · vs ${data.priorLabel}`}
              />
              {data.categories.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No categorized spending in this period.
                </p>
              ) : (
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-semibold">
                      <th className="pb-2 text-left font-medium">Category</th>
                      <th className="hidden w-12 whitespace-nowrap pb-2 text-center font-medium sm:table-cell sm:w-24">% of {curShort}</th>
                      {multi ? null : <th className="w-[5.5rem] sm:w-28 whitespace-nowrap pb-2 text-center font-medium">{priorShort} amount</th>}
                      <th className="w-24 sm:w-28 whitespace-nowrap pb-2 text-center font-medium">{curShort} amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.categories.map((c) => (
                      <CategoryTableRow
                        key={c.subId}
                        row={c}
                        maxAmount={data.categories[0].amount}
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
              <section className={CARD}>
                <CardHead title="Top merchants" note={data.periodLabel} />
                {data.merchants.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">No merchant activity in this period.</p>
                ) : (
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs font-semibold">
                        <th className="pb-2 text-left">Merchant</th>
                        <th className="w-16 pb-2 text-center">Buys</th>
                        <th className="w-[5.5rem] pb-2 text-center sm:w-28">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.merchants.map((m) => (
                        <tr key={m.name}>
                          <td className="py-2 pr-2">
                            <span className="block truncate">{m.name}</span>
                            <RankBar fraction={m.total / data.merchants[0].total} color={KIND_COLOR.bills} />
                          </td>
                          <td className="py-2 text-center tabular-nums">{m.count}</td>
                          <td className="whitespace-nowrap py-2 text-center font-semibold tabular-nums">
                            {formatMoney(m.total, data.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className={CARD}>
                <CardHead title="Largest purchases" note={data.periodLabel} />
                {data.purchases.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">No purchases in this period.</p>
                ) : (
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs font-semibold">
                        <th className="pb-2 text-left">Merchant</th>
                        <th className="hidden w-24 pb-2 text-center sm:table-cell">Date</th>
                        <th className="w-[5.5rem] pb-2 text-center sm:w-28">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.purchases.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 pr-2">
                            <span className="block truncate">{p.payee}</span>
                            <span className="block truncate text-xs text-muted">
                              <span className="sm:hidden">{formatDate(p.date)} · </span>
                              {p.sub}
                            </span>
                          </td>
                          <td className="hidden whitespace-nowrap py-2 text-center tabular-nums sm:table-cell">{formatDate(p.date)}</td>
                          <td className="whitespace-nowrap py-2 text-center font-semibold tabular-nums text-negative">
                            {formatMoney(p.amount, data.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          ) : (
            <div className={`${CARD} text-sm text-muted`}>
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
// Tables show last period's amount beside this one; this period's amount is
// red when it went up (green for savings), green when it went down.
function amountTone(changePct: number | null, kind: OutflowKind): string {
  if (changePct == null || Math.abs(changePct) < 0.5) return "";
  const good = kind === "savings" ? changePct > 0 : changePct < 0;
  return good ? "text-positive" : "text-negative";
}

// Every panel on the page shares one card look.
const CARD = "rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 sm:p-5 dark:ring-white/10";

function CardHead({ title, note }: { title: string; note: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}

// A thin in-row bar sized against the biggest row, so a ranked list reads at
// a glance without a separate chart.
function RankBar({ fraction, color }: { fraction: number; color: string }) {
  return (
    <span className="mt-1.5 block h-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--viz-grid)" }}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(2, Math.min(1, fraction) * 100)}%`, backgroundColor: color }}
      />
    </span>
  );
}

// The metric across the trend chart's periods, the selected one dotted.
function Sparkline({ points, color }: { points: { value: number; selected: boolean }[]; color: string }) {
  if (points.length < 2) return <div className="h-8" />;
  const W = 100;
  const H = 28;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * (W - 4) + 2,
    y: H - 3 - ((p.value - lo) / span) * (H - 6),
    selected: p.selected,
  }));
  // The line stretches to the tile's width; the selected dot is an HTML dot
  // placed by percentage, so the stretch doesn't squash it into an oval.
  return (
    <div className="relative mt-2 h-8 w-full" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <polyline
          points={xy.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
        />
      </svg>
      {xy
        .filter((p) => p.selected)
        .map((p) => (
          <span
            key={p.x}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, backgroundColor: color }}
          />
        ))}
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
  note,
  trend,
  className = "",
}: {
  label: string;
  value: number;
  color: string;
  currency: string;
  delta: number | null;
  // null: a change is neither good nor bad (kids funding), so it stays ink.
  deltaGoodWhen: "up" | "down" | null;
  priorLabel: string;
  // Replaces the comparison line (e.g. "3 months combined" for a multi-pick).
  note?: string;
  trend: { value: number; selected: boolean }[];
  className?: string;
}) {
  // No arrows: the wording ("less than" / "more than") already carries
  // direction, and the color carries whether that direction is good — an arrow
  // on top of both just reads as a contradiction.
  const flat = delta != null && Math.abs(delta) < 0.5;
  const good =
    delta == null || flat || deltaGoodWhen == null
      ? null
      : deltaGoodWhen === "up"
      ? delta > 0
      : delta < 0;

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface px-4 pb-3 pt-3.5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${className}`}>
      {/* Colour stripe along the top ties the tile to its metric. */}
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums sm:text-2xl" style={{ color }}>
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
          <span className={good == null ? "font-semibold" : good ? "font-semibold text-positive" : "font-semibold text-negative"}>
            {changeWords(delta)}
          </span>{" "}
          <span className="text-muted">than <span className="whitespace-nowrap">{priorLabel}</span></span>
        </p>
      )}
      <Sparkline points={trend} color={color} />
    </div>
  );
}

function CategoryTableRow({
  row,
  maxAmount,
  outTotal,
  currency,
  showChange,
}: {
  row: CategoryRow;
  maxAmount: number;
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
  const amountClass = showChange ? amountTone(changePct, row.kind) : "";

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
        <RankBar fraction={maxAmount > 0 ? row.amount / maxAmount : 0} color={KIND_COLOR[row.kind]} />
      </td>
      {/* Hidden on phones: the category name needs that width more. */}
      <td className="hidden whitespace-nowrap py-2 text-center tabular-nums text-muted sm:table-cell">
        {pctSpend == null ? "—" : `${pctSpend.toFixed(0)}%`}
      </td>
      {showChange ? (
        <td className="whitespace-nowrap py-2 text-center tabular-nums">
          {prior == null ? "—" : formatMoney(prior, currency)}
        </td>
      ) : null}
      <td className={`whitespace-nowrap py-2 text-center font-semibold tabular-nums ${amountClass}`}>
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

// "Oct", "Q3", "2026" or "Week" — short enough for a column header on a
// phone (the card's subtitle names the exact week).
function shortPeriod(g: Granularity, key: string): string {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  switch (g) {
    case "monthly":
      return MON[Number(key.slice(5, 7)) - 1];
    case "quarterly":
      return `Q${key.slice(6)}`;
    case "yearly":
      return key;
    default:
      return "Week";
  }
}
