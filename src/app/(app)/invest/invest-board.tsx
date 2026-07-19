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

export type InvestAccount = {
  id: string;
  name: string;
  holder: string | null;
  subtype: string | null;
  isKids: boolean;
  cells: Record<number, YearCell>;
};

type Props = {
  accounts: InvestAccount[];
  years: number[]; // newest first
  currency: string;
};

const gainTone = (cents: number) =>
  cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "text-foreground";

// gain ÷ (start balance + contributions) — the money at work that produced it.
// Undefined without a starting balance (seeded historical years).
function returnPct(cell: {
  startBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
}): number | null {
  if (cell.startBalanceCents == null) return null;
  const base = cell.startBalanceCents + cell.contributedCents;
  if (base <= 0) return null;
  return (cell.accruedCents / base) * 100;
}

export function InvestBoard({ accounts, years, currency }: Props) {
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());

  const mine = accounts.filter((a) => !a.isKids);
  const kids = accounts.filter((a) => a.isKids);

  const yearIdx = years.indexOf(year);
  const goPrev = () => yearIdx < years.length - 1 && setYear(years[yearIdx + 1]);
  const goNext = () => yearIdx > 0 && setYear(years[yearIdx - 1]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Invest</h1>
          <p className="text-sm text-muted">
            Contributions vs. unrealized gains, per account, per year.
          </p>
        </div>
        <div className="flex items-center gap-1">
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
          <PerformanceChart accounts={accounts} years={years} currency={currency} />
          <PerfTable title="Investments" accounts={mine} year={year} currency={currency} />
          {kids.length > 0 ? (
            <PerfTable title="Kids Funding" accounts={kids} year={year} currency={currency} />
          ) : null}
          <YearByYear accounts={accounts} years={years} currency={currency} />
        </>
      )}
    </div>
  );
}

// ─── Performance chart ───────────────────────────────────────────────────────

