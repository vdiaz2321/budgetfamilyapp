"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { addMonths, monthsBetween, projectSnowball, type MonthlyEntry } from "@/lib/snowball";
import { applyPayoffPlan, recordDebtInterest } from "./actions";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Debt card tints. Cool tones only — these sit behind money values, which
// AGENTS.md keeps clear of purple and amber.
const CARD_COLORS = [
  "bg-sky-100 dark:bg-sky-500/15",
  "bg-blue-100 dark:bg-blue-500/15",
  "bg-teal-100 dark:bg-teal-500/15",
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
  promoEndsOn: string | null;
  postPromoApr: number | null;
  dueDay: number | null;
  debtKind: string | null;
  accountKind: "credit_card" | "debt_loan" | "budget";
  interestMethod: "monthly_estimate" | "statement_manual";
};

// A debt still inside a promotional-rate window, with what will be left when
// that window closes at the current payment.
export type PromoOutlook = {
  subId: string;
  name: string;
  promoEndsOn: string;
  monthsRemaining: number;
  currentPaymentCents: number;
  balanceAtEndCents: number;
  clearPaymentCents: number | null;
  postPromoApr: number | null;
  annualCostCents: number | null;
};

type Mode = "planned" | "classic";
type Filter = "all" | "loans" | "cards" | "paid";

// Snowball (smallest balance first) vs avalanche (highest rate first), run
// over the same debts with the same monthly capacity.
export type PayoffComparison = {
  snowballInterestCents: number;
  avalancheInterestCents: number;
  interestSavedCents: number;
  snowballFinish: string | null;
  avalancheFinish: string | null;
  monthsSaved: number;
};

