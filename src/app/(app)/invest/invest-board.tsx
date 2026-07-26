"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { setInvestmentYear } from "./actions";
import { useSessionCollapse } from "@/lib/use-session-collapse";

export type YearCell = {
  year: number;
  startBalanceCents: number | null;
  endBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
  stored: boolean;
};

export type BucketRow = {
  id: string;
  name: string;
  balanceCents: number;
  cells: Record<number, YearCell>;
};

export type InvestAccount = {
  id: string;
  name: string;
  holder: string | null;
  subtype: string | null;
  isKids: boolean;
  cells: Record<number, YearCell>;
  buckets: BucketRow[];
};

// Roll up an account's cell + all its bucket cells for a given year. Historical
// CSV seed values live at the account level (bucket_id NULL); going-forward
// per-bucket edits and transactions add on top. Chart/summary/parent-row use
// this effective total; the underlying slots stay editable individually.
function effectiveCell(a: InvestAccount, year: number): YearCell {
  const parent = a.cells[year];
  let contributed = parent?.contributedCents ?? 0;
  let accrued = parent?.accruedCents ?? 0;
  let start = parent?.startBalanceCents ?? null;
  let end = parent?.endBalanceCents ?? null;
  for (const b of a.buckets) {
    const c = b.cells[year];
    if (!c) continue;
    contributed += c.contributedCents;
    accrued += c.accruedCents;
    if (c.startBalanceCents != null) start = (start ?? 0) + c.startBalanceCents;
    if (c.endBalanceCents != null) end = (end ?? 0) + c.endBalanceCents;
  }
  return {
    year,
    startBalanceCents: start,
    endBalanceCents: end,
    contributedCents: contributed,
    accruedCents: accrued,
    stored: !!(parent?.stored ?? false),
  };
}

type Props = {
  accounts: InvestAccount[];
  years: number[]; // newest first
  currency: string;
};

const gainTone = (cents: number) =>
  cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "text-foreground";

// Return in DOLLARS (cents): gains − contributions. Positive when investments made
// more than the year's deposits, negative when they didn't. Shown green / red.
// Returns null when neither contributed nor gained (nothing to compare).
function returnPct(cell: {
  startBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
}, _priorEndCents?: number | null): number | null {
  if (cell.contributedCents === 0 && cell.accruedCents === 0) return null;
  return cell.accruedCents - cell.contributedCents;
}

export function InvestBoard({ accounts, years, currency }: Props) {
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mine = accounts.filter((a) => !a.isKids);
  const kids = accounts.filter((a) => a.isKids);
  const selectedAccount = selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null;
  const chartAccounts = selectedAccount ? [selectedAccount] : mine;

  const yearIdx = years.indexOf(year);
  const goPrev = () => yearIdx < years.length - 1 && setYear(years[yearIdx + 1]);
  const goNext = () => yearIdx > 0 && setYear(years[yearIdx - 1]);

  // Summary totals for the selected year (used in hero + stats bar).
  const summary = useMemo(() => {
    let contributed = 0;
    let gains = 0;
    let current = 0;
    for (const a of mine) {
      const c = effectiveCell(a, year);
      contributed += c.contributedCents;
      gains += c.accruedCents;
      if (c.endBalanceCents != null) current += c.endBalanceCents;
    }
    return { contributed, gains, current, accountCount: mine.length };
  }, [mine, year]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
      {/* Header: title + hero total return + year nav */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Investments</h1>
          <p className="text-sm text-muted">
            Contributions vs. unrealized gains, per account, per year.
          </p>
          <p className="mt-2 max-w-xl rounded-lg bg-brand-soft/60 px-3 py-2 text-[12px] leading-snug text-foreground/80 ring-1 ring-brand/20">
            <span className="font-semibold">End-of-year review:</span> update each investment account&apos;s balance on the <span className="font-semibold">Accounts</span> page to the final year-end statement number, then enter this year&apos;s <span className="font-semibold">Gains</span> below (market gain/loss the brokerage reported). New contributions logged as transactions automatically add to this year&apos;s Contrib for the account (and bucket) you pick.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Total return ({year})
            </p>
            <p className={`text-xl font-semibold tabular-nums ${summary.gains >= 0 ? "text-positive" : "text-negative"}`}>
              {summary.gains >= 0 ? "+" : ""}{formatMoney(summary.gains, currency)}
            </p>
          </div>
          <div className="flex items-center gap-1 self-center">
            <button
              type="button"
              onClick={goPrev}
              disabled={yearIdx >= years.length - 1}
              aria-label="Previous year"
              className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <select
              aria-label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="cursor-pointer rounded-lg bg-background px-3 py-1.5 text-sm font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={goNext}
              disabled={yearIdx <= 0}
              aria-label="Next year"
              className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-2xl bg-surface px-6 py-12 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm text-muted">
            No investment accounts yet. Add one on the Accounts page (kind:
            Investment) to track its performance here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary stats bar */}
          <div className="flex overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5 dark:ring-white/10">
            <SummaryStat label="Total contributed" value={formatMoney(summary.contributed, currency)} />
            <SummaryStat
              label="Unrealized gains"
              value={formatMoney(summary.gains, currency)}
              tone={summary.gains >= 0 ? "text-[color:var(--color-chart-5,#0891b2)]" : "text-negative"}
            />
            <SummaryStat label="Current value" value={formatMoney(summary.current, currency)} />
            <SummaryStat label="Accounts" value={String(summary.accountCount)} />
          </div>

          <PerformanceChart accounts={chartAccounts} years={years} currency={currency} selectedName={selectedAccount?.name ?? null} onClear={() => setSelectedId(null)} />
          <PerfTable title="Investments" accounts={mine} year={year} currency={currency} selectedId={selectedId} onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} />
          {kids.length > 0 ? (
            <PerfTable title="Kids Funding" accounts={kids} year={year} currency={currency} selectedId={selectedId} onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} />
          ) : null}
          <YearByYear accounts={accounts} years={years} currency={currency} />
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="relative flex-1 px-4 py-4 text-center [&:not(:last-child)]:border-r [&:not(:last-child)]:border-line/70">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

