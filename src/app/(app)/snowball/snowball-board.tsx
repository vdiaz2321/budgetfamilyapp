"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import type { MonthlyEntry } from "@/lib/snowball";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(month: string): string {
  const idx = parseInt(month.slice(5, 7), 10) - 1;
  return `${MONTHS_SHORT[idx]} ${month.slice(0, 4)}`;
}

// One pastel per card, cycling — mirrors the sheet's alternating debt colors.
const CARD_COLORS = [
  "bg-sky-100 dark:bg-sky-500/15",
  "bg-violet-100 dark:bg-violet-500/15",
  "bg-amber-100 dark:bg-amber-500/15",
  "bg-rose-100 dark:bg-rose-500/15",
  "bg-emerald-100 dark:bg-emerald-500/15",
];

type Row = {
  subId: string;
  name: string;
  balanceCents: number;
  minCents: number;
  plannedCents: number;
  paidCents: number;
  paidThisMonthCents: number;
  apr: number;
  dueDay: number | null;
};

type Mode = "planned" | "classic";

type Props = {
  rows: Row[];
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
  // The Monthly Extra / dated-period controls only drive the classic method,
  // so they're rendered here and shown only when Classic Snowball is active.
  settings: ReactNode;
};

export function SnowballBoard({
  rows,
  focusId,
  totalBalanceCents,
  totalMinCents,
  plannedTotalCents,
  currentExtraCents,
  monthlyAttackCents,
  plannedPayoffMonth,
  plannedLedger,
  classicPayoffMonth,
  classicLedger,
  currency,
  settings,
}: Props) {
  const [mode, setMode] = useState<Mode>("planned");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const payoffMonth = mode === "planned" ? plannedPayoffMonth : classicPayoffMonth;
  const ledger = mode === "planned" ? plannedLedger : classicLedger;

  const selected = rows.find((r) => r.subId === selectedId) ?? null;
  const selectedMonths = selectedId ? ledger[selectedId] ?? [] : [];

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 rounded-xl bg-surface p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <button
          type="button"
          onClick={() => setMode("planned")}
          className={`rounded-lg py-2 text-sm font-semibold transition ${
            mode === "planned" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground"
          }`}
        >
          My Plan
        </button>
        <button
          type="button"
          onClick={() => setMode("classic")}
          className={`rounded-lg py-2 text-sm font-semibold transition ${
            mode === "classic" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground"
          }`}
        >
          Classic Snowball
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        {mode === "planned"
          ? "Each debt paid at its own Planned amount from Budget — no attack order."
          : "Textbook method: pay every minimum, throw the Monthly Extra at the smallest balance."}
      </p>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total debt" value={formatMoney(totalBalanceCents, currency)} />
        <SummaryCard label="Minimums / mo" value={formatMoney(totalMinCents, currency)} />
        {mode === "planned" ? (
          <SummaryCard label="Planned / mo" value={formatMoney(plannedTotalCents, currency)} highlight />
        ) : (
          <SummaryCard
            label="Monthly attack"
            value={formatMoney(monthlyAttackCents, currency)}
            hint={`incl. ${formatMoney(currentExtraCents, currency)} extra this month`}
            highlight
          />
        )}
        <SummaryCard
          label="Total paid / mo"
          value={formatMoney(rows.reduce((sum, r) => sum + r.paidThisMonthCents, 0), currency)}
        />
      </div>

      {/* Debt cards */}
      {rows.length === 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="px-4 py-6 text-center text-sm text-muted">
            No debts yet. Add them in the Debt group on the{" "}
            <Link href="/budget" className="font-medium text-brand hover:text-brand-strong">
              Budget tab
            </Link>
            .
          </p>
        </section>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {rows.map((r, i) => {
            const isFocus = mode === "classic" && r.subId === focusId;
            const isPaid = r.balanceCents <= 0;
            const payoff = payoffMonth[r.subId] ?? null;
            const months = ledger[r.subId] ?? [];
            const hasLedger = months.length > 0;
            const isSelected = selectedId === r.subId;
            // Classic mode, non-focus debt: the month the snowball reaches it
            // (first month its payment jumps above the minimum). Makes the
            // rollover visible instead of a flat "This month = minimum".
            const snowballHits =
              mode === "classic" && !isPaid && !isFocus
                ? months.find((m) => m.paymentCents > r.minCents)?.month ?? null
                : null;

            return (
              <button
                key={r.subId}
                type="button"
                onClick={() => hasLedger && setSelectedId((id) => (id === r.subId ? null : r.subId))}
                disabled={!hasLedger}
                className={`w-[172px] shrink-0 overflow-hidden rounded-2xl border-2 text-left shadow-sm transition disabled:cursor-default ${
                  isFocus || isSelected
                    ? "border-brand"
                    : "border-transparent ring-1 ring-black/5 dark:ring-white/10"
                }`}
              >
                <div className={`px-3 py-2 ${CARD_COLORS[i % CARD_COLORS.length]}`}>
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-foreground/70">Debt</p>
                    {isFocus ? (
                      <span className="rounded-full bg-brand px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                        Focus
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs italic text-foreground/80">{r.name}</p>
                </div>
                <div className="bg-surface px-3 py-3">
                  {isPaid ? (
                    <p className="text-lg font-bold text-positive">Paid off</p>
                  ) : payoff ? (
                    <>
                      <p className="text-lg font-bold tabular-nums">{monthLabel(payoff)}</p>
                      <p className="text-[10px] italic text-muted">Debt Paid Off</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-muted">5yr+</p>
                      <p className="text-[10px] italic text-muted">Debt Paid Off</p>
                    </>
                  )}
                  <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                    <CardRow label="Balance" value={formatMoney(Math.max(0, r.balanceCents), currency)} />
                    <CardRow label="Paid so far" value={formatMoney(r.paidCents, currency)} />
                    <CardRow label="Min. Payment" value={formatMoney(r.minCents, currency)} />
                    <CardRow label="Interest Rate" value={r.apr ? `${r.apr}%` : "—"} />
                    <CardRow label="Planned/mo" value={formatMoney(r.plannedCents, currency)} />
                    {!isPaid ? (
                      <CardRow
                        label="Paid this month"
                        value={formatMoney(r.paidThisMonthCents, currency)}
                        highlight
                      />
                    ) : null}
                    {!isPaid && isFocus && currentExtraCents > 0 ? (
                      <CardRow label="+ Snowball extra" value={formatMoney(currentExtraCents, currency)} highlight />
                    ) : null}
                    {snowballHits ? (
                      <p className="pt-0.5 text-[10px] italic text-brand">
                        Snowball hits {monthLabel(snowballHits)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && selectedMonths.length > 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">{selected.name} — payment schedule</h2>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs font-medium text-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-[1fr_7rem_7rem] gap-2 px-4 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <span>Month</span>
            <span className="text-right">Payment</span>
            <span className="text-right">Balance</span>
          </div>
          <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto px-4 pb-2">
            {selectedMonths.map((m) => (
              <li key={m.month} className="grid grid-cols-[1fr_7rem_7rem] gap-2 py-1.5 text-sm">
                <span className="text-muted">{monthLabel(m.month)}</span>
                <span className="text-right tabular-nums">{formatMoney(m.paymentCents, currency)}</span>
                <span className="text-right tabular-nums">{formatMoney(m.balanceCents, currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Extra / dated-period controls only affect the classic method. */}
      {mode === "classic" ? settings : null}
    </div>
  );
}

function CardRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px] text-muted">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums ${highlight ? "text-brand" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${
        highlight ? "bg-brand text-white ring-0" : "bg-surface"
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${highlight ? "text-white/80" : "text-muted"}`}>
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {hint ? (
        <p className={`text-[11px] ${highlight ? "text-white/80" : "text-muted"}`}>{hint}</p>
      ) : null}
    </div>
  );
}