type Props = {
  rows: Row[];
  promoOutlook?: PromoOutlook[];
  payoffComparison?: PayoffComparison | null;
  // Recorded month-end balances: household total, and per debt subcategory.
  totalHistory?: { month: string; balanceCents: number }[];
  historyBySub?: Record<string, { month: string; balanceCents: number }[]>;
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
    rows, promoOutlook = [], payoffComparison = null, totalHistory = [], historyBySub = {}, startMonth, focusId, totalBalanceCents, totalMinCents, plannedTotalCents,
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
  // Cards run soonest payoff first, so whatever is about to clear leads and
  // the long tail sits at the end. Paid-off debts have no upcoming payoff and
  // stay at the back, and so does anything whose payment is too low to ever
  // clear — there's no date to sort it by.
  const orderedRows = [...visibleRows].sort((a, b) => {
    const aDone = a.balanceCents <= 0;
    const bDone = b.balanceCents <= 0;
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aMonth = payoffMonth[a.subId] ?? null;
    const bMonth = payoffMonth[b.subId] ?? null;
    if (aMonth && bMonth && aMonth !== bMonth) return aMonth.localeCompare(bMonth);
    if (aMonth && !bMonth) return -1;
    if (!aMonth && bMonth) return 1;
    return a.name.localeCompare(b.name);
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

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
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

      {promoOutlook.length > 0 ? (
        <PromoWatch items={promoOutlook} currency={currency} />
      ) : null}

      {payoffComparison && mode === "classic" ? (
        <OrderComparison data={payoffComparison} currency={currency} />
      ) : null}

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
          {orderedRows.map((row, index) => (
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
              <BalanceChart startingBalance={selected.balanceCents} entries={selectedMonths} history={historyBySub[selected.subId] ?? []} currency={currency} />
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
              <BalanceChart startingBalance={totalBalanceCents} entries={masterMonths} history={totalHistory} currency={currency} />
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

function BalanceChart({ startingBalance, entries, history = [], comparisonEntries, comparisonTone = "positive", currency, compact = false }: {
  startingBalance: number;
  entries: MonthlyEntry[];
  // Recorded balances from months already gone, oldest first. Drawn solid to
  // the left of "Now" so the projection has a track record behind it — and so
  // a projection that has been drifting away from reality is visible.
  history?: { month: string; balanceCents: number }[];
  comparisonEntries?: MonthlyEntry[];
  comparisonTone?: "positive" | "negative";
  currency: string;
  compact?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 760, height = compact ? 190 : 220, padY = 24;
  // "Now" sits at this index; everything before it is recorded, after projected.
  const originIndex = history.length;
  const historyValues = history.map((h) => h.balanceCents);
  const currentValues = [startingBalance, ...entries.map((entry) => entry.balanceCents)];
  const comparisonValues = comparisonEntries ? [startingBalance, ...comparisonEntries.map((entry) => entry.balanceCents)] : null;
  const values = [...historyValues, ...currentValues, ...(comparisonValues ?? [])];
  const max = Math.max(1, ...values);
  // Reserve enough room for the widest Y-axis amount. A fixed 46px gutter
  // clipped larger balances such as $365,270.00.
  const padX = Math.min(104, Math.max(54, formatMoney(Math.round(max), currency).length * 6 + 12));
  const forwardLen = Math.max(entries.length, comparisonEntries?.length ?? 0, 1);
  // Total domain spans recorded months + projected months.
  const longest = originIndex + forwardLen;
  const longestEntries = (comparisonEntries?.length ?? 0) > entries.length ? comparisonEntries! : entries;
  const lastEntry = (comparisonEntries?.length ?? 0) > entries.length ? comparisonEntries?.at(-1) : entries.at(-1);
  const xFor = (index: number) => padX + (index / longest) * (width - padX * 2);
  const yFor = (value: number) => padY + (1 - value / max) * (height - padY * 2);
  // Projected series start at "Now", so their points are offset by the
  // recorded months sitting to the left of it.
  const pointsFor = (series: MonthlyEntry[]) => [startingBalance, ...series.map((entry) => entry.balanceCents)].map((value, index) => {
    const x = xFor(originIndex + index);
    const y = yFor(value);
    return `${x},${y}`;
  }).join(" ");
  // Recorded line runs from the oldest snapshot up to and including "Now", so
  // it joins the projection without a gap.
  const historyPoints = history.length
    ? [...historyValues, startingBalance]
        .map((value, index) => `${xFor(index)},${yFor(value)}`)
        .join(" ")
    : null;
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
        label:
          index === originIndex
            ? "Now"
            : index < originIndex
              ? monthLabel(history[index]?.month ?? "")
              : monthLabel(longestEntries[index - originIndex - 1]?.month ?? lastEntry.month),
      }))
    : [{ index: originIndex, label: "Now" }];
  // Hover reads from the recorded series left of Now, the projection right of it.
  const fwdIndex = hoverIndex == null ? null : hoverIndex - originIndex;
  const hoveredCurrent =
    hoverIndex == null
      ? null
      : hoverIndex < originIndex
        ? historyValues[hoverIndex] ?? null
        : fwdIndex != null && fwdIndex < currentValues.length
          ? currentValues[fwdIndex]
          : null;
  const hoveredComparison =
    fwdIndex != null && fwdIndex >= 0 && comparisonValues && fwdIndex < comparisonValues.length
      ? comparisonValues[fwdIndex]
      : null;
  const hoveredMonth = hoverIndex == null
    ? null
    : hoverIndex < originIndex
      ? history[hoverIndex]?.month ?? null
      : hoverIndex === originIndex
        ? "Now"
        : comparisonEntries?.[hoverIndex - originIndex - 1]?.month ?? entries[hoverIndex - originIndex - 1]?.month ?? null;
  const hoverX = hoverIndex == null ? null : xFor(hoverIndex);
  const tooltipAlignment = hoverIndex != null && hoverIndex > longest * 0.72
    ? "-translate-x-full"
    : hoverIndex != null && hoverIndex < longest * 0.28
      ? "translate-x-0"
      : "-translate-x-1/2";
  return (
    <div className="overflow-x-auto">
      <div className={`relative ${compact ? "min-w-0" : "min-w-0 sm:min-w-[560px]"}`}>
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
          {/* Recorded balances: solid, to distinguish what happened from what
              is merely projected (dashed). */}
          {historyPoints ? (
            <>
              <polyline points={historyPoints} fill="none" stroke="var(--viz-savings)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <line x1={xFor(originIndex)} x2={xFor(originIndex)} y1={padY} y2={height - padY} stroke="currentColor" strokeDasharray="3 4" className="text-line" />
            </>
          ) : null}
          <polyline points={pointsFor(entries)} fill="none" stroke="var(--viz-debt)" strokeWidth="3" strokeDasharray="8 7" strokeLinecap="round" strokeLinejoin="round" />
          {comparisonEntries ? <polyline points={pointsFor(comparisonEntries)} fill="none" stroke={comparisonTone === "positive" ? "var(--positive)" : "var(--negative)"} strokeWidth="2.5" strokeDasharray="8 7" strokeLinecap="round" strokeLinejoin="round" /> : null}
          <circle cx={xFor(originIndex)} cy={yFor(startingBalance)} r="5" fill="var(--surface)" stroke="var(--viz-debt)" strokeWidth="3" />
          {hoverX != null ? <line x1={hoverX} x2={hoverX} y1={padY} y2={height - padY} stroke="currentColor" className="text-muted/50" strokeWidth="1" strokeDasharray="3 4" /> : null}
          {hoverX != null && hoveredCurrent != null ? <circle cx={hoverX} cy={yFor(hoveredCurrent)} r="5" fill="var(--viz-debt)" stroke="var(--surface)" strokeWidth="2" /> : null}
          {hoverX != null && hoveredComparison != null ? <circle cx={hoverX} cy={yFor(hoveredComparison)} r="5" fill={comparisonTone === "positive" ? "var(--positive)" : "var(--negative)"} stroke="var(--surface)" strokeWidth="2" /> : null}
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
              {hoveredCurrent != null ? <div className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-[color:var(--viz-debt)]" /><span>Current Track</span><strong className="ml-auto tabular-nums">{formatMoney(hoveredCurrent, currency)}</strong></div> : null}
              {hoveredComparison != null ? <div className="flex items-center gap-2"><span className={`w-5 border-t-2 border-dashed ${comparisonTone === "positive" ? "border-positive" : "border-negative"}`} /><span>Simulation</span><strong className="ml-auto tabular-nums">{formatMoney(hoveredComparison, currency)}</strong></div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {comparisonEntries ? <div className="flex justify-center gap-5 text-[11px] font-semibold"><span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-[color:var(--viz-debt)]" />Current track</span><span className="flex items-center gap-1.5"><span className={`w-5 border-t-2 border-dashed ${comparisonTone === "positive" ? "border-positive" : "border-negative"}`} />Simulation</span></div> : null}
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
  const tone = damaged ? "border-negative/50 bg-negative/10 text-foreground" : improved ? "border-brand bg-brand-soft/80" : "border-line bg-background";
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
  const [applyPending, startApply] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const monthlyCents = Math.max(0, Math.round(Number(payment || 0) * 100));
  const oneTimeCents = Math.max(0, Math.round(Number(oneTimeExtra || 0) * 100));
  // Both projections carry the promotional-rate schedule. Without it the
  // simulator modelled a 0% card as 0% forever, so it disagreed with the main
  // page's own projection for exactly the debts where the deadline matters.
  const rateSchedule = {
    apr: row.apr,
    promoEndsOn: row.promoEndsOn,
    postPromoApr: row.postPromoApr,
  };
  const baselineResult = useMemo(() => projectSnowball(
    [{ id: row.subId, balanceCents: row.balanceCents, minCents: baselinePayment, ...rateSchedule }],
    0, startMonth, 480, true,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [baselinePayment, row.apr, row.promoEndsOn, row.postPromoApr, row.balanceCents, row.subId, startMonth]);
  const result = useMemo(() => projectSnowball(
    [{ id: row.subId, balanceCents: row.balanceCents, minCents: monthlyCents, ...rateSchedule }],
    0,
    startMonth,
    480,
    true,
    { oneTimeMonth: startMonth, oneTimeExtraCents: oneTimeCents },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [monthlyCents, oneTimeCents, row.apr, row.promoEndsOn, row.postPromoApr, row.balanceCents, row.subId, startMonth]);
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
            {/* Month + year, rather than one 480-option list. On iOS that list
                rendered as a 480-row wheel and was re-created on every
                keystroke in the payment field. */}
            <fieldset className="block">
              <legend className="text-xs font-bold">Payoff Date</legend>
              <div className="mt-1 grid grid-cols-[1fr_auto] gap-1.5">
                <select
                  value={payoff ? payoff.slice(5, 7) : ""}
                  onChange={(event) => {
                    const y = payoff ? payoff.slice(0, 4) : String(new Date(startMonth).getFullYear());
                    choosePayoffMonth(`${y}-${event.target.value}-01`);
                  }}
                  aria-label="Payoff month"
                  className="w-full rounded-md bg-background px-2.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  {!payoff ? <option value="">Beyond 40 years</option> : null}
                  {MONTHS_SHORT.map((label, i) => (
                    <option key={label} value={String(i + 1).padStart(2, "0")}>{label}</option>
                  ))}
                </select>
                <select
                  value={payoff ? payoff.slice(0, 4) : ""}
                  onChange={(event) => {
                    const m = payoff ? payoff.slice(5, 7) : "01";
                    choosePayoffMonth(`${event.target.value}-${m}-01`);
                  }}
                  aria-label="Payoff year"
                  className="rounded-md bg-background px-2.5 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  {!payoff ? <option value="">—</option> : null}
                  {Array.from({ length: 40 }, (_, i) => Number(startMonth.slice(0, 4)) + i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </div>
            </fieldset>
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
            {monthlyCents < row.minCents ? <p className="flex gap-2 text-xs text-muted"><span className="text-negative">▲</span>Your lender may charge fees, which could further increase payoff time and interest.</p> : null}
            <div className="space-y-1 border-t border-line pt-2 text-xs">
              <div className="flex justify-between border-b border-line pb-2 text-sm"><span className="font-semibold">Remaining to Pay</span><strong>{formatMoney(remaining, currency)}</strong></div>
              <div className="flex justify-between text-muted"><span>Principal</span><span>{formatMoney(row.balanceCents, currency)}</span></div>
              <div className="flex justify-between text-muted"><span>Estimated interest</span><span>{formatMoney(interest, currency)}</span></div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          {applyError ? (
            <p className="mr-auto text-xs text-negative">{applyError}</p>
          ) : applied ? (
            <p className="mr-auto text-xs font-semibold" style={{ color: "var(--positive)" }}>
              Saved to Budget.
            </p>
          ) : changed ? (
            <p className="mr-auto text-xs text-muted">
              Applying sets this debt&rsquo;s planned payment to{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(monthlyCents, currency)}
              </span>
              .
            </p>
          ) : null}
          {/* Without this the simulator was a dead end: its answer had to be
              remembered and re-typed on the Budget page. */}
          <button
            type="button"
            disabled={!changed || applyPending}
            onClick={() => {
              setApplyError(null);
              const fd = new FormData();
              fd.set("subcategoryId", row.subId);
              fd.set("month", startMonth);
              fd.set("payment", centsToDisplay(monthlyCents));
              startApply(async () => {
                const res = await applyPayoffPlan(fd);
                if (res?.error) setApplyError(res.error);
                else setApplied(true);
              });
            }}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "var(--viz-savings)" }}
          >
            {applyPending ? "Saving…" : "Apply to Budget"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white">Done</button>
        </div>
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
function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${active ? "bg-foreground text-background" : "bg-background text-muted hover:text-foreground"}`}>{children}</button>; }
function CardRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) { return <div className="flex items-center justify-between gap-1"><span className="text-[10px] text-muted">{label}</span><span className={`text-[11px] font-semibold tabular-nums ${highlight ? "font-bold" : ""}`}>{value}</span></div>; }
function MiniMetric({ label, value, padded }: { label: string; value: string; padded?: boolean }) { return <div className={padded ? "p-4" : ""}><p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p><p className="mt-0.5 text-base font-bold tabular-nums">{value}</p></div>; }
// Promotional-rate deadlines. Each row answers the only question that matters
// on a 0% card: at what you're paying now, how much is still owed the day the
// rate resets — and what payment would clear it before then.
function PromoWatch({ items, currency }: { items: PromoOutlook[]; currency: string }) {
  const fmtDate = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return `${MONTHS_SHORT[m - 1]} ${day}, ${y}`;
  };
  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-bold">Promotional rates ending</h2>
        <span className="text-[11px] text-muted">
          {items.length} card{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((p) => (
          <li key={p.subId} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="text-[11px] tabular-nums text-muted">
                {fmtDate(p.promoEndsOn)} · {p.monthsRemaining} mo left
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              At {formatMoney(p.currentPaymentCents, currency)}/mo,{" "}
              <span className="font-semibold tabular-nums" style={{ color: "var(--viz-debt)" }}>
                {formatMoney(p.balanceAtEndCents, currency)}
              </span>{" "}
              will still be owed when the rate resets
              {p.annualCostCents != null ? (
                <>
                  {" "}— about{" "}
                  <span className="font-semibold tabular-nums" style={{ color: "var(--viz-debt)" }}>
                    {formatMoney(p.annualCostCents, currency)}/yr
                  </span>{" "}
                  at {p.postPromoApr}%
                </>
              ) : null}
              .
            </p>
            {p.clearPaymentCents != null ? (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Pay{" "}
                <span className="font-semibold tabular-nums" style={{ color: "var(--viz-savings)" }}>
                  {formatMoney(p.clearPaymentCents, currency)}/mo
                </span>{" "}
                to clear it interest-free before the deadline.
              </p>
            ) : null}
            {p.postPromoApr == null ? (
              <p className="mt-1 text-[11px] text-muted">
                Go-to rate not set — add it in Accounts to see the interest cost.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The highlighted card marks the active monthly figure. It used to be a solid
// indigo tile with a money value on it; now it stays on the normal surface and
// is marked by a viz-palette left edge, keeping brand colour off the data.
// Snowball vs avalanche, same money either way. When every rate is equal the
// two orderings are mathematically identical — say that plainly instead of
// dressing up a $0 difference as a decision.
function OrderComparison({ data, currency }: { data: PayoffComparison; currency: string }) {
  const saves = data.interestSavedCents > 0 || data.monthsSaved > 0;
  return (
    <section className="rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Attack order</h2>
        <span className="text-[11px] text-muted">same monthly payment either way</span>
      </div>
      {saves ? (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Paying the <span className="font-semibold text-foreground">highest rate first</span>{" "}
            instead of the smallest balance would save{" "}
            {data.interestSavedCents > 0 ? (
              <span className="font-semibold tabular-nums" style={{ color: "var(--positive)" }}>
                {formatMoney(data.interestSavedCents, currency)}
              </span>
            ) : null}
            {data.interestSavedCents > 0 && data.monthsSaved > 0 ? " and " : ""}
            {data.monthsSaved > 0 ? (
              <span className="font-semibold tabular-nums" style={{ color: "var(--positive)" }}>
                {data.monthsSaved} month{data.monthsSaved === 1 ? "" : "s"}
              </span>
            ) : null}
            .
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-background px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wide text-muted">Smallest first</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatMoney(data.snowballInterestCents, currency)} interest
              </dd>
              {data.snowballFinish ? (
                <dd className="text-[11px] text-muted">done {monthLabel(data.snowballFinish)}</dd>
              ) : null}
            </div>
            <div className="rounded-lg bg-background px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wide text-muted">Highest rate first</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatMoney(data.avalancheInterestCents, currency)} interest
              </dd>
              {data.avalancheFinish ? (
                <dd className="text-[11px] text-muted">done {monthLabel(data.avalancheFinish)}</dd>
              ) : null}
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          No difference at your current rates — every tracked debt carries the same rate, so
          smallest-balance-first and highest-rate-first pay off on the same date for the same cost.
          This will start to matter once a debt at a different rate is added.
        </p>
      )}
    </section>
  );
}

function SummaryCard({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
      style={highlight ? { borderLeft: "3px solid var(--viz-savings)" } : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