function PerformanceChart({
  accounts,
  years,
  currency,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const asc = useMemo(() => [...years].sort((a, b) => a - b), [years]);

  // Aggregate contributed + gain per year across all accounts.
  const bars = useMemo(
    () =>
      asc.map((y) => {
        let contrib = 0;
        let gain = 0;
        let endBal = 0;
        let endAny = false;
        for (const a of accounts) {
          const c = a.cells[y];
          if (!c) continue;
          contrib += c.contributedCents;
          gain += c.accruedCents;
          if (c.endBalanceCents != null) { endBal += c.endBalanceCents; endAny = true; }
        }
        return { year: y, contrib, gain, endBal: endAny ? endBal : null };
      }),
    [asc, accounts],
  );

  // Chart geometry (viewBox coords).
  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 32, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxBar = Math.max(...bars.map((b) => b.contrib + Math.max(b.gain, 0)), 1);
  // Round up to a "nice" ceiling so the top bar doesn't clip the axis label.
  const niceCeil = Math.ceil(maxBar / 10000) * 10000;
  const scale = (cents: number) => (cents / niceCeil) * chartH;

  const barW = Math.min(40, (chartW / bars.length) * 0.55);
  const slotW = chartW / bars.length;

  // Y-axis ticks (4 steps).
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceCeil * f));

  // End-balance line path.
  const linePts = bars
    .map((b, i) => {
      if (b.endBal == null) return null;
      const x = PAD.left + slotW * i + slotW / 2;
      const y = PAD.top + chartH - scale(b.endBal);
      return `${x},${y}`;
    })
    .filter(Boolean);
  const linePath = linePts.length > 1 ? `M ${linePts.join(" L ")}` : null;

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-bold">Performance</h2>
        <p className="text-xs text-muted">Total contributed vs. unrealized gains per year</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-brand, #6366f1)" }} />
          Contributed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-positive, #22c55e)" }} />
          Gain
        </span>
        {linePath && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: "var(--color-foreground, #e2e8f0)", opacity: 0.5 }} />
            End balance
          </span>
        )}
      </div>

      {/* SVG chart */}
      <div className="relative px-2 pb-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "clamp(140px, 22vw, 200px)" }}
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
                  {t >= 1000 ? `$${(t / 1000).toFixed(0)}k` : `$${t}`}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {bars.map((b, i) => {
            const cx = PAD.left + slotW * i + slotW / 2;
            const bx = cx - barW / 2;
            const contribH = scale(b.contrib);
            const gainH = scale(Math.max(b.gain, 0));
            const isHovered = hovered === i;

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
                  style={{ cursor: "default" }}
                />
                {/* Hover highlight */}
                {isHovered && (
                  <rect
                    x={PAD.left + slotW * i}
                    y={PAD.top}
                    width={slotW}
                    height={chartH}
                    fill="currentColor"
                    opacity="0.04"
                    rx="2"
                  />
                )}
                {/* Contributed bar */}
                <rect
                  x={bx} y={PAD.top + chartH - contribH}
                  width={barW} height={contribH}
                  rx="3" ry="3"
                  fill="var(--color-brand, #6366f1)"
                  opacity={isHovered ? 1 : 0.8}
                />
                {/* Gain bar (stacked on top) */}
                {gainH > 0 && (
                  <rect
                    x={bx} y={PAD.top + chartH - contribH - gainH}
                    width={barW} height={gainH}
                    rx="3" ry="3"
                    fill="var(--color-positive, #22c55e)"
                    opacity={isHovered ? 1 : 0.8}
                  />
                )}
                {/* Negative gain bar (below baseline) */}
                {b.gain < 0 && (
                  <rect
                    x={bx} y={PAD.top + chartH - contribH}
                    width={barW} height={scale(Math.abs(b.gain))}
                    rx="3" ry="3"
                    fill="var(--color-negative, #ef4444)"
                    opacity={isHovered ? 1 : 0.8}
                  />
                )}
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

          {/* End-balance line */}
          {linePath && (
            <>
              <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.35"
                strokeDasharray="4 3"
              />
              {bars.map((b, i) => {
                if (b.endBal == null) return null;
                const x = PAD.left + slotW * i + slotW / 2;
                const y = PAD.top + chartH - scale(b.endBal);
                return (
                  <circle key={b.year} cx={x} cy={y} r="2.5"
                    fill="var(--color-surface, #1e293b)"
                    stroke="currentColor" strokeWidth="1.5" opacity="0.5"
                  />
                );
              })}
            </>
          )}
        </svg>

        {hovered !== null && bars[hovered] ? (
          <ChartTooltip b={bars[hovered]} hovered={hovered} total={bars.length} currency={currency} />
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
}: {
  b: { year: number; contrib: number; gain: number; endBal: number | null };
  hovered: number;
  total: number;
  currency: string;
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
          Gain{" "}
          <span className={`font-medium ${b.gain >= 0 ? "text-positive" : "text-negative"}`}>
            {formatMoney(b.gain, currency)}
          </span>
        </div>
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
}: {
  title: string;
  accounts: InvestAccount[];
  year: number;
  currency: string;
}) {
  if (accounts.length === 0) return null;
  const key = `invest-table-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const [collapseState, setCollapseState] = useSessionCollapse(key, () => ({ v: true }));
  const collapsed = collapseState.v;
  const toggle = () => setCollapseState((s) => ({ ...s, v: !s.v }));

  // Group totals for the selected year.
  let startSum = 0;
  let startAny = false;
  let endSum = 0;
  let endAny = false;
  let contribSum = 0;
  let accruedSum = 0;
  for (const a of accounts) {
    const c = a.cells[year];
    if (!c) continue;
    if (c.startBalanceCents != null) { startSum += c.startBalanceCents; startAny = true; }
    if (c.endBalanceCents != null) { endSum += c.endBalanceCents; endAny = true; }
    contribSum += c.contributedCents;
    accruedSum += c.accruedCents;
  }
  const totalReturn = startAny
    ? returnPct({ startBalanceCents: startSum, contributedCents: contribSum, accruedCents: accruedSum })
    : null;

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
        <h2 className="flex-1 text-sm font-bold">{title}</h2>
        {collapsed && (
          <div className="flex items-center gap-4 text-xs tabular-nums text-muted">
            <span>Contributed <span className="font-semibold text-foreground">{formatMoney(contribSum, currency)}</span></span>
            <span>Gain <span className={`font-semibold ${gainTone(accruedSum)}`}>{formatMoney(accruedSum, currency)}</span></span>
            {endAny && <span>End <span className="font-semibold text-foreground">{formatMoney(endSum, currency)}</span></span>}
          </div>
        )}
      </button>
      {collapsed ? null : <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 text-left font-semibold">Account</th>
              <th className="px-3 py-2 text-center font-semibold">Start of Year</th>
              <th className="px-3 py-2 text-center font-semibold">Contributed</th>
              <th className="px-3 py-2 text-center font-semibold">Unrealized Gain</th>
              <th className="px-3 py-2 text-center font-semibold">End of Year</th>
              <th className="px-4 py-2 text-center font-semibold">Return</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const c = a.cells[year];
              const start = c?.startBalanceCents ?? null;
              const end = c?.endBalanceCents ?? null;
              const contributed = c?.contributedCents ?? 0;
              const accrued = c?.accruedCents ?? 0;
              const ret = c ? returnPct(c) : null;
              return (
                <tr key={a.id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium">{a.name}</span>
                      {a.subtype ? (
                        <span className="text-[11px] text-muted">{a.subtype}</span>
                      ) : null}
                      {a.holder ? (
                        <span className="rounded bg-background px-1 text-[10px] font-medium text-muted ring-1 ring-line">
                          {a.holder}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <EditCell accountId={a.id} year={year} field="start" cents={start ?? 0} placeholder={start == null} currency={currency} tone="text-muted" />
                  </td>
                  <td className="px-1 py-1">
                    <EditCell accountId={a.id} year={year} field="contributed" cents={contributed} currency={currency} tone="" />
                  </td>
                  <td className="px-1 py-1">
                    <EditCell accountId={a.id} year={year} field="accrued" cents={accrued} currency={currency} tone={gainTone(accrued)} />
                  </td>
                  <td className="px-1 py-1">
                    <EditCell accountId={a.id} year={year} field="end" cents={end ?? 0} placeholder={end == null} currency={currency} tone="font-medium" />
                  </td>
                  <td className={`px-4 py-2 text-center tabular-nums ${ret == null ? "text-muted" : gainTone(accrued)}`}>
                    {ret == null ? "—" : `${ret > 0 ? "+" : ""}${ret.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-background/40 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-3 py-2 text-center tabular-nums text-muted">
                {startAny ? formatMoney(startSum, currency) : "—"}
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{formatMoney(contribSum, currency)}</td>
              <td className={`px-3 py-2 text-center tabular-nums ${gainTone(accruedSum)}`}>
                {formatMoney(accruedSum, currency)}
              </td>
              <td className="px-3 py-2 text-center tabular-nums font-medium">
                {endAny ? formatMoney(endSum, currency) : "—"}
              </td>
              <td className={`px-4 py-2 text-center tabular-nums ${totalReturn == null ? "text-muted" : gainTone(accruedSum)}`}>
                {totalReturn == null ? "—" : `${totalReturn > 0 ? "+" : ""}${totalReturn.toFixed(1)}%`}
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
  year,
  field,
  cents,
  placeholder: showDash,
  currency,
  tone,
}: {
  accountId: string;
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
  const [open, setOpen] = useState(false);
  const [mineCollapsed, setMineCollapsed] = useState(false);
  const [kidsCollapsed, setKidsCollapsed] = useState(false);
  const asc = useMemo(() => [...years].sort((a, b) => a - b), [years]);
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
                {asc.map((y) => (
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
                {asc.map((y) => {
                  const contrib = mine.reduce((s, a) => s + (a.cells[y]?.contributedCents ?? 0), 0);
                  const gain = mine.reduce((s, a) => s + (a.cells[y]?.accruedCents ?? 0), 0);
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
                    {asc.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-center tabular-nums">
                        {formatMoney(a.cells[y]?.contributedCents ?? 0, currency)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted">Gain</td>
                    {asc.map((y) => {
                      const g = a.cells[y]?.accruedCents ?? 0;
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
                  {asc.map((y) => {
                    const contrib = kids.reduce((s, a) => s + (a.cells[y]?.contributedCents ?? 0), 0);
                    const gain = kids.reduce((s, a) => s + (a.cells[y]?.accruedCents ?? 0), 0);
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
                    {asc.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-center tabular-nums">
                        {formatMoney(a.cells[y]?.contributedCents ?? 0, currency)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted">Gain</td>
                    {asc.map((y) => {
                      const g = a.cells[y]?.accruedCents ?? 0;
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
