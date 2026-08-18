"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";

export type SavingsTxData = {
  id: string;
  date: string;
  payee: string | null;
  accountName: string | null;
  amountCents: number;
  isWithdrawal: boolean;
};

export type SavingsCardData = {
  id: string;
  name: string;
  goalCents: number;
  startCents: number;
  savedCents: number;
  monthlyCents: number;
  plannedCents: number;
  monthDepositsCents: number;
  monthWithdrawalsCents: number;
  monthNetCents: number;
  leftToSaveCents: number;
  targetDate: string | null;
  pace: "none" | "reached" | "on_track" | "behind" | "overdue";
  requiredMonthlyCents: number | null;
  transactions: SavingsTxData[];
  isKids: boolean;
};

type Props = {
  cards: SavingsCardData[];
  currency: string;
  incomeReceivedCents: number;
  currentMonthKey: string;
  currentMonthLabel: string;
};

type Scope = "family" | "all";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function statsFor(cards: SavingsCardData[]) {
  const totals = cards.reduce(
    (acc, card) => ({
      goal: acc.goal + card.goalCents,
      planned: acc.planned + card.plannedCents,
      saved: acc.saved + card.savedCents,
      deposits: acc.deposits + card.monthDepositsCents,
      withdrawals: acc.withdrawals + card.monthWithdrawalsCents,
      net: acc.net + card.monthNetCents,
    }),
    { goal: 0, planned: 0, saved: 0, deposits: 0, withdrawals: 0, net: 0 },
  );
  return {
    ...totals,
    left: Math.max(0, totals.goal - totals.saved),
    goalPct: totals.goal > 0 ? (totals.saved / totals.goal) * 100 : 0,
    planPct: totals.planned > 0 ? (totals.net / totals.planned) * 100 : 0,
  };
}

export function SavingsBoard({ cards, currency, incomeReceivedCents, currentMonthKey, currentMonthLabel }: Props) {
  const familyCards = cards.filter((card) => !card.isKids);
  const kidsCards = cards.filter((card) => card.isKids);
  const [scope, setScope] = useState<Scope>(familyCards.length > 0 ? "family" : "all");
  const scopedCards = scope === "family" ? familyCards : cards;
  const stats = statsFor(scopedCards);
  const savingsRate = incomeReceivedCents > 0 ? (stats.net / incomeReceivedCents) * 100 : null;

  const recentActivity = useMemo(
    () => scopedCards
      .flatMap((card) => card.transactions
        .filter((transaction) => transaction.date.startsWith(currentMonthKey))
        .map((transaction) => ({ ...transaction, goalName: card.name })))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 6),
    [currentMonthKey, scopedCards],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="pr-8 md:pr-0">
        <h1 className="text-2xl font-bold tracking-tight">Savings goals</h1>
        <p className="mt-1 text-sm text-muted">See what you saved from income, where it went, and what needs attention next.</p>
      </header>

      {cards.length === 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="px-4 py-8 text-center text-sm text-muted">
            No Savings items yet — add one in the Savings group on the Budget tab, then set its Goal there to see it here.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
            <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-brand-soft/35 px-4 py-3 dark:bg-brand-soft/15">
                <div>
                  <h2 className="text-base font-semibold">{currentMonthLabel}</h2>
                  <p className="text-xs text-muted">Savings activity from received income</p>
                </div>
                {kidsCards.length > 0 && familyCards.length > 0 ? (
                  <div className="inline-flex rounded-lg bg-surface p-1 text-xs ring-1 ring-black/5 dark:ring-white/10">
                    <ScopeButton active={scope === "family"} onClick={() => setScope("family")}>Family</ScopeButton>
                    <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>With kids</ScopeButton>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 divide-x divide-y divide-line/70 sm:grid-cols-4 sm:divide-y-0">
                <Metric label="Net saved" value={formatMoney(stats.net, currency)} detail={`${formatMoney(stats.deposits, currency)} deposited`} tone={stats.net >= 0 ? "text-positive" : "text-negative"} />
                <Metric label="Of income" value={savingsRate == null ? "—" : `${savingsRate.toFixed(1)}%`} detail={`${formatMoney(incomeReceivedCents, currency)} received`} tone={savingsRate != null && savingsRate > 0 ? "text-positive" : undefined} />
                <Metric label="Plan funded" value={stats.planned > 0 ? `${Math.max(0, stats.planPct).toFixed(0)}%` : "—"} detail={`${formatMoney(stats.net, currency)} of ${formatMoney(stats.planned, currency)}`} />
                <Metric label="Withdrawn" value={formatMoney(stats.withdrawals, currency)} detail={stats.withdrawals > 0 ? "moved out of goals" : "no withdrawals"} tone={stats.withdrawals > 0 ? "text-negative" : undefined} />
              </div>

              <div className="space-y-2 border-t border-line/70 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">Overall goal progress</span>
                  <span className="tabular-nums text-muted">{formatMoney(stats.saved, currency)} of {formatMoney(stats.goal, currency)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line/60">
                  <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, stats.goalPct))}%` }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
                  <span>{Math.min(100, Math.max(0, stats.goalPct)).toFixed(1)}% complete</span>
                  <span>{formatMoney(stats.left, currency)} left</span>
                </div>
              </div>

            </section>

            <ActivityPanel activity={recentActivity} currency={currency} monthLabel={currentMonthLabel} />
          </div>

          <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-brand-soft/35 px-4 py-3 dark:bg-brand-soft/15">
              <div>
                <h2 className="text-base font-semibold">Savings and investment goals</h2>
                <p className="text-xs text-muted">Select a goal to see its details and transactions.</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{cards.length} goal{cards.length === 1 ? "" : "s"}</span>
            </div>
            <div className="divide-y divide-line/70">
              {familyCards.length > 0 ? <GoalGroup title="Family goals" cards={familyCards} currency={currency} incomeReceivedCents={incomeReceivedCents} /> : null}
              {kidsCards.length > 0 ? <GoalGroup title="Kids funding" cards={kidsCards} currency={currency} incomeReceivedCents={incomeReceivedCents} /> : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-md px-2.5 py-1 font-medium transition ${active ? "bg-brand text-white shadow-sm" : "text-muted hover:text-foreground"}`}>{children}</button>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-3 py-3.5 text-center sm:px-4">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      <p className="mt-0.5 text-xs leading-tight text-foreground sm:text-sm">{detail}</p>
    </div>
  );
}

