"use client";

import { useRef, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { upsertPlan } from "./actions";
import type { RowData, ViewMode } from "./types";

type Props = {
  row: RowData;
  kind: CategoryKind;
  mode: ViewMode;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selected: boolean;
  onSelect: () => void;
};

export function BudgetRow({ row, kind, mode, currency, monthKey, selected, onSelect }: Props) {
  const isIncome = kind === "income";
  const remaining = row.plannedCents - row.spentCents;
  const paidOff = kind === "debt" && row.debt != null && row.debt.balanceCents <= 0;
  // "spent" mode shows the actual (money received for income, spent otherwise);
  // "remaining" mode shows planned − actual for both.
  const modeValue = mode === "spent" ? row.spentCents : remaining;
  // Income received is good news (green); a red negative is reserved for
  // over-spending an expense, never for income.
  const valueClass = isIncome
    ? mode === "spent" && row.spentCents > 0
      ? "text-positive"
      : "text-foreground"
    : mode === "remaining" && remaining < 0
      ? "text-negative"
      : "text-foreground";

  // Progress line: green fill up to plan; red (full) once overspent.
  // Income can't "overspend" — receiving more than planned is fine, so it
  // stays green.
  const overspent =
    !isIncome && (row.plannedCents > 0 ? row.spentCents > row.plannedCents : row.spentCents > 0);
  const pct =
    row.plannedCents > 0
      ? Math.min(100, (row.spentCents / row.plannedCents) * 100)
      : row.spentCents > 0
        ? 100
        : 0;

  return (
    <li className={selected ? "bg-brand-soft/50" : "hover:bg-brand-soft/25"}>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-2 px-4 py-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="flex items-baseline gap-2 truncate text-left"
        >
          <span className={`truncate text-sm ${paidOff ? "text-muted line-through" : "text-foreground"}`}>
            {row.name}
          </span>
          {row.dueDay ? <span className="shrink-0 text-[11px] text-muted">due {row.dueDay}</span> : null}
        </button>

        <PlannedInput
          subId={row.subId}
          monthKey={monthKey}
          plannedCents={row.plannedCents}
          currency={currency}
        />

        <button
          type="button"
          onClick={onSelect}
          className={`text-right text-sm tabular-nums ${valueClass}`}
        >
          {formatMoney(modeValue, currency)}
        </button>
      </div>

      {/* Spent-vs-planned progress line */}
      <div className="h-[3px] w-full bg-line/50">
        <div
          className={`h-full transition-all ${overspent ? "bg-negative" : "bg-positive"}`}
          style={{ width: `${overspent ? 100 : pct}%` }}
        />
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
      className="relative justify-self-end"
    >
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
        {currencySymbol(currency)}
      </span>
      <input
        // Remount (reset to the server value) whenever the saved amount changes.
        key={initial}
        name="planned"
        type="number"
        step="0.01"
        inputMode="decimal"
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-[7rem] rounded-md bg-transparent py-1 pl-5 pr-2 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}
