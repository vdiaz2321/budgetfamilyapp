"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { addMonths, monthsBetween, projectSnowball, type MonthlyEntry } from "@/lib/snowball";
import { recordDebtInterest } from "./actions";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CARD_COLORS = [
  "bg-sky-100 dark:bg-sky-500/15",
  "bg-violet-100 dark:bg-violet-500/15",
  "bg-amber-100 dark:bg-amber-500/15",
  "bg-rose-100 dark:bg-rose-500/15",
  "bg-emerald-100 dark:bg-emerald-500/15",
];

function monthLabel(month: string) {
  const idx = parseInt(month.slice(5, 7), 10) - 1;
  return `${MONTHS_SHORT[idx]} ${month.slice(0, 4)}`;
}

type Row = {
  debtId: string;
  subId: string;
  name: string;
  balanceCents: number;
  originalBalanceCents: number;
  minCents: number;
  plannedCents: number;
  paidCents: number;
  paidThisMonthCents: number;
  interestPaidCents: number;
  escrowCents: number;
  apr: number;
  dueDay: number | null;
  debtKind: string | null;
  accountKind: "credit_card" | "debt_loan" | "budget";
  interestMethod: "monthly_estimate" | "statement_manual";
};

type Mode = "planned" | "classic";
type Filter = "all" | "loans" | "cards" | "paid";

type Props = {
  rows: Row[];
  startMonth: string;
  focusId: string | null;
  totalBalanceCents: number;
  totalMinCents: number;
  plannedTotalCents: number;
  currentExtraCents: number;
  monthlyAttackCents: number;
  plannedPayoffMonth: Record<string, string | null>;
  plannedLedger: Record<string, MonthlyEntry[]>;
  classicPayoffMonth: Record<string, string | null>;
  classicLedger: Record<string, MonthlyEntry[]>;
  currency: string;
  settings: ReactNode;
};