type Activity = SavingsTxData & { goalName: string };

function ActivityPanel({ activity, currency, monthLabel: label }: { activity: Activity[]; currency: string; monthLabel: string }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="border-b border-line/70 px-4 py-3"><h2 className="text-sm font-semibold">Recent activity</h2><p className="text-xs text-muted">Deposits and withdrawals in {label}</p></div>
      {activity.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center px-5 py-5 text-center"><div><div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>↗</div><p className="text-sm font-medium">No savings activity yet</p><p className="mt-1 text-xs text-muted">Savings transactions will appear here automatically.</p></div></div>
      ) : (
        <ul className="divide-y divide-line/60">
          {activity.map((transaction) => (
            <li key={transaction.id} className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${transaction.isWithdrawal ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive"}`} aria-hidden>{transaction.isWithdrawal ? "↓" : "↑"}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{transaction.goalName}</span><span className="block truncate text-[10px] text-muted">{shortDate(transaction.date)} · {transaction.payee ?? transaction.accountName ?? "Savings activity"}</span></span>
              <span className={`shrink-0 font-semibold tabular-nums ${transaction.isWithdrawal ? "text-negative" : "text-positive"}`}>{transaction.isWithdrawal ? "−" : "+"}{formatMoney(transaction.amountCents, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GoalGroup({ title, cards, currency, incomeReceivedCents }: { title: string; cards: SavingsCardData[]; currency: string; incomeReceivedCents: number }) {
  return (
    <div>
      <div className="bg-canvas/50 px-4 py-2 text-xs font-semibold text-muted">{title}</div>
      <div className="divide-y divide-line/60">{cards.map((card) => <SavingsGoalRow key={card.id} card={card} currency={currency} incomeReceivedCents={incomeReceivedCents} />)}</div>
    </div>
  );
}

function SavingsGoalRow({ card, currency, incomeReceivedCents }: { card: SavingsCardData; currency: string; incomeReceivedCents: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasGoal = card.goalCents > 0;
  const progress = hasGoal ? Math.min(100, Math.max(0, (card.savedCents / card.goalCents) * 100)) : 0;
  const incomeRate = incomeReceivedCents > 0 ? (card.monthNetCents / incomeReceivedCents) * 100 : null;

  return (
    <div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="grid w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-soft/20 md:grid-cols-[minmax(155px,1.1fr)_110px_minmax(190px,1fr)_100px_18px]">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="block min-w-0 flex-1 truncate text-sm font-semibold">{card.name}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted transition-transform md:hidden ${expanded ? "rotate-90" : ""}`} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          </span>
          <span className="mt-0.5 block"><StatusBadge pace={card.pace} hasGoal={hasGoal} /></span>
        </span>
        <span className="grid grid-cols-2 gap-3 md:block">
          <span><span className="block text-[10px] text-muted">This month</span><span className={`block text-sm font-semibold tabular-nums ${card.monthNetCents >= 0 ? "text-positive" : "text-negative"}`}>{card.monthNetCents >= 0 ? "+" : "−"}{formatMoney(Math.abs(card.monthNetCents), currency)}</span></span>
          <span className="md:hidden"><span className="block text-[10px] text-muted">Of income</span><span className="block text-sm font-semibold tabular-nums">{incomeRate == null ? "—" : `${incomeRate.toFixed(1)}%`}</span></span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[10px] text-muted"><span>{hasGoal ? `${progress.toFixed(0)}% complete` : "No goal set"}</span><span className="truncate tabular-nums">{hasGoal ? `${formatMoney(card.savedCents, currency)} / ${formatMoney(card.goalCents, currency)}` : formatMoney(card.savedCents, currency)}</span></span>
          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line/60"><span className={`block h-full rounded-full ${card.pace === "reached" ? "bg-positive" : "bg-brand"}`} style={{ width: `${progress}%` }} /></span>
        </span>
        <span className="hidden md:block"><span className="block text-[10px] text-muted">Of income</span><span className="block text-sm font-semibold tabular-nums">{incomeRate == null ? "—" : `${incomeRate.toFixed(1)}%`}</span></span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`hidden text-muted transition-transform md:block ${expanded ? "rotate-90" : ""}`} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
      </button>

      {expanded ? (
        <div className="border-t border-line/60 bg-canvas/35 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Detail label="Start" value={formatMoney(card.startCents, currency)} />
            <Detail label="Planned this month" value={formatMoney(card.plannedCents, currency)} />
            <Detail label="Left to save" value={hasGoal ? formatMoney(Math.max(0, card.leftToSaveCents), currency) : "—"} />
            <Detail label="Target / pace" value={card.targetDate ? monthLabel(card.targetDate) : "No target date"} sub={card.requiredMonthlyCents != null && card.pace !== "reached" ? `${formatMoney(card.requiredMonthlyCents, currency)}/mo needed` : undefined} />
          </div>
          <div className="mt-3 overflow-hidden rounded-xl bg-surface ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-line/60 px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent transactions</p><span className="text-[10px] text-muted">Up to 10</span></div>
            {card.transactions.length === 0 ? <p className="px-3 py-4 text-center text-xs text-muted">No transactions yet</p> : (
              <ul className="divide-y divide-line/50">
                {card.transactions.map((transaction) => (
                  <li key={transaction.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs">
                    <span className="tabular-nums text-muted">{shortDate(transaction.date)}</span>
                    <span className="min-w-0"><span className="block truncate">{transaction.payee ?? "Savings activity"}</span>{transaction.accountName ? <span className="block truncate text-[10px] text-muted">{transaction.accountName}</span> : null}</span>
                    <span className={`font-semibold tabular-nums ${transaction.isWithdrawal ? "text-negative" : "text-positive"}`}>{transaction.isWithdrawal ? "−" : "+"}{formatMoney(transaction.amountCents, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg bg-surface px-3 py-2 ring-1 ring-black/5 dark:ring-white/10"><p className="text-[10px] text-muted">{label}</p><p className="mt-0.5 truncate text-xs font-semibold tabular-nums">{value}</p>{sub ? <p className="mt-0.5 truncate text-[10px] text-muted">{sub}</p> : null}</div>;
}

function StatusBadge({ pace, hasGoal }: { pace: SavingsCardData["pace"]; hasGoal: boolean }) {
  if (!hasGoal) return <span className="text-[10px] font-medium text-muted">No goal</span>;
  const badges: Record<SavingsCardData["pace"], { label: string; className: string } | null> = {
    none: null,
    reached: { label: "✓ Reached", className: "text-positive" },
    on_track: { label: "✓ On track", className: "text-positive" },
    behind: { label: "Behind pace", className: "text-amber-600 dark:text-amber-400" },
    overdue: { label: "Overdue", className: "text-negative" },
  };
  const badge = badges[pace];
  return badge ? <span className={`text-[10px] font-medium ${badge.className}`}>{badge.label}</span> : <span />;
}
