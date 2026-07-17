"use client";

import { Fragment, useState } from "react";
import { formatMoney } from "@/lib/money";

export type MonthPoint = {
  month: string; // YYYY-MM-01
  assets: number;
  liabilities: number;
  net: number;
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(month: string): string {
  const idx = parseInt(month.slice(5, 7), 10) - 1;
  return `${MONTHS_SHORT[idx]} ${month.slice(0, 4)}`;
}

// Compact tick label: $12.5K / $1.2M (cents in, display out).
function compactMoney(cents: number, currency: string): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${sym}${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${sym}${Math.round(abs)}`;
}

// Round a raw step up to a clean 1/2/5 × 10^n value.
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * pow;
}

// Clean y-axis ticks spanning [min, max].
function makeTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return makeTicks(min - pad, max + pad);
  }
  const step = niceStep((max - min) / 4);
  const start = Math.floor(min / step) * step;
  // Always push a tick past max — stopping at the first tick short of it
  // (the old off-by-one here) left points above it rendering off the top
  // of the chart, invisible.
  const ticks: number[] = [];
  for (let v = start; ; v += step) {
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

// One account (or Budget debt) row in the monthly balances grid.
export type GridRow = {
  name: string;
  liability: boolean;
  // Account is linked to a Budget debt — shown but not counted (the debt row is).
  linked: boolean;
  // Kids Funding — shown but not counted.
  excluded?: boolean;
  // Same grouping as the sidebar, so the two views read as one system.
  section: "Budget" | "Investments" | "Kids Funding" | "Credit Cards" | "Loans";
  balances: (number | null)[]; // aligned to gridMonths
  // A bucket / "Unallocated" sub-row indented under its parent account.
  indent?: boolean;
  // Parent account that has bucket sub-rows below it.
  hasChildren?: boolean;
  // The auto "Unallocated" remainder row — rendered subtly.
  muted?: boolean;
  // Set on a hasChildren row so its bucket rows can be collapsed by id.
  id?: string;
  // Set on a bucket / Unallocated row — the id of the account it belongs to.
  parentId?: string;
};

const SECTION_ORDER: GridRow["section"][] = [
  "Budget",
  "Investments",
  "Kids Funding",
  "Credit Cards",
  "Loans",
];

type Props = {
  points: MonthPoint[];
  gridMonths: string[];
  gridRows: GridRow[];
  currency: string;
};

export function NetworthBoard({ points, gridMonths, gridRows, currency }: Props) {
  const latest = points[points.length - 1] ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Net Worth</h1>
        <p className="text-sm text-muted">
          Assets minus debts, archived monthly from your Accounts and Budget debt balances.
        </p>
      </div>

      {/* Current position */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Assets" value={latest?.assets ?? 0} currency={currency} tone="text-positive" />
        <Stat label="Debts" value={latest?.liabilities ?? 0} currency={currency} tone="text-negative" />
        <Stat
          label="Net worth"
          value={latest?.net ?? 0}
          currency={currency}
          tone={(latest?.net ?? 0) >= 0 ? "text-foreground" : "text-negative"}
        />
      </div>

      {/* Over-time chart */}
      <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="font-semibold">Net worth over time</h2>
        </div>
        {points.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No history yet — it starts accruing as soon as you enter account balances.
            Each month freezes automatically; check back as months pass.
          </p>
        ) : (
          <NetworthChart points={points} currency={currency} />
        )}
      </section>

      {/* Monthly balances by account — the sheet's MonthlyNetWorth tab */}
      {gridRows.length > 0 ? (
        <BalanceGrid
          months={gridMonths}
          rows={gridRows}
          points={points}
          currency={currency}
        />
      ) : null}

      {/* Year by year */}
      {points.length > 0 ? <YearTable points={points} currency={currency} /> : null}

      {/* Monthly history */}
      {points.length > 0 ? <MonthTable points={points} currency={currency} /> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

// Single-series line: 2px brand line, 10% area wash, end dot with surface
// ring, hairline gridlines, crosshair + tooltip snapping to nearest month.
function NetworthChart({ points, currency }: { points: MonthPoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 280;
  const M = { l: 56, r: 20, t: 16, b: 30 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const nets = points.map((p) => p.net);
  const ticks = makeTicks(Math.min(0, ...nets), Math.max(0, ...nets));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const x = (i: number) =>
    M.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.net)}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L${x(points.length - 1)},${y(Math.max(yMin, 0))} L${x(0)},${y(Math.max(yMin, 0))} Z`
      : null;

  // Snap pointer to the nearest month.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const rel = (px - M.l) / (points.length === 1 ? 1 : iw);
    const idx = Math.round(rel * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, points.length === 1 ? 0 : idx)));
  };

  const hovered = hover != null ? points[hover] : null;
  const lastIdx = points.length - 1;

  // X labels: first, last, and up to ~4 evenly spaced between.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {/* Area wash fades to nothing toward the baseline — reads cleaner
              than a flat fill, especially in dark mode. */}
          <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Gridlines + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4"
            />
            <text
              x={M.l - 8} y={y(t) + 3.5}
              textAnchor="end" fontSize="11"
              fill="var(--muted)"
            >
              {compactMoney(t, currency)}
            </text>
          </g>
        ))}

        {/* Zero line, slightly stronger when negative territory is in view */}
        {yMin < 0 ? (
          <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />
        ) : null}

        {/* Area wash + line */}
        {areaPath ? <path d={areaPath} fill="url(#nw-fill)" /> : null}
        {points.length > 1 ? (
          <path
            d={linePath}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {/* End dot (always) + hovered dot, both with surface ring */}
        <circle cx={x(lastIdx)} cy={y(points[lastIdx].net)} r="6" fill="var(--surface)" />
        <circle cx={x(lastIdx)} cy={y(points[lastIdx].net)} r="4" fill="var(--brand)" />
        {hover != null && hover !== lastIdx ? (
          <>
            <circle cx={x(hover)} cy={y(points[hover].net)} r="6" fill="var(--surface)" />
            <circle cx={x(hover)} cy={y(points[hover].net)} r="4" fill="var(--brand)" />
          </>
        ) : null}

        {/* Crosshair */}
        {hover != null ? (
          <line
            x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih}
            stroke="var(--muted)" strokeWidth="1"
          />
        ) : null}

        {/* X labels */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === lastIdx ? (
            <text
              key={p.month}
              x={x(i)} y={H - 8}
              textAnchor="middle" fontSize="11"
              fill="var(--muted)"
            >
              {monthLabel(p.month)}
            </text>
          ) : null,
        )}
      </svg>

      {/* Tooltip — value leads, label follows */}
      {hovered != null && hover != null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg bg-surface px-3 py-2 text-center shadow-md ring-1 ring-black/10 dark:ring-white/15"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="text-sm font-bold tabular-nums">{formatMoney(hovered.net, currency)}</p>
          <p className="text-[11px] text-muted">{monthLabel(hovered.month)}</p>
          <p className="text-[10px] text-muted tabular-nums">
            {formatMoney(hovered.assets, currency)} assets · {formatMoney(hovered.liabilities, currency)} debts
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Accounts × months grid: your monthly checkup view. Update balances on the
// Accounts page and this month's column tracks them; past columns are frozen.
function BalanceGrid({
  months,
  rows,
  points,
  currency,
}: {
  months: string[];
  rows: GridRow[];
  points: MonthPoint[];
  currency: string;
}) {
  const sections = SECTION_ORDER.map((section) => ({
    section,
    rows: rows.filter((r) => r.section === section),
  })).filter((g) => g.rows.length > 0);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (section: string) =>
    setCollapsed((c) => ({ ...c, [section]: !c[section] }));
  const allOpen = sections.every((g) => !collapsed[g.section]);
  const toggleAll = () =>
    setCollapsed(Object.fromEntries(sections.map((g) => [g.section, allOpen])));

  // Per-account collapse (e.g. Amex Savings's buckets), independent of the
  // section-level collapse above.
  const [collapsedAccounts, setCollapsedAccounts] = useState<Record<string, boolean>>({});
  const toggleAccount = (id: string) =>
    setCollapsedAccounts((c) => ({ ...c, [id]: !c[id] }));

  // Per-section, per-month subtotal — top-level rows only, so bucket rows
  // and the Unallocated remainder (already inside their parent account's
  // balance) aren't counted twice.
  // "excluded" (Kids Funding) rows still count toward their own section's
  // subtotal here — only the grand "Net worth" row (from `points`, computed
  // server-side) skips them.
  const sectionTotal = (g: (typeof sections)[number], i: number) => {
    let sum = 0;
    let any = false;
    for (const r of g.rows) {
      if (r.indent) continue;
      const v = r.balances[i];
      if (v == null) continue;
      any = true;
      sum += v;
    }
    return any ? sum : null;
  };

  const cell = (r: GridRow, i: number) => {
    const v = r.balances[i];
    if (v == null) return <span className="text-muted">—</span>;
    return (
      <span className={r.liability && v > 0 ? "text-negative" : ""}>
        {formatMoney(v, currency)}
      </span>
    );
  };

  // Name-cell weight is one of exactly three looks, and every top-level row
  // (account or debt) shares the same weight regardless of whether it has
  // buckets — never stack more than one weight class, or the row reads bold
  // in one browser and medium in another depending on Tailwind's generated
  // rule order.
  const nameCls = (r: GridRow) =>
    r.muted
      ? "italic font-normal text-muted"
      : r.indent
        ? "font-normal text-foreground"
        : "font-medium";

  const stickyCls = "sticky left-0 bg-surface pr-3";
  const hasUnallocated = rows.some((r) => r.muted);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="font-semibold">Monthly balances</h2>
          <p className="text-xs text-muted">
            Each account&apos;s value as of each month — update balances on Accounts, this
            month&apos;s column follows; past months stay frozen.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="shrink-0 whitespace-nowrap rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-brand shadow-sm ring-1 ring-black/10 transition hover:bg-brand-soft dark:ring-white/15"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={`${stickyCls} px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted`}>
                Account
              </th>
              {months.map((m) => (
                <th key={m} className="whitespace-nowrap px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((g) => {
              const isOpen = !collapsed[g.section];
              const accountCount = g.rows.filter((r) => !r.indent).length;
              return (
                <Fragment key={g.section}>
                  <tr className="border-b border-line bg-brand-soft/50 dark:bg-brand-soft/15">
                    <td className="sticky left-0 z-10 bg-brand-soft/50 pr-3 p-0 dark:bg-brand-soft/15">
                      <button
                        type="button"
                        onClick={() => toggle(g.section)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-1.5 px-4 py-2 text-left transition hover:bg-brand-soft/70 dark:hover:bg-brand-soft/25"
                      >
                        <svg
                          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                          className={`shrink-0 text-brand transition-transform ${isOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span className="text-sm font-bold uppercase tracking-wider text-foreground">
                          {g.section}
                        </span>
                        <span className="text-xs font-normal normal-case text-muted">
                          {accountCount} {accountCount === 1 ? "account" : "accounts"}
                        </span>
                      </button>
                    </td>
                    {months.map((m, i) => {
                      const total = sectionTotal(g, i);
                      const isLiabilitySection = g.rows[0]?.liability ?? false;
                      return (
                        <td key={m} className="whitespace-nowrap px-3 py-2 text-center text-sm font-bold tabular-nums">
                          {total == null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={isLiabilitySection && total > 0 ? "text-negative" : ""}>
                              {formatMoney(total, currency)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen
                    ? g.rows
                        .filter((r) => !r.parentId || !collapsedAccounts[r.parentId])
                        .map((r, ri) => {
                          const accountOpen = !r.id || !collapsedAccounts[r.id];
                          return (
                            <tr
                              key={`${g.section}-${ri}-${r.name}`}
                              className={`border-b border-line ${r.indent ? "bg-background/30" : ""} ${r.linked || r.excluded ? "opacity-50" : ""}`}
                            >
                              <td
                                className={`${stickyCls} whitespace-nowrap ${
                                  r.hasChildren
                                    ? "p-0"
                                    : r.indent
                                      ? "py-2 pl-9 text-[0.9375rem]"
                                      : "px-4 py-2"
                                } ${nameCls(r)}`}
                                title={r.muted ? "Account balance minus its bucket totals — the part not parked in a named bucket." : undefined}
                              >
                                {r.hasChildren && r.id ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleAccount(r.id!)}
                                    aria-expanded={accountOpen}
                                    className="flex w-full items-center gap-1 px-4 py-2 text-left transition hover:bg-background/60"
                                  >
                                    <svg
                                      width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                      strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                                      className={`shrink-0 text-muted transition-transform ${accountOpen ? "rotate-90" : ""}`}
                                      aria-hidden
                                    >
                                      <path d="M9 6l6 6-6 6" />
                                    </svg>
                                    {r.name}
                                    {r.excluded ? <ExcludedChip /> : null}
                                  </button>
                                ) : (
                                  <>
                                    {r.name}
                                    {r.linked ? (
                                      <span className="ml-1.5 rounded bg-brand-soft px-1 py-0.5 text-[9px] font-semibold uppercase text-brand">
                                        linked
                                      </span>
                                    ) : null}
                                    {r.excluded ? <ExcludedChip /> : null}
                                  </>
                                )}
                              </td>
                              {months.map((m, i) => (
                                <td
                                  key={m}
                                  className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${
                                    r.muted ? "italic text-muted" : ""
                                  }`}
                                >
                                  {cell(r, i)}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                    : null}
                </Fragment>
              );
            })}
            <tr>
              <td className={`${stickyCls} whitespace-nowrap px-4 py-2 font-bold`}>Net worth</td>
              {points.map((p) => (
                <td
                  key={p.month}
                  className={`whitespace-nowrap px-3 py-2 text-center font-bold tabular-nums ${
                    p.net < 0 ? "text-negative" : ""
                  }`}
                >
                  {formatMoney(p.net, currency)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {hasUnallocated || rows.some((r) => r.linked || r.excluded) ? (
        <div className="space-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          {hasUnallocated ? (
            <p>
              <span className="italic">Unallocated</span> = the account&apos;s balance minus
              its buckets&apos; balances — whatever isn&apos;t parked in one of the named
              buckets below it. It should read $0.00 once every dollar has a bucket.
            </p>
          ) : null}
          {rows.some((r) => r.linked) ? (
            <p>&ldquo;Linked&rdquo; accounts are counted through their Budget debt row, not twice.</p>
          ) : null}
          {rows.some((r) => r.excluded) ? (
            <p>
              Kids Funding accounts are tracked here but excluded from every total —
              it&apos;s the kids&apos; money, not the household&apos;s.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExcludedChip() {
  return (
    <span
      title="Kids Funding — tracked here, excluded from every total"
      className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[9px] font-semibold uppercase text-muted dark:bg-white/10"
    >
      not counted
    </span>
  );
}

function YearTable({ points, currency }: { points: MonthPoint[]; currency: string }) {
  // Last snapshot of each year = that year's closing position.
  const byYear = new Map<string, MonthPoint>();
  for (const p of points) byYear.set(p.month.slice(0, 4), p);
  const years = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="grid grid-cols-[4rem_1fr_8rem_8rem] items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="col-span-2 font-semibold">Year by year</h2>
        <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Net worth</span>
        <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Change</span>
      </div>
      <ul className="divide-y divide-line">
        {years.map(([year, p], i) => {
          const prev = i > 0 ? years[i - 1][1] : null;
          const delta = prev ? p.net - prev.net : null;
          return (
            <li key={year} className="grid grid-cols-[4rem_1fr_8rem_8rem] items-center gap-2 px-4 py-2">
              <span className="text-sm font-semibold">{year}</span>
              <span className="text-xs text-muted">as of {monthLabel(p.month)}</span>
              <span className="text-center text-sm font-bold tabular-nums">
                {formatMoney(p.net, currency)}
              </span>
              <span
                title={delta == null ? "No prior year to compare against yet" : undefined}
                className={`text-center text-sm tabular-nums ${
                  delta == null ? "text-muted" : delta >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatMoney(delta, currency)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const MONTH_TABLE_COLS = "grid-cols-[minmax(5rem,1fr)_minmax(6.5rem,9rem)_minmax(6.5rem,9rem)_minmax(6.5rem,9rem)]";

function MonthTable({ points, currency }: { points: MonthPoint[]; currency: string }) {
  const desc = [...points].reverse();
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="overflow-x-auto">
        <div className="min-w-[28rem]">
          <div className={`grid ${MONTH_TABLE_COLS} items-center gap-3 border-b border-line px-4 py-2.5`}>
            <h2 className="font-semibold">Monthly history</h2>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Assets</span>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Debts</span>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Net</span>
          </div>
          <ul className="divide-y divide-line">
            {desc.map((p) => (
              <li key={p.month} className={`grid ${MONTH_TABLE_COLS} items-center gap-3 px-4 py-2`}>
                <span className="text-sm">{monthLabel(p.month)}</span>
                <span className="text-center text-sm tabular-nums">{formatMoney(p.assets, currency)}</span>
                <span className="text-center text-sm tabular-nums">{formatMoney(p.liabilities, currency)}</span>
                <span className={`text-center text-sm font-semibold tabular-nums ${p.net < 0 ? "text-negative" : ""}`}>
                  {formatMoney(p.net, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