// ─── Performance chart ───────────────────────────────────────────────────────

type ChartMode = "stacked" | "grouped" | "return";

function PerformanceChart({
  accounts,
  years,
  currency,
  selectedName,
  onClear,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
  selectedName: string | null;
  onClear: () => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [mode, setMode] = useState<ChartMode>("stacked");
  const desc = useMemo(() => [...years].sort((a, b) => b - a), [years]);

  const bars = useMemo(
    () =>
      desc.map((y) => {
        let contrib = 0;
        let gain = 0;
        let start = 0;
        let endBal = 0;
        let endAny = false;
        for (const a of accounts) {
          const c = effectiveCell(a, y);
          contrib += c.contributedCents;
          gain += c.accruedCents;
          if (c.startBalanceCents != null) start += c.startBalanceCents;
          if (c.endBalanceCents != null) { endBal += c.endBalanceCents; endAny = true; }
        }
        // Simple return: gains ÷ contributions × 100.
        const returnPctVal = contrib > 0 ? (gain / contrib) * 100 : 0;
        return { year: y, contrib, gain, endBal: endAny ? endBal : null, returnPct: returnPctVal };
      }),
    [desc, accounts],
  );

  const W = 600;
  const H = 220;
  const PAD = { top: 32, right: 16, bottom: 32, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Max depends on mode: stacked sums, grouped is max of either, return is %.
  const maxBar = useMemo(() => {
    if (mode === "return") {
      const m = Math.max(...bars.map((b) => Math.abs(b.returnPct)), 1);
      return Math.ceil(m / 5) * 5;
    }
    if (mode === "grouped") {
      return Math.max(...bars.map((b) => Math.max(b.contrib, Math.max(b.gain, 0))), 1);
    }
    return Math.max(...bars.map((b) => b.contrib + Math.max(b.gain, 0)), 1);
  }, [bars, mode]);

  const niceCeil = mode === "return" ? maxBar : Math.ceil(maxBar / 10000) * 10000;
  const scale = (v: number) => (v / niceCeil) * chartH;

  const slotW = chartW / bars.length;
  const barW = mode === "grouped"
    ? Math.min(20, (chartW / bars.length) * 0.28)
    : Math.min(40, (chartW / bars.length) * 0.55);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => (mode === "return" ? +(niceCeil * f).toFixed(1) : Math.round(niceCeil * f)));

  // Compact money formatter: input is CENTS, output uses $k for anything >= $1,000.
  const compactMoney = (cents: number) => {
    const dollars = Math.abs(cents) / 100;
    const sign = cents < 0 ? "-" : "";
    if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
    return `${sign}$${dollars.toFixed(0)}`;
  };

  const fmtTick = (t: number) => (mode === "return" ? `${t}%` : compactMoney(t));

  const fmtBarTotal = (b: typeof bars[number]) => {
    if (mode === "return") return `${b.returnPct >= 0 ? "+" : ""}${b.returnPct.toFixed(1)}%`;
    const total = mode === "stacked" ? b.contrib + Math.max(b.gain, 0) : Math.max(b.contrib, b.gain);
    return compactMoney(total);
  };

  return (
    <section className="overflow-visible rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div>
          <h2 className="text-sm font-bold">
            Performance by year
            {selectedName ? <span className="ml-1.5 font-medium text-brand">· {selectedName}</span> : null}
          </h2>
          <p className="text-xs text-muted">
            {mode === "stacked" ? "Stacked: contributions + gains" : mode === "grouped" ? "Grouped: side-by-side comparison" : "% Return: gain vs. base each year"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex overflow-hidden rounded-lg ring-1 ring-line text-[11px]">
            {(["stacked", "grouped", "return"] as ChartMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 font-medium capitalize transition ${mode === m ? "bg-brand-soft text-brand" : "text-muted hover:bg-brand-soft/40 hover:text-foreground"}`}
              >
                {m === "return" ? "% Return" : m}
              </button>
            ))}
          </div>
          {selectedName ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-muted ring-1 ring-line hover:bg-brand-soft hover:text-foreground"
            >
              ✕ Clear filter
            </button>
          ) : null}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-chart-1, #2563eb)" }} />
          Contributed
        </span>
        {mode !== "return" ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-chart-5, #0891b2)" }} />
            Unrealized gains
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-chart-5, #0891b2)" }} />
            Annual return %
          </span>
        )}
      </div>

      {/* SVG chart */}
      <div className="relative px-2 pb-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "clamp(160px, 24vw, 220px)" }}
          aria-label="Investment performance chart"
        >
          {/* Y-axis grid + labels */}
          {ticks.map((t) => {
            const y = PAD.top + chartH - scale(t);
            return (
              <g key={t}>
                <line
                  x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                  stroke="currentColor" strokeWidth="0.5" opacity="0.12"
                />
                <text
                  x={PAD.left - 6} y={y + 4}
                  textAnchor="end" fontSize="9" fill="currentColor" opacity="0.4"
                >
                  {fmtTick(t)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {bars.map((b, i) => {
            const cx = PAD.left + slotW * i + slotW / 2;
            const isHovered = hovered === i;

            // Compute per-mode bar rects.
            const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
            let totalTopY = PAD.top + chartH; // default: baseline (no bar)

            if (mode === "stacked") {
              const contribH = scale(b.contrib);
              const gainH = scale(Math.max(b.gain, 0));
              const bx = cx - barW / 2;
              if (contribH > 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH, w: barW, h: contribH, fill: "var(--color-chart-1, #2563eb)" });
              }
              if (gainH > 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH - gainH, w: barW, h: gainH, fill: "var(--color-chart-5, #0891b2)" });
              }
              if (b.gain < 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH, w: barW, h: scale(Math.abs(b.gain)), fill: "var(--color-negative, #ef4444)" });
              }
              totalTopY = PAD.top + chartH - contribH - gainH;
            } else if (mode === "grouped") {
              const contribH = scale(b.contrib);
              const gainH = scale(Math.max(b.gain, 0));
              const gap = 2;
              const bxL = cx - barW - gap / 2;
              const bxR = cx + gap / 2;
              if (contribH > 0) {
                rects.push({ x: bxL, y: PAD.top + chartH - contribH, w: barW, h: contribH, fill: "var(--color-chart-1, #2563eb)" });
              }
              if (gainH > 0) {
                rects.push({ x: bxR, y: PAD.top + chartH - gainH, w: barW, h: gainH, fill: "var(--color-chart-5, #0891b2)" });
              }
              if (b.gain < 0) {
                rects.push({ x: bxR, y: PAD.top + chartH, w: barW, h: scale(Math.abs(b.gain)), fill: "var(--color-negative, #ef4444)" });
              }
              totalTopY = PAD.top + chartH - Math.max(contribH, gainH);
            } else {
              // return: single bar for return pct
              const h = scale(Math.abs(b.returnPct));
              const bx = cx - barW / 2;
              const fill = b.returnPct >= 0 ? "var(--color-chart-5, #0891b2)" : "var(--color-negative, #ef4444)";
              rects.push({ x: bx, y: PAD.top + chartH - h, w: barW, h, fill });
              totalTopY = PAD.top + chartH - h;
            }

            return (
              <g key={b.year}>
                {/* Hover hit area */}
                <rect
                  x={PAD.left + slotW * i}
                  y={PAD.top}
                  width={slotW}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
                {isHovered && (
                  <rect
                    x={PAD.left + slotW * i}
                    y={PAD.top}
                    width={slotW}
                    height={chartH}
                    fill="currentColor"
                    opacity="0.04"
                    rx="2"
                    pointerEvents="none"
                  />
                )}
                {rects.map((r, ri) => (
                  <rect
                    key={ri}
                    x={r.x} y={r.y} width={r.w} height={r.h}
                    rx="3" ry="3"
                    fill={r.fill}
                    opacity={isHovered ? 1 : 0.85}
                    pointerEvents="none"
                  />
                ))}
                {/* Bar total label above */}
                {rects.length > 0 ? (
                  <text
                    x={cx} y={totalTopY - 4}
                    textAnchor="middle" fontSize="9.5" fontWeight="600"
                    fill="currentColor" opacity="0.7" pointerEvents="none"
                  >
                    {fmtBarTotal(b)}
                  </text>
                ) : null}
                {/* X-axis label */}
                <text
                  x={cx} y={PAD.top + chartH + 14}
                  textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.45"
                >
                  {b.year}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered !== null && bars[hovered] ? (
          <ChartTooltip b={bars[hovered]} hovered={hovered} total={bars.length} currency={currency} mode={mode} />
        ) : null}
      </div>
    </section>
  );
}

function ChartTooltip({
  b,
  hovered,
  total,
  currency,
  mode,
}: {
  b: { year: number; contrib: number; gain: number; endBal: number | null; returnPct: number };
  hovered: number;
  total: number;
  currency: string;
  mode: ChartMode;
}) {
  const slotPct = ((hovered + 0.5) / total) * 100;
  return (
    <div
      className="pointer-events-none absolute top-2 rounded-xl bg-surface px-3 py-2 text-xs shadow-lg ring-1 ring-black/10 dark:ring-white/15"
      style={{
        left: `${slotPct}%`,
        transform: slotPct > 60 ? "translateX(-100%)" : "translateX(0)",
        zIndex: 10,
      }}
    >
      <div className="mb-1 font-semibold">{b.year}</div>
      <div className="space-y-0.5 text-muted">
        <div>Contributed <span className="font-medium text-foreground">{formatMoney(b.contrib, currency)}</span></div>
        <div>
          Unrealized gains{" "}
          <span className="font-medium" style={{ color: b.gain >= 0 ? "var(--color-chart-5, #0891b2)" : "var(--color-negative)" }}>
            {formatMoney(b.gain, currency)}
          </span>
        </div>
        {mode === "return" ? (
          <div>Return <span className={`font-medium ${b.returnPct >= 0 ? "text-positive" : "text-negative"}`}>{b.returnPct >= 0 ? "+" : ""}{b.returnPct.toFixed(1)}%</span></div>
        ) : null}
        {b.endBal != null && (
          <div>End balance <span className="font-medium text-foreground">{formatMoney(b.endBal, currency)}</span></div>
        )}
      </div>
    </div>
  );
}

function PerfTable({
  title,
  accounts,
  year,
  currency,
  selectedId,
  onSelect,
}: {
  title: string;
  accounts: InvestAccount[];
  year: number;
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (accounts.length === 0) return null;
  const key = `invest-table-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const [collapseState, setCollapseState] = useSessionCollapse(key, () => ({ v: true }));
  const collapsed = collapseState.v;
  const toggle = () => setCollapseState((s) => ({ ...s, v: !s.v }));

  // Bucket-open state — one flag per account_id. Only accounts with buckets
  // actually render a chevron, but the map is keyed uniformly.
  const [bucketsOpen, setBucketsOpen] = useSessionCollapse("invest-buckets-open", () => ({}));
  const toggleBuckets = (id: string) => setBucketsOpen((s) => ({ ...s, [id]: !s[id] }));

  // Group totals for the selected year, using per-account EFFECTIVE cells
  // (account slot + all bucket slots). Effective start uses prior-year end as fallback.
  let startSum = 0;
  let startAny = false;
  let effStartSum = 0;
  let effStartAny = false;
  let endSum = 0;
  let endAny = false;
  let contribSum = 0;
  let accruedSum = 0;
  for (const a of accounts) {
    const c = effectiveCell(a, year);
    if (c.startBalanceCents != null) { startSum += c.startBalanceCents; startAny = true; }
    const eff = c.startBalanceCents ?? effectiveCell(a, year - 1).endBalanceCents ?? null;
    if (eff != null) { effStartSum += eff; effStartAny = true; }
    if (c.endBalanceCents != null) { endSum += c.endBalanceCents; endAny = true; }
    contribSum += c.contributedCents;
    accruedSum += c.accruedCents;
  }
  const totalReturn = returnPct(
    { startBalanceCents: effStartAny ? effStartSum : null, contributedCents: contribSum, accruedCents: accruedSum },
  );

  // Sort accounts by current effective value (End of Year) descending.
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        const av = effectiveCell(a, year).endBalanceCents ?? 0;
        const bv = effectiveCell(b, year).endBalanceCents ?? 0;
        return bv - av;
      }),
    [accounts, year],
  );

  // Hide "Start" column when every account has a null/zero start for the year — reduces noise.
  const showStart = startAny && startSum > 0;
  const zeroCls = "text-muted/50";

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-left hover:bg-brand-soft/20"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <h2 className="flex-1 text-sm font-bold">
          {title}
          <span className="ml-2 text-xs font-normal text-muted">{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
        </h2>
        {collapsed && (
          <div className="flex items-center gap-4 text-xs tabular-nums text-muted">
            <span>Contrib <span className={`font-semibold ${contribSum === 0 ? zeroCls : "text-foreground"}`}>{formatMoney(contribSum, currency)}</span></span>
            <span>Gains <span className={`font-semibold ${accruedSum === 0 ? zeroCls : ""}`} style={accruedSum > 0 ? { color: "var(--color-chart-5, #0891b2)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}>{formatMoney(accruedSum, currency)}</span></span>
            {endAny && <span>Current <span className="font-semibold text-foreground">{formatMoney(endSum, currency)}</span></span>}
          </div>
        )}
      </button>
      {collapsed ? null : <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-medium text-muted">
              <th className="px-4 py-2 text-left">Account</th>
              {showStart ? <th className="px-3 py-2 text-center">Start</th> : null}
              <th className="px-3 py-2 text-center">Contrib</th>
              <th className="px-3 py-2 text-center">Gains</th>
              <th className="px-3 py-2 text-center">Current</th>
              <th className="px-4 py-2 text-center">Return</th>
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.map((a) => {
              const hasBuckets = a.buckets.length > 0;
              const open = !!bucketsOpen[a.id];
              // Parent row shows EFFECTIVE totals (account slot + all buckets).
              // When no buckets, that equals the account cell exactly.
              const eff = effectiveCell(a, year);
              const priorEff = effectiveCell(a, year - 1);
              const ret = returnPct({
                startBalanceCents: eff.startBalanceCents ?? priorEff.endBalanceCents ?? null,
                contributedCents: eff.contributedCents,
                accruedCents: eff.accruedCents,
              });
              const isSelected = selectedId === a.id;
              // Account-level slot (bucket_id NULL) — where CSV seed lives. When
              // buckets exist, this slot is still editable so the seed row can be
              // adjusted, but bucket rows render below.
              const parentCell = a.cells[year];
              return (
                <Fragment key={a.id}>
                  <tr className={`border-t border-line/70 transition ${isSelected ? "bg-brand-soft/40" : "hover:bg-brand-soft/10"}`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {hasBuckets ? (
                          <button
                            type="button"
                            onClick={() => toggleBuckets(a.id)}
                            aria-label={open ? "Collapse buckets" : "Expand buckets"}
                            className="rounded p-0.5 text-muted transition hover:bg-brand-soft hover:text-foreground"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden>
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        ) : (
                          <span className="inline-block w-[18px]" aria-hidden />
                        )}
                        <button
                          type="button"
                          onClick={() => onSelect(a.id)}
                          className="flex items-baseline gap-1.5 text-left"
                          title={isSelected ? "Click to clear filter" : "Filter chart to this account"}
                        >
                          <span className={`font-medium ${isSelected ? "text-brand" : "hover:underline"}`}>{a.name}</span>
                          {a.subtype ? (
                            <span className="text-[11px] text-muted">{a.subtype}</span>
                          ) : null}
                          {a.holder ? (
                            <span className="rounded bg-background px-1 text-[10px] font-medium text-muted ring-1 ring-line">
                              {a.holder}
                            </span>
                          ) : null}
                          {hasBuckets ? (
                            <span className="rounded bg-brand-soft/70 px-1 text-[10px] font-medium text-brand ring-1 ring-brand/20">
                              {a.buckets.length} bucket{a.buckets.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </td>
                    {showStart ? (
                      <td className="px-1 py-1">
                        {hasBuckets ? (
                          <span className={`block text-center text-sm tabular-nums ${(eff.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"}`}>
                            {eff.startBalanceCents == null ? "—" : formatMoney(eff.startBalanceCents, currency)}
                          </span>
                        ) : (
                          <EditCell accountId={a.id} year={year} field="start" cents={parentCell?.startBalanceCents ?? 0} placeholder={parentCell?.startBalanceCents == null} currency={currency} tone={(parentCell?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                        )}
                      </td>
                    ) : null}
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-center text-sm tabular-nums font-medium ${eff.contributedCents === 0 ? zeroCls : ""}`}>
                          {formatMoney(eff.contributedCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="contributed" cents={eff.contributedCents} currency={currency} tone={eff.contributedCents === 0 ? zeroCls : ""} />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-center text-sm tabular-nums font-medium ${eff.accruedCents === 0 ? zeroCls : ""}`} style={eff.accruedCents > 0 ? { color: "var(--color-chart-5, #0891b2)" } : eff.accruedCents < 0 ? { color: "var(--color-negative)" } : undefined}>
                          {formatMoney(eff.accruedCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="accrued" cents={eff.accruedCents} currency={currency} tone={eff.accruedCents === 0 ? zeroCls : eff.accruedCents > 0 ? "text-[color:var(--color-chart-5,#0891b2)]" : "text-negative"} />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-center text-sm tabular-nums font-medium ${(eff.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                          {eff.endBalanceCents == null ? "—" : formatMoney(eff.endBalanceCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="end" cents={eff.endBalanceCents ?? 0} placeholder={eff.endBalanceCents == null} currency={currency} tone={(eff.endBalanceCents ?? 0) === 0 ? zeroCls : "font-medium"} />
                      )}
                    </td>
                    <td className={`px-4 py-2 text-center tabular-nums ${ret == null ? zeroCls : ret > 0 ? "text-positive" : ret < 0 ? "text-negative" : zeroCls}`}>
                      {ret == null ? "—" : `${ret > 0 ? "+" : ""}${formatMoney(ret, currency)}`}
                    </td>
                  </tr>
                  {hasBuckets && open ? (
                    <>
                      {/* Account-level seed row (only when the CSV/manual seed at
                          account level has any non-zero value — otherwise buckets
                          alone are enough and the row would be pure noise). */}
                      {(parentCell?.contributedCents || parentCell?.accruedCents || parentCell?.startBalanceCents || parentCell?.endBalanceCents) ? (
                        <tr className="border-t border-line/40 bg-background/30 text-xs">
                          <td className="px-4 py-1 pl-10 text-muted italic">Account (unallocated / seed)</td>
                          {showStart ? (
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} year={year} field="start" cents={parentCell?.startBalanceCents ?? 0} placeholder={parentCell?.startBalanceCents == null} currency={currency} tone={(parentCell?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                            </td>
                          ) : null}
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="contributed" cents={parentCell?.contributedCents ?? 0} currency={currency} tone={(parentCell?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                          </td>
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="accrued" cents={parentCell?.accruedCents ?? 0} currency={currency} tone={(parentCell?.accruedCents ?? 0) === 0 ? zeroCls : (parentCell?.accruedCents ?? 0) > 0 ? "text-[color:var(--color-chart-5,#0891b2)]" : "text-negative"} />
                          </td>
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="end" cents={parentCell?.endBalanceCents ?? 0} placeholder={parentCell?.endBalanceCents == null} currency={currency} tone={(parentCell?.endBalanceCents ?? 0) === 0 ? zeroCls : ""} />
                          </td>
                          <td className="px-4 py-1 text-center tabular-nums text-muted">—</td>
                        </tr>
                      ) : null}
                      {a.buckets.map((b) => {
                        const bc = b.cells[year];
                        return (
                          <tr key={b.id} className="border-t border-line/40 bg-background/20 text-sm">
                            <td className="px-4 py-1 pl-10 text-foreground/80">
                              <span className="text-brand-strong">↳</span> <span className="ml-1">{b.name}</span>
                            </td>
                            {showStart ? (
                              <td className="px-1 py-1">
                                <EditCell accountId={a.id} bucketId={b.id} year={year} field="start" cents={bc?.startBalanceCents ?? 0} placeholder={bc?.startBalanceCents == null} currency={currency} tone={(bc?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                              </td>
                            ) : null}
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} bucketId={b.id} year={year} field="contributed" cents={bc?.contributedCents ?? 0} currency={currency} tone={(bc?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                            </td>
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} bucketId={b.id} year={year} field="accrued" cents={bc?.accruedCents ?? 0} currency={currency} tone={(bc?.accruedCents ?? 0) === 0 ? zeroCls : (bc?.accruedCents ?? 0) > 0 ? "text-[color:var(--color-chart-5,#0891b2)]" : "text-negative"} />
                            </td>
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} bucketId={b.id} year={year} field="end" cents={bc?.endBalanceCents ?? 0} placeholder={bc?.endBalanceCents == null} currency={currency} tone={(bc?.endBalanceCents ?? 0) === 0 ? zeroCls : ""} />
                            </td>
                            <td className="px-4 py-1 text-center tabular-nums text-muted">—</td>
                          </tr>
                        );
                      })}
                    </>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-background/40 font-semibold">
              <td className="px-4 py-2">Total</td>
              {showStart ? (
                <td className={`px-3 py-2 text-center tabular-nums ${startAny ? "text-muted" : zeroCls}`}>
                  {startAny ? formatMoney(startSum, currency) : "—"}
                </td>
              ) : null}
              <td className={`px-3 py-2 text-center tabular-nums ${contribSum === 0 ? zeroCls : ""}`}>{formatMoney(contribSum, currency)}</td>
              <td
                className={`px-3 py-2 text-center tabular-nums ${accruedSum === 0 ? zeroCls : ""}`}
                style={accruedSum > 0 ? { color: "var(--color-chart-5, #0891b2)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}
              >
                {formatMoney(accruedSum, currency)}
              </td>
              <td className={`px-3 py-2 text-center tabular-nums font-medium ${endAny ? "" : zeroCls}`}>
                {endAny ? formatMoney(endSum, currency) : "—"}
              </td>
              <td className={`px-4 py-2 text-center tabular-nums ${totalReturn == null ? zeroCls : totalReturn > 0 ? "text-positive" : totalReturn < 0 ? "text-negative" : zeroCls}`}>
                {totalReturn == null ? "—" : `${totalReturn > 0 ? "+" : ""}${formatMoney(totalReturn, currency)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>}
    </section>
  );
}

// Editable contributed / gain cell — reads like text, saves on blur. Editing a
// cell writes an investment_years row, which "locks in" that account+year
// (stored value then wins over live derivation).
function EditCell({
  accountId,
  bucketId,
  year,
  field,
  cents,
  placeholder: showDash,
  currency,
  tone,
}: {
  accountId: string;
  bucketId?: string;
  year: number;
  field: "contributed" | "accrued" | "start" | "end";
  cents: number;
  placeholder?: boolean;
  currency: string;
  tone: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = showDash ? "" : centsToDisplay(cents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setInvestmentYear(fd))}
      className="flex items-center justify-center gap-0.5"
    >
      <input type="hidden" name="accountId" value={accountId} />
      {bucketId ? <input type="hidden" name="bucketId" value={bucketId} /> : null}
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="field" value={field} />
      <span className="pointer-events-none text-xs text-muted">{currencySymbol(currency)}</span>
      <input
        key={initial}
        name="value"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="0.00"
        size={Math.max(initial.length, 4) + 1}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${tone} ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Secondary view: each account's contributed vs. gain across every year, so the
// "keep investing here?" trend is visible at a glance.
function YearByYear({
  accounts,
  years,
  currency,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
}) {
  const [collapseState, setCollapseState] = useSessionCollapse("invest-yby", () => ({ open: false, mine: true, kids: true }));
  const open = collapseState.open;
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, open: typeof v === "function" ? v(s.open) : v }));
  const mineCollapsed = collapseState.mine;
  const setMineCollapsed = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, mine: typeof v === "function" ? v(s.mine) : v }));
  const kidsCollapsed = collapseState.kids;
  const setKidsCollapsed = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, kids: typeof v === "function" ? v(s.kids) : v }));
  const desc = useMemo(() => [...years].sort((a, b) => b - a), [years]);
  const mine = accounts.filter((a) => !a.isKids);
  const kids = accounts.filter((a) => a.isKids);

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <h2 className="text-sm font-bold">Year by year</h2>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-semibold">Account</th>
                <th className="px-3 py-2 text-left font-semibold">Metric</th>
                {desc.map((y) => (
                  <th key={y} className="px-3 py-2 text-center font-semibold">{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="cursor-pointer hover:bg-brand-soft/20" onClick={() => setMineCollapsed((c) => !c)}>
                <td className="bg-background/60 px-4 py-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${mineCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                    Investments
                  </span>
                </td>
                <td className="bg-background/60 px-3 py-1.5 text-[11px] text-muted">{mineCollapsed ? "Contributed + Gain" : ""}</td>
                {desc.map((y) => {
                  const contrib = mine.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                  const gain = mine.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                  return (
                    <td key={y} className="bg-background/60 px-3 py-1.5 text-center text-[11px] tabular-nums text-muted">
                      {mineCollapsed ? <><span className="text-foreground">{formatMoney(contrib, currency)}</span>{" / "}<span className={gainTone(gain)}>{formatMoney(gain, currency)}</span></> : ""}
                    </td>
                  );
                })}
              </tr>
              {!mineCollapsed && mine.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-t border-line/70">
                    <td rowSpan={2} className="px-4 py-2 align-top font-medium">{a.name}</td>
                    <td className="px-3 py-1.5 text-muted">Contributed</td>
                    {desc.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-center tabular-nums">
                        {formatMoney(effectiveCell(a, y).contributedCents, currency)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted">Gain</td>
                    {desc.map((y) => {
                      const g = effectiveCell(a, y).accruedCents;
                      return (
                        <td key={y} className={`px-3 py-1.5 text-center tabular-nums ${gainTone(g)}`}>
                          {formatMoney(g, currency)}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
              {kids.length > 0 && (
                <tr className="cursor-pointer hover:bg-brand-soft/20" onClick={() => setKidsCollapsed((c) => !c)}>
                  <td className="border-t-2 border-line bg-background/60 px-4 py-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${kidsCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                      Kids Funding
                    </span>
                  </td>
                  <td className="border-t-2 border-line bg-background/60 px-3 py-1.5 text-[11px] text-muted">{kidsCollapsed ? "Contributed + Gain" : ""}</td>
                  {desc.map((y) => {
                    const contrib = kids.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                    const gain = kids.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                    return (
                      <td key={y} className="border-t-2 border-line bg-background/60 px-3 py-1.5 text-center text-[11px] tabular-nums text-muted">
                        {kidsCollapsed ? <><span className="text-foreground">{formatMoney(contrib, currency)}</span>{" / "}<span className={gainTone(gain)}>{formatMoney(gain, currency)}</span></> : ""}
                      </td>
                    );
                  })}
                </tr>
              )}
              {!kidsCollapsed && kids.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-t border-line/70">
                    <td rowSpan={2} className="px-4 py-2 align-top font-medium">{a.name}</td>
                    <td className="px-3 py-1.5 text-muted">Contributed</td>
                    {desc.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-center tabular-nums">
                        {formatMoney(effectiveCell(a, y).contributedCents, currency)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted">Gain</td>
                    {desc.map((y) => {
                      const g = effectiveCell(a, y).accruedCents;
                      return (
                        <td key={y} className={`px-3 py-1.5 text-center tabular-nums ${gainTone(g)}`}>
                          {formatMoney(g, currency)}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
