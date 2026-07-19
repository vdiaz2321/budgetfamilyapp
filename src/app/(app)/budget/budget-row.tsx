"use client";

import { useRef, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { upsertPlan } from "./actions";
import type { RowData } from "./types";
import { ROW_CLASSES, CategoryIcon, Sparkline } from "./category-icons";

const ACTUAL_WORD: Record<CategoryKind, string> = {
  income: "received",
  savings: "saved",
  bills: "spent",
  expenses: "spent",
  debt: "paid",
};

// Positive/warning/negative per the spec's remaining-amount rule, adapted so
// income's "less remaining to receive" reads as good, not tight — the
// generic (remaining/planned < 15%) rule only applies to money going out.
export function remainingColorClass(kind: CategoryKind, remaining: number, plannedCents: number): string {
  // Income "remaining" is just what's left to receive — never a bad thing.
  if (kind === "income") return "text-positive";
  if (plannedCents <= 0) return remaining < 0 ? "text-negative" : "text-foreground";
  if (remaining < 0) return "text-negative";
  if (remaining / plannedCents < 0.15) return "text-warning";
  return "text-positive";
}

type Props = {
  row: RowData;
  kind: CategoryKind;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selected: boolean;
  isSnowballFocus?: boolean;
  onSelect: () => void;
};

export function BudgetRow({ row, kind, currency, monthKey, selected, isSnowballFocus, onSelect }: Props) {
  const isIncome = kind === "income";
  const remaining = row.plannedCents - row.spentCents;
  // Only strike an *established* debt that's been paid down to zero — not a
  // brand-new debt whose balance hasn't been entered yet. dueDay is set at
  // add-time (before the balance), so it's NOT a signal of "set up" — only
  // min payment / interest (entered later, in the detail panel) count.
  const debtSetUp = row.debt != null && (row.debt.minCents > 0 || row.debt.apr > 0);
  const paidOff = kind === "debt" && debtSetUp && row.debt!.balanceCents <= 0;

  const pct =
    row.plannedCents > 0
      ? Math.min(100, (row.spentCents / row.plannedCents) * 100)
      : row.spentCents > 0
        ? 100
        : 0;

  const rowClasses = ROW_CLASSES[kind];
  // Progress bar + sparkline are blue by default across every category, red
  // only when over budget — income has no "overspent" concept, so it's
  // always blue.
  const overBudget = !isIncome && row.plannedCents > 0 && row.spentCents > row.plannedCents;
  const sparklineAccent = overBudget ? "negative" : "chart-1";
  const barClass = overBudget ? "bg-negative" : "bg-chart-1";

  return (
    <li className={`group ${selected ? "bg-brand-soft/50" : "hover:bg-brand-soft/25"}`}>
      <div className="flex items-start gap-3 px-4 py-2.5">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${rowClasses.iconBg} ${rowClasses.iconText}`}
        >
          <CategoryIcon kind={kind} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onSelect}
              className="flex min-w-0 items-baseline gap-2 truncate text-left"
            >
              <span className={`truncate text-sm ${paidOff ? "text-muted line-through" : "text-foreground"}`}>
                {row.name}
              </span>
              {row.dueDay ? <span className="shrink-0 text-[11px] text-muted">due {row.dueDay}</span> : null}
              {isSnowballFocus ? (
                <span className="shrink-0 rounded-md bg-negative/12 px-1.5 py-0.5 text-[10px] font-medium text-negative">
                  next to pay
                </span>
              ) : null}
            </button>

            <div className="flex shrink-0 items-center gap-2">
              <Sparkline values={row.sparkline} accent={sparklineAccent} />
              <button
                type="button"
                onClick={onSelect}
                className={`text-sm tabular-nums ${remainingColorClass(kind, remaining, row.plannedCents)}`}
              >
                {formatMoney(remaining, currency)}
              </button>
              <button
                type="button"
                onClick={onSelect}
                aria-label={`Edit ${row.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-muted hover:text-foreground"
                  aria-hidden
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </div>
          </div>

          <div className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/60`}>
            <div
              className={`h-full rounded-full ${barClass} transition-[width] duration-200`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {formatMoney(row.spentCents, currency)} {ACTUAL_WORD[kind]}
            </span>
            <PlannedInput
              subId={row.subId}
              monthKey={monthKey}
              plannedCents={row.plannedCents}
              currency={currency}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function PlannedInput({
  subId,
  monthKey,
  plannedCents,
  currency,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(plannedCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => upsertPlan(fd))}
      className="flex items-center gap-0.5"
    >
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      <span className="pointer-events-none text-[11px] text-muted">
        {currencySymbol(currency)}
      </span>
      <input
        // Remount (reset to the server value) whenever the saved amount changes.
        key={initial}
        name="planned"
        // type=text (not number) so the `size` attr can shrink the box to fit
        // its content — `size` is ignored on number inputs, which strands the $.
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        size={Math.max(initial.length, 4) + 2}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent py-0.5 px-1 text-right text-[11px] text-muted tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
      <span className="pointer-events-none text-[11px] text-muted">planned</span>
    </form>
  );
}