export function SnowballBoard(props: Props) {
  const {
    rows, startMonth, focusId, totalBalanceCents, totalMinCents, plannedTotalCents,
    currentExtraCents, monthlyAttackCents, plannedPayoffMonth, plannedLedger,
    classicPayoffMonth, classicLedger, currency, settings,
  } = props;
  const [mode, setMode] = useState<Mode>("planned");
  const [filter, setFilter] = useState<Filter>("all");
  // Start on the household-wide projection. A debt is selected only after the
  // user clicks its card, and clicking that card again returns to this view.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(true);
  const payoffMonth = mode === "planned" ? plannedPayoffMonth : classicPayoffMonth;
  const ledger = mode === "planned" ? plannedLedger : classicLedger;

  const visibleRows = rows.filter((row) => {
    if (filter === "loans") return row.accountKind !== "credit_card" && row.balanceCents > 0;
    if (filter === "cards") return row.accountKind === "credit_card" && row.balanceCents > 0;
    if (filter === "paid") return row.balanceCents <= 0;
    return true;
  });
  const selected = selectedId ? rows.find((row) => row.subId === selectedId) ?? null : null;
  const selectedMonths = selected ? ledger[selected.subId] ?? [] : [];
  const masterMonths = useMemo(() => aggregateDebtLedger(rows, ledger, startMonth), [ledger, rows, startMonth]);
  const cardCount = rows.filter((row) => row.accountKind === "credit_card" && row.balanceCents > 0).length;
  const loanCount = rows.filter((row) => row.accountKind !== "credit_card" && row.balanceCents > 0).length;
  const paidCount = rows.filter((row) => row.balanceCents <= 0).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded-xl bg-surface p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <ModeButton active={mode === "planned"} onClick={() => setMode("planned")}>My Plan</ModeButton>
        <ModeButton active={mode === "classic"} onClick={() => setMode("classic")}>Classic Snowball</ModeButton>
      </div>
      <p className="text-center text-xs text-muted">
        {mode === "planned"
          ? "Each debt follows its own payment planned in Budget."
          : "Minimums plus extra money attack the smallest balance first."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total debt" value={formatMoney(totalBalanceCents, currency)} />
        <SummaryCard label="Minimums / mo" value={formatMoney(totalMinCents, currency)} />
        <SummaryCard
          label={mode === "planned" ? "Planned / mo" : "Monthly attack"}
          value={formatMoney(mode === "planned" ? plannedTotalCents : monthlyAttackCents, currency)}
          hint={mode === "classic" ? `${formatMoney(currentExtraCents, currency)} extra this month` : undefined}
          highlight
        />
        <SummaryCard label="Paid this month" value={formatMoney(rows.reduce((sum, row) => sum + row.paidThisMonthCents, 0), currency)} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl bg-surface p-2 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All ({rows.length})</FilterButton>
        <FilterButton active={filter === "loans"} onClick={() => setFilter("loans")}>Loans ({loanCount})</FilterButton>
        <FilterButton active={filter === "cards"} onClick={() => setFilter("cards")}>Credit Cards ({cardCount})</FilterButton>
        <FilterButton active={filter === "paid"} onClick={() => setFilter("paid")}>Paid off ({paidCount})</FilterButton>
      </div>

      {rows.length === 0 ? (
        <section className="rounded-2xl bg-surface px-4 py-8 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm font-semibold">No payoff debts yet</p>
          <p className="mt-1 text-xs text-muted">Add a mortgage or auto loan in Accounts, or turn on payoff tracking inside a card&apos;s Edit Details.</p>
          <Link href="/accounts" className="mt-3 inline-flex rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white">Open Accounts</Link>
        </section>
      ) : visibleRows.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-6 text-center text-sm text-muted shadow-sm ring-1 ring-black/5">No debts match this filter.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {visibleRows.map((row, index) => (
            <DebtCard
              key={row.subId}
              row={row}
              color={CARD_COLORS[index % CARD_COLORS.length]}
              selected={selected?.subId === row.subId}
              focus={mode === "classic" && focusId === row.subId}
              payoff={payoffMonth[row.subId] ?? null}
              months={ledger[row.subId] ?? []}
              currency={currency}
              onClick={() => {
                setSelectedId((current) => current === row.subId ? null : row.subId);
                setProgressOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {selected ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <button type="button" onClick={() => setProgressOpen((open) => !open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <svg className={`shrink-0 text-muted transition ${progressOpen ? "" : "-rotate-90"}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
            <span className="font-bold">{selected.name}&apos;s progress</span>
            <span className="ml-auto text-xs font-semibold tabular-nums text-muted">{payoffMonth[selected.subId] ? `Payoff ${monthLabel(payoffMonth[selected.subId]!)}` : "Payment too low for payoff"}</span>
          </button>
          {progressOpen ? (
            <div className="space-y-4 border-t border-line p-4">
              <ProgressOverview row={selected} ledger={selectedMonths} currency={currency} />
              <BalanceChart startingBalance={selected.balanceCents} entries={selectedMonths} currency={currency} />
              {selectedMonths.length ? (
                <div className="rounded-lg bg-brand-soft/80 px-4 py-3 text-center text-sm text-foreground">
                  Your planned payment of <strong className="rounded bg-brand/15 px-1.5 py-0.5 tabular-nums">{formatMoney(Math.max(selected.minCents, selected.plannedCents), currency)}</strong>{" "}
                  will pay off this debt in <strong className="rounded bg-brand/15 px-1.5 py-0.5">{formatDuration(selectedMonths.length)}</strong>.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setSimulatorOpen(true)} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand-strong">Open Payoff Simulator</button>
                <InterestForm debtId={selected.debtId} />
                <span className="ml-auto text-[11px] text-muted">
                  {selected.interestMethod === "statement_manual" ? "Statement interest is authoritative" : "Projection uses APR ÷ 12"}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      ) : rows.length > 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <button type="button" onClick={() => setProgressOpen((open) => !open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <svg className={`shrink-0 text-muted transition ${progressOpen ? "" : "-rotate-90"}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
            <span className="font-bold">All debt progress</span>
            <span className="ml-auto text-xs font-semibold tabular-nums text-muted">
              {masterMonths.length && masterMonths.at(-1)?.balanceCents === 0
                ? `Final payoff ${monthLabel(masterMonths.at(-1)!.month)}`
                : "Some payments are too low for payoff"}
            </span>
          </button>
          {progressOpen ? (
            <div className="space-y-4 border-t border-line p-4">
              <MasterProgressOverview rows={rows} ledger={masterMonths} currency={currency} />
              <BalanceChart startingBalance={totalBalanceCents} entries={masterMonths} currency={currency} />
              {masterMonths.length && masterMonths.at(-1)?.balanceCents === 0 ? (
                <div className="rounded-lg bg-brand-soft/80 px-4 py-3 text-center text-sm text-foreground">
                  Your combined payment plan pays off all tracked debt in <strong className="rounded bg-brand/15 px-1.5 py-0.5">{formatDuration(masterMonths.length)}</strong>.
                </div>
              ) : null}
              <p className="text-center text-[11px] text-muted">Select a debt card for its details and payoff simulator. Click the selected card again to return here.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {mode === "classic" ? settings : null}
      {simulatorOpen && selected ? (
        <PayoffSimulator row={selected} startMonth={startMonth} currency={currency} onClose={() => setSimulatorOpen(false)} />
      ) : null}
    </div>
  );
}

function DebtCard({ row, color, selected, focus, payoff, months, currency, onClick }: {
  row: Row; color: string; selected: boolean; focus: boolean; payoff: string | null;
  months: MonthlyEntry[]; currency: string; onClick: () => void;
}) {
  const paid = row.balanceCents <= 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`w-[184px] shrink-0 overflow-hidden rounded-2xl border-2 text-left shadow-sm transition ${selected || focus ? "border-brand" : "border-transparent ring-1 ring-black/5 dark:ring-white/10"}`}>
      <div className={`px-3 py-2 ${color}`}>
        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wide text-foreground/70">
          <span>{row.accountKind === "credit_card" ? "Credit card" : humanizeDebtKind(row.debtKind)}</span>
          {focus ? <span className="rounded-full bg-brand px-1.5 py-0.5 text-white">Focus</span> : null}
        </div>
        <p className="truncate text-xs italic">{row.name}</p>
      </div>
      <div className="bg-surface px-3 py-3">
        <p className={`text-lg font-bold ${paid ? "text-positive" : ""}`}>{paid ? "Paid off" : payoff ? monthLabel(payoff) : "Beyond projection"}</p>
        {!paid ? <p className="text-[10px] text-muted">{months.length ? `${months.length} months remaining` : "Increase the payment"}</p> : null}
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          <CardRow label="Balance" value={formatMoney(row.balanceCents, currency)} />
          <CardRow label="Paid so far" value={formatMoney(row.paidCents, currency)} />
          <CardRow label="Minimum" value={formatMoney(row.minCents, currency)} />
          <CardRow label="APR" value={row.apr ? `${row.apr}%` : "—"} />
          <CardRow label="Planned / mo" value={formatMoney(row.plannedCents, currency)} highlight />
          {row.escrowCents > 0 ? <CardRow label="Escrow / mo" value={formatMoney(row.escrowCents, currency)} /> : null}
        </div>
      </div>
    </button>
  );
}

function ProgressOverview({ row, ledger, currency }: { row: Row; ledger: MonthlyEntry[]; currency: string }) {
  const original = Math.max(row.originalBalanceCents, row.balanceCents);
  const paidPrincipal = Math.max(0, original - row.balanceCents);
  const progress = original > 0 ? Math.min(100, (paidPrincipal / original) * 100) : 100;
  const futureInterest = ledger.reduce((sum, entry) => sum + Math.max(0, entry.interestCents), 0);
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <MiniMetric label="Balance remaining" value={formatMoney(row.balanceCents, currency)} />
      <MiniMetric label="Principal paid" value={`${formatMoney(paidPrincipal, currency)} (${progress.toFixed(1)}%)`} />
      <MiniMetric label="Projected interest" value={formatMoney(futureInterest, currency)} />
      <MiniMetric label="Time remaining" value={ledger.length ? `${Math.floor(ledger.length / 12)} yrs, ${ledger.length % 12} mos` : "Not projected"} />
    </div>
  );
}

function aggregateDebtLedger(rows: Row[], ledger: Record<string, MonthlyEntry[]>, startMonth: string): MonthlyEntry[] {
  const monthCount = Math.max(0, ...rows.map((row) => ledger[row.subId]?.length ?? 0));
  return Array.from({ length: monthCount }, (_, index) => {
    let paymentCents = 0;
    let interestCents = 0;
    let principalCents = 0;
    let balanceCents = 0;

    for (const row of rows) {
      const entries = ledger[row.subId] ?? [];
      const entry = entries[index];
      if (entry) {
        paymentCents += entry.paymentCents;
        interestCents += entry.interestCents;
        principalCents += entry.principalCents;
        balanceCents += entry.balanceCents;
      } else if (entries.length === 0) {
        balanceCents += Math.max(0, row.balanceCents);
      } else {
        balanceCents += Math.max(0, entries.at(-1)?.balanceCents ?? 0);
      }
    }

    return {
      month: addMonths(startMonth, index),
      paymentCents,
      interestCents,
      principalCents,
      balanceCents,
    };
  });
}

function MasterProgressOverview({ rows, ledger, currency }: { rows: Row[]; ledger: MonthlyEntry[]; currency: string }) {
  const original = rows.reduce((sum, row) => sum + Math.max(row.originalBalanceCents, row.balanceCents), 0);
  const balance = rows.reduce((sum, row) => sum + Math.max(0, row.balanceCents), 0);
  const paidPrincipal = Math.max(0, original - balance);
  const progress = original > 0 ? Math.min(100, (paidPrincipal / original) * 100) : 100;
  const remainingProgress = original > 0 ? Math.max(0, 100 - progress) : 0;
  const futureInterest = ledger.reduce((sum, entry) => sum + Math.max(0, entry.interestCents), 0);
  const allPaid = ledger.length > 0 && ledger.at(-1)?.balanceCents === 0;

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <MiniMetric label="Total balance remaining" value={`${formatMoney(balance, currency)} (${remainingProgress.toFixed(1)}%)`} />
      <MiniMetric label="Principal paid" value={`${formatMoney(paidPrincipal, currency)} (${progress.toFixed(1)}%)`} />
      <MiniMetric label="Projected interest" value={formatMoney(futureInterest, currency)} />
      <MiniMetric label="All debts paid in" value={allPaid ? formatDuration(ledger.length) : "Beyond projection"} />
    </div>
  );
}

function BalanceChart({ startingBalance, entries, comparisonEntries, comparisonTone = "positive", currency, compact = false }: {
  startingBalance: number;
  entries: MonthlyEntry[];
  comparisonEntries?: MonthlyEntry[];
  comparisonTone?: "positive" | "negative";
  currency: string;
  compact?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 760, height = compact ? 190 : 220, padY = 24;
  const currentValues = [startingBalance, ...entries.map((entry) => entry.balanceCents)];
  const comparisonValues = comparisonEntries ? [startingBalance, ...comparisonEntries.map((entry) => entry.balanceCents)] : null;
  const values = [...currentValues, ...(comparisonValues ?? [])];
  const max = Math.max(1, ...values);
  // Reserve enough room for the widest Y-axis amount. A fixed 46px gutter
  // clipped larger balances such as $365,270.00.
  const padX = Math.min(104, Math.max(54, formatMoney(Math.round(max), currency).length * 6 + 12));
  const longest = Math.max(entries.length, comparisonEntries?.length ?? 0, 1);
  const longestEntries = (comparisonEntries?.length ?? 0) > entries.length ? comparisonEntries! : entries;
  const lastEntry = (comparisonEntries?.length ?? 0) > entries.length ? comparisonEntries?.at(-1) : entries.at(-1);
  const xFor = (index: number) => padX + (index / longest) * (width - padX * 2);
  const yFor = (value: number) => padY + (1 - value / max) * (height - padY * 2);
  const pointsFor = (series: MonthlyEntry[]) => [startingBalance, ...series.map((entry) => entry.balanceCents)].map((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    return `${x},${y}`;
  }).join(" ");
  const ticks = [0, 0.5, 1];
  const xTickDivisions = compact ? 3 : 4;
  const xTicks = lastEntry
    ? Array.from(
        new Set(
          Array.from({ length: xTickDivisions + 1 }, (_, index) =>
            Math.round((index / xTickDivisions) * longest),
          ),
        ),
      ).map((index) => ({
        index,
        label: index === 0 ? "Now" : monthLabel(longestEntries[index - 1]?.month ?? lastEntry.month),
      }))
    : [{ index: 0, label: "Now" }];
  const hoveredCurrent = hoverIndex != null && hoverIndex < currentValues.length ? currentValues[hoverIndex] : null;
  const hoveredComparison = hoverIndex != null && comparisonValues && hoverIndex < comparisonValues.length ? comparisonValues[hoverIndex] : null;
  const hoveredMonth = hoverIndex == null
    ? null
    : hoverIndex === 0
      ? "Now"
      : comparisonEntries?.[hoverIndex - 1]?.month ?? entries[hoverIndex - 1]?.month ?? null;
  const hoverX = hoverIndex == null ? null : xFor(hoverIndex);
  const tooltipAlignment = hoverIndex != null && hoverIndex > longest * 0.72
    ? "-translate-x-full"
    : hoverIndex != null && hoverIndex < longest * 0.28
      ? "translate-x-0"
      : "-translate-x-1/2";
  return (
    <div className="overflow-x-auto">
      <div className={`relative ${compact ? "min-w-0" : "min-w-[560px]"}`}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full cursor-crosshair touch-none"
          role="img"
          aria-label="Projected balance over time"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const viewX = ((event.clientX - rect.left) / rect.width) * width;
            const nearest = Math.round(((viewX - padX) / (width - padX * 2)) * longest);
            setHoverIndex(Math.max(0, Math.min(longest, nearest)));
          }}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {ticks.map((tick) => {
            const y = padY + tick * (height - padY * 2);
            const value = Math.round(max * (1 - tick));
            return <g key={tick}><line x1={padX} x2={width - padX} y1={y} y2={y} stroke="currentColor" className="text-line" strokeDasharray="3 5" /><text x={padX - 7} y={y + 4} textAnchor="end" className="fill-muted text-[10px]">{formatMoney(value, currency)}</text></g>;
          })}
          <polyline points={pointsFor(entries)} fill="none" stroke="var(--brand)" strokeWidth="3" strokeDasharray="8 7" strokeLinecap="round" strokeLinejoin="round" />
          {comparisonEntries ? <polyline points={pointsFor(comparisonEntries)} fill="none" stroke={comparisonTone === "positive" ? "#84cc16" : "#f59e0b"} strokeWidth="2.5" strokeDasharray="8 7" strokeLinecap="round" strokeLinejoin="round" /> : null}
          <circle cx={padX} cy={padY} r="5" fill="var(--surface)" stroke="var(--brand)" strokeWidth="3" />
          {hoverX != null ? <line x1={hoverX} x2={hoverX} y1={padY} y2={height - padY} stroke="currentColor" className="text-muted/50" strokeWidth="1" strokeDasharray="3 4" /> : null}
          {hoverX != null && hoveredCurrent != null ? <circle cx={hoverX} cy={yFor(hoveredCurrent)} r="5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" /> : null}
          {hoverX != null && hoveredComparison != null ? <circle cx={hoverX} cy={yFor(hoveredComparison)} r="5" fill={comparisonTone === "positive" ? "#84cc16" : "#f59e0b"} stroke="var(--surface)" strokeWidth="2" /> : null}
          {xTicks.map((tick, index) => {
            const x = xFor(tick.index);
            const anchor = index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle";
            return (
              <g key={`${tick.index}-${tick.label}`}>
                <line x1={x} x2={x} y1={height - padY} y2={height - padY + 4} stroke="currentColor" className="text-line" />
                <text x={x} y={height - 4} textAnchor={anchor} className="fill-muted text-[10px]">{tick.label}</text>
              </g>
            );
          })}
        </svg>
        {hoverX != null && hoveredMonth ? (
          <div
            className={`pointer-events-none absolute top-2 z-10 min-w-[170px] overflow-hidden rounded-lg border border-line bg-surface text-xs shadow-lg ${tooltipAlignment}`}
            style={{ left: `${(hoverX / width) * 100}%` }}
          >
            <p className="border-b border-line px-3 py-2 font-bold">{hoveredMonth === "Now" ? "Now" : monthLabel(hoveredMonth)}</p>
            <div className="space-y-2 px-3 py-2">
              {hoveredCurrent != null ? <div className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-brand" /><span>Current Track</span><strong className="ml-auto tabular-nums">{formatMoney(hoveredCurrent, currency)}</strong></div> : null}
              {hoveredComparison != null ? <div className="flex items-center gap-2"><span className={`w-5 border-t-2 border-dashed ${comparisonTone === "positive" ? "border-lime-500" : "border-amber-500"}`} /><span>Simulation</span><strong className="ml-auto tabular-nums">{formatMoney(hoveredComparison, currency)}</strong></div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {comparisonEntries ? <div className="flex justify-center gap-5 text-[11px] font-semibold"><span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-brand" />Current track</span><span className="flex items-center gap-1.5"><span className={`w-5 border-t-2 border-dashed ${comparisonTone === "positive" ? "border-lime-500" : "border-amber-500"}`} />Simulation</span></div> : null}
    </div>
  );
}

function paymentForTargetMonth(row: Row, startMonth: string, targetMonth: string, oneTimeExtraCents: number) {
  const targetMonths = monthsBetween(startMonth, targetMonth);
  if (!targetMonths || targetMonths < 1) return Math.max(row.minCents, row.plannedCents);
  const paysByTarget = (paymentCents: number) => {
    const projection = projectSnowball(
      [{ id: row.subId, balanceCents: row.balanceCents, minCents: paymentCents, apr: row.apr }],
      0,
      startMonth,
      targetMonths,
      true,
      { oneTimeMonth: startMonth, oneTimeExtraCents },
    );
    return projection.payoffMonth.get(row.subId) != null;
  };
  let low = 0;
  let high = Math.max(100, row.balanceCents);
  while (!paysByTarget(high) && high < row.balanceCents * 8 + 1_000_000) high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (paysByTarget(middle)) high = middle;
    else low = middle + 1;
  }
  return high;
}

function SimulationOutcome({ paymentDelta, oneTimeCents, interestSavings, timeSavings, improved, damaged, changed, interest, months, currency }: {
  paymentDelta: number;
  oneTimeCents: number;
  interestSavings: number;
  timeSavings: number;
  improved: boolean;
  damaged: boolean;
  changed: boolean;
  interest: number;
  months: number;
  currency: string;
}) {
  const tone = damaged ? "border-amber-400 bg-amber-100/80 text-amber-950" : improved ? "border-brand bg-brand-soft/80" : "border-line bg-background";
  let heading = "Following your current payment plan";
  if (paymentDelta > 0) heading = `Paying +${formatMoney(paymentDelta, currency)} extra every month`;
  else if (paymentDelta < 0) heading = `Paying ${formatMoney(Math.abs(paymentDelta), currency)} less every month`;
  else if (oneTimeCents > 0) heading = `Adding a one-time ${formatMoney(oneTimeCents, currency)} payment`;
  return (
    <div className={`overflow-hidden rounded-lg border ${tone}`}>
      <p className="border-b border-current/20 px-3 py-2 text-center text-xs font-bold">{heading}</p>
      <div className="grid grid-cols-2 divide-x divide-current/20">
        {changed ? (
          <>
            <div className="p-3 text-center"><p className="text-sm font-bold tabular-nums">{formatMoney(Math.abs(interestSavings), currency)}</p><p className="text-xs">{interestSavings > 0 ? "Interest Savings" : interestSavings < 0 ? "Additional Interest" : "No Interest Change"}</p></div>
            <div className="p-3 text-center"><p className="text-sm font-bold">{formatDuration(Math.abs(timeSavings))}</p><p className="text-xs">{timeSavings > 0 ? "Time Savings" : timeSavings < 0 ? "Additional Time" : "No Time Change"}</p></div>
          </>
        ) : (
          <>
            <div className="p-3 text-center"><p className="text-sm font-bold tabular-nums">{formatMoney(interest, currency)}</p><p className="text-xs">Interest Remaining</p></div>
            <div className="p-3 text-center"><p className="text-sm font-bold">{formatDuration(months)}</p><p className="text-xs">Time Remaining</p></div>
          </>
        )}
      </div>
    </div>
  );
}

function PayoffSimulator({ row, startMonth, currency, onClose }: { row: Row; startMonth: string; currency: string; onClose: () => void }) {
  const baselinePayment = Math.max(row.minCents, row.plannedCents);
  const [payment, setPayment] = useState(centsToDisplay(baselinePayment));
  const [oneTimeExtra, setOneTimeExtra] = useState("");
  const monthlyCents = Math.max(0, Math.round(Number(payment || 0) * 100));
  const oneTimeCents = Math.max(0, Math.round(Number(oneTimeExtra || 0) * 100));
  const baselineResult = useMemo(() => projectSnowball(
    [{ id: row.subId, balanceCents: row.balanceCents, minCents: baselinePayment, apr: row.apr }],
    0, startMonth, 480, true,
  ), [baselinePayment, row.apr, row.balanceCents, row.subId, startMonth]);
  const result = useMemo(() => projectSnowball(
    [{ id: row.subId, balanceCents: row.balanceCents, minCents: monthlyCents, apr: row.apr }],
    0,
    startMonth,
    480,
    true,
    { oneTimeMonth: startMonth, oneTimeExtraCents: oneTimeCents },
  ), [monthlyCents, oneTimeCents, row.apr, row.balanceCents, row.subId, startMonth]);
  const ledger = result.ledger.get(row.subId) ?? [];
  const payoff = result.payoffMonth.get(row.subId) ?? null;
  const interest = result.totalInterestCents.get(row.subId) ?? 0;
  const remaining = result.totalPaymentsCents.get(row.subId) ?? row.balanceCents + interest;
  const negative = result.negativeAmortization.has(row.subId);
  const baselineLedger = baselineResult.ledger.get(row.subId) ?? [];
  const baselinePayoff = baselineResult.payoffMonth.get(row.subId) ?? null;
  const baselineInterest = baselineResult.totalInterestCents.get(row.subId) ?? 0;
  const interestSavings = baselineInterest - interest;
  const timeSavings = baselineLedger.length - ledger.length;
  const paymentDelta = monthlyCents - baselinePayment;
  const improved = interestSavings > 0 || timeSavings > 0;
  const damaged = interestSavings < 0 || timeSavings < 0 || negative;
  const changed = paymentDelta !== 0 || oneTimeCents > 0;

  const choosePayoffMonth = (targetMonth: string) => {
    if (!targetMonth) return;
    const needed = paymentForTargetMonth(row, startMonth, targetMonth, oneTimeCents);
    setPayment(centsToDisplay(needed));
  };

  const reset = () => {
    setPayment(centsToDisplay(baselinePayment));
    setOneTimeExtra("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="simulator-title">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-[840px] sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><h2 id="simulator-title" className="text-base font-bold">Loan Payoff Simulator</h2><p className="text-[11px] text-muted">{row.name} · estimates only</p></div>
          <button type="button" onClick={onClose} aria-label="Close simulator" className="text-xl text-muted hover:text-foreground">×</button>
        </div>
        <div className="grid sm:grid-cols-[210px_1fr]">
          <div className="space-y-4 border-b border-line p-4 sm:border-b-0 sm:border-r">
            <div className="border-b border-line pb-3 text-center"><p className="text-base font-bold tabular-nums">{formatMoney(row.minCents, currency)}</p><p className="text-[10px] text-muted">Required Minimum Payment</p></div>
            <label className="block text-xs font-bold">Monthly Payment<input value={payment} onChange={(event) => setPayment(event.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-md bg-background px-2.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" /></label>
            <p className={`-mt-3 text-[10px] ${monthlyCents < row.minCents ? "text-negative" : "text-muted"}`}>
              {monthlyCents < row.minCents
                ? `${formatMoney(monthlyCents, currency)} is less than your minimum payment.`
                : payoff ? `Pays off this debt in ${formatDuration(ledger.length)}.` : "This payment does not produce a payoff date."}
            </p>
            <label className="block text-xs font-bold">Payoff Date<select value={payoff ?? ""} onChange={(event) => choosePayoffMonth(event.target.value)} className="mt-1 w-full rounded-md bg-background px-2.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
              {!payoff ? <option value="">Beyond 40 years</option> : null}
              {Array.from({ length: 480 }, (_, index) => addMonths(startMonth, index)).map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select></label>
            <p className="-mt-3 text-[10px] text-muted">Original payoff date: {baselinePayoff ? monthLabel(baselinePayoff) : "not projected"}.</p>
            <label className="block text-xs font-bold">One-time extra this month<input value={oneTimeExtra} onChange={(event) => setOneTimeExtra(event.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-md bg-background px-2.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" /></label>
            <p className="-mt-3 text-[10px] text-muted">Extra payments reduce principal immediately. Escrow is excluded.</p>
            {changed ? <button type="button" onClick={reset} className="text-xs font-semibold text-brand hover:underline">× Reset all changes</button> : null}
          </div>
          <div className="space-y-3 p-4">
            <BalanceChart startingBalance={row.balanceCents} entries={baselineLedger} comparisonEntries={changed ? ledger : undefined} comparisonTone={damaged ? "negative" : "positive"} currency={currency} compact />
            {negative ? <p className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-900">Payment does not cover the estimated monthly interest. Increase it to prevent the balance from growing.</p> : null}
            <SimulationOutcome
              paymentDelta={paymentDelta}
              oneTimeCents={oneTimeCents}
              interestSavings={interestSavings}
              timeSavings={timeSavings}
              improved={improved}
              damaged={damaged}
              changed={changed}
              interest={interest}
              months={ledger.length}
              currency={currency}
            />
            {monthlyCents < row.minCents ? <p className="flex gap-2 text-xs text-muted"><span className="text-amber-500">▲</span>Your lender may charge fees, which could further increase payoff time and interest.</p> : null}
            <div className="space-y-1 border-t border-line pt-2 text-xs">
              <div className="flex justify-between border-b border-line pb-2 text-sm"><span className="font-semibold">Remaining to Pay</span><strong>{formatMoney(remaining, currency)}</strong></div>
              <div className="flex justify-between text-muted"><span>Principal</span><span>{formatMoney(row.balanceCents, currency)}</span></div>
              <div className="flex justify-between text-muted"><span>Estimated interest</span><span>{formatMoney(interest, currency)}</span></div>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-line px-4 py-3"><button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white">Done</button></div>
      </div>
    </div>
  );
}

function InterestForm({ debtId }: { debtId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-soft px-3 py-2 text-xs font-bold text-brand">Record statement interest</button>;
  return (
    <form action={(formData) => start(async () => { const result = await recordDebtInterest(formData); if (result?.error) setError(result.error); else setOpen(false); })} className="flex flex-wrap items-end gap-2 rounded-lg bg-background p-2 ring-1 ring-line">
      <input type="hidden" name="debtId" value={debtId} />
      <label className="text-[10px] font-bold uppercase text-muted">Interest<input name="amount" type="number" min="0.01" step="0.01" required className="mt-1 block w-28 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line" /></label>
      <label className="text-[10px] font-bold uppercase text-muted">Date<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 block rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line" /></label>
      <button disabled={pending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "Saving…" : "Add"}</button>
      <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-xs text-muted">Cancel</button>
      {error ? <p className="w-full text-xs font-semibold text-negative">{error}</p> : null}
    </form>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-lg py-2 text-sm font-semibold transition ${active ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground"}`}>{children}</button>; }
function humanizeDebtKind(value: string | null) { return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Loan"; }
function formatDuration(months: number) { const years = Math.floor(months / 12); const remainder = months % 12; return years > 0 ? `${years} ${years === 1 ? "yr" : "yrs"}, ${remainder} ${remainder === 1 ? "mo" : "mos"}` : `${remainder} ${remainder === 1 ? "mo" : "mos"}`; }
function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${active ? "bg-brand-soft text-brand ring-1 ring-brand/20" : "bg-background text-muted hover:text-foreground"}`}>{children}</button>; }
function CardRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) { return <div className="flex items-center justify-between gap-1"><span className="text-[10px] text-muted">{label}</span><span className={`text-[11px] font-semibold tabular-nums ${highlight ? "text-brand" : ""}`}>{value}</span></div>; }
function MiniMetric({ label, value, padded }: { label: string; value: string; padded?: boolean }) { return <div className={padded ? "p-4" : ""}><p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p><p className="mt-0.5 text-base font-bold tabular-nums">{value}</p></div>; }
function SummaryCard({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) { return <div className={`rounded-2xl px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${highlight ? "bg-brand text-white ring-0" : "bg-surface"}`}><p className={`text-xs font-medium uppercase tracking-wide ${highlight ? "text-white/80" : "text-muted"}`}>{label}</p><p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>{hint ? <p className={`text-[11px] ${highlight ? "text-white/80" : "text-muted"}`}>{hint}</p> : null}</div>; }
