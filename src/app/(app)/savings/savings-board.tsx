"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type SavingsTxData = {
  id: string;
  date: string;
  payee: string | null;
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
  leftToSaveCents: number;
  targetDate: string | null; // YYYY-MM-DD
  pace: "none" | "reached" | "on_track" | "behind" | "overdue";
  requiredMonthlyCents: number | null;
  transactions: SavingsTxData[];
};

type Props = {
  cards: SavingsCardData[];
  currency: string;
};

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[m - 1]} ${y}`;
}

export function SavingsBoard({ cards, currency }: Props) {
  const totals = cards.reduce(
    (acc, c) => ({
      goal: acc.goal + c.goalCents,
      planned: acc.planned + c.plannedCents,
      saved: acc.saved + c.savedCents,
    }),
    { goal: 0, planned: 0, saved: 0 },
  );
  const leftToSave = Math.max(0, totals.goal - totals.saved);
  const remainingPct = totals.goal > 0 ? (leftToSave / totals.goal) * 100 : 0;
  const withGoal = cards.filter((c) => c.goalCents > 0);
  const onTrack = withGoal.filter((c) => c.pace === "on_track" || c.pace === "reached").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      {/* Header — hero total on the right */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Savings goals</h1>
          <p className="mt-1 text-sm text-muted">
            Track every goal toward its target. Set one in Budget.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Total saved</p>
          <p className="text-2xl font-semibold text-positive tabular-nums">
            {formatMoney(totals.saved, currency)}
          </p>
        </div>
      </header>

      {cards.length === 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="px-4 py-8 text-center text-sm text-muted">
            No Savings items yet — add one in the Savings group on the Budget tab, then set its
            Goal there to see it here.
          </p>
        </section>
      ) : (
        <>
          {/* Connected stats bar */}
          <div className="flex overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5 dark:ring-white/10">
            <Stat label="Total goal" amount={formatMoney(totals.goal, currency)} sub={`across ${cards.length} goal${cards.length === 1 ? "" : "s"}`} />
            <Stat label="Planned this month" amount={formatMoney(totals.planned, currency)} sub="budgeted" />
            <Stat
              label="Left to save"
              amount={formatMoney(leftToSave, currency)}
              amountTone={leftToSave > 0 ? "text-negative" : "text-positive"}
              sub={totals.goal > 0 ? `${remainingPct.toFixed(1)}% remaining` : "—"}
            />
          </div>

          {/* Section header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active goals</h2>
            <span className="text-xs text-muted">{cards.length} goal{cards.length === 1 ? "" : "s"}</span>
          </div>

          {/* Goal cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((c) => (
              <SavingsGoalCard key={c.id} card={c} currency={currency} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  amount,
  sub,
  amountTone,
}: {
  label: string;
  amount: string;
  sub: string;
  amountTone?: string;
}) {
  return (
    <div className="relative flex-1 px-4 py-4 text-center [&:not(:last-child)]:border-r [&:not(:last-child)]:border-line/70">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${amountTone ?? ""}`}>{amount}</p>
      <p className="mt-0.5 text-[11px] text-muted/80">{sub}</p>
    </div>
  );
}

function SavingsGoalCard({ card, currency }: { card: SavingsCardData; currency: string }) {
  const hasGoal = card.goalCents > 0;
  const percent = hasGoal ? Math.min(100, Math.max(0, (card.savedCents / card.goalCents) * 100)) : 0;
  const reached = card.pace === "reached";
  const [showTxs, setShowTxs] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5 transition duration-200 hover:shadow-lg dark:ring-white/10">
      {/* Header — name + three-dot menu */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{card.name}</h3>
        <button
          type="button"
          aria-label="Show transactions"
          title="Transactions"
          onClick={() => setShowTxs((v) => !v)}
          className={`rounded-md p-1 text-muted transition hover:bg-brand-soft hover:text-foreground ${showTxs ? "opacity-100 bg-brand-soft text-foreground" : "opacity-0 group-hover:opacity-100"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Ring + amounts */}
      <div className="mb-3 flex items-center gap-3">
        <Ring percent={percent} hasGoal={hasGoal} reached={reached} />
        <div className="min-w-0 flex-1">
          {hasGoal ? (
            <>
              <p className="truncate text-lg font-semibold tabular-nums">
                {formatMoney(card.savedCents, currency)}
              </p>
              <p className="truncate text-[11px] text-muted">
                of {formatMoney(card.goalCents, currency)} goal
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-muted">—</p>
              <p className="text-[11px] text-muted">No goal set</p>
            </>
          )}
        </div>
      </div>

      {/* Horizontal progress bar */}
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line/60">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${reached ? "bg-positive" : hasGoal ? "bg-brand" : "bg-transparent"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Status + ETA row */}
      <div className="mb-3 flex items-center justify-between">
        <StatusBadge pace={card.pace} hasGoal={hasGoal} />
        <span className="text-[11px] text-muted">
          {card.targetDate ? monthLabel(card.targetDate) : hasGoal ? "No date" : ""}
        </span>
      </div>

      {/* Condensed details */}
      {hasGoal ? (
        <dl className="space-y-1 border-t border-line/70 pt-3 text-xs">
          <Row label="Start" value={formatMoney(card.startCents, currency)} />
          <Row label="Planned" value={formatMoney(card.plannedCents, currency)} />
          <Row label="Left" value={formatMoney(Math.max(0, card.leftToSaveCents), currency)} />
        </dl>
      ) : (
        <dl className="space-y-1 border-t border-line/70 pt-3 text-xs opacity-60">
          <Row label="Start" value={formatMoney(card.startCents, currency)} />
          <Row label="Planned" value={formatMoney(card.plannedCents, currency)} />
          <Row label="Left" value="—" />
        </dl>
      )}

      {/* Behind / overdue hint */}
      {card.pace === "behind" && card.requiredMonthlyCents != null ? (
        <div className="mt-3 rounded-lg bg-negative/[0.06] px-2.5 py-1.5 text-center text-[11px] font-medium text-negative">
          Need {formatMoney(card.requiredMonthlyCents, currency)}/mo to hit target
        </div>
      ) : null}
      {card.pace === "overdue" ? (
        <div className="mt-3 rounded-lg bg-negative/[0.06] px-2.5 py-1.5 text-center text-[11px] font-medium text-negative">
          Past target — {formatMoney(Math.max(0, card.leftToSaveCents), currency)} still needed
        </div>
      ) : null}

      {/* Transaction dropdown */}
      {showTxs ? (
        <div className="mt-3 border-t border-line/70 pt-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Recent transactions
          </p>
          {card.transactions.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted">No transactions yet</p>
          ) : (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {card.transactions.map((t) => {
                const [, m, d] = t.date.split("-").map(Number);
                const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return (
                  <li key={t.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]">
                    <span className="w-9 shrink-0 tabular-nums text-muted">{MONTHS[m - 1]} {d}</span>
                    <span className="min-w-0 flex-1 truncate">{t.payee ?? "—"}</span>
                    <span className={`shrink-0 tabular-nums font-medium ${t.isWithdrawal ? "text-positive" : "text-negative"}`}>
                      {t.isWithdrawal ? "+" : "−"}{formatMoney(t.amountCents, currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ pace, hasGoal }: { pace: SavingsCardData["pace"]; hasGoal: boolean }) {
  if (!hasGoal) {
    return (
      <span className="rounded-md bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
        No goal
      </span>
    );
  }
  const map: Record<SavingsCardData["pace"], { label: string; className: string } | null> = {
    none: null,
    reached: { label: "🎉 Reached", className: "bg-positive/12 text-positive" },
    on_track: { label: "✓ On track", className: "bg-positive/12 text-positive" },
    behind: { label: "! Behind pace", className: "bg-negative/12 text-negative" },
    overdue: { label: "! Overdue", className: "bg-negative/12 text-negative" },
  };
  const b = map[pace];
  if (!b) return <span />;
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${b.className}`}>
      {b.label}
    </span>
  );
}

function Ring({ percent, hasGoal, reached }: { percent: number; hasGoal: boolean; reached: boolean }) {
  const R = 26;
  const STROKE = 5;
  const C = 2 * Math.PI * R;
  const dash = (percent / 100) * C;

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle
          cx="32" cy="32" r={R} fill="none"
          strokeWidth={STROKE}
          className="stroke-line/60"
        />
        {hasGoal ? (
          <circle
            cx="32" cy="32" r={R} fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C - dash}`}
            className={reached ? "stroke-positive" : "stroke-brand"}
          />
        ) : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className={`text-[13px] font-bold tabular-nums ${hasGoal ? "" : "text-muted"}`}>
          {hasGoal ? `${Math.round(percent)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
