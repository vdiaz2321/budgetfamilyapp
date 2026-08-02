"use client";

import { useRef, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { deleteSubcategory, upsertPlan } from "./actions";
import type { RowData } from "./types";

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
  if (kind === "income") return "text-positive";
  if (plannedCents <= 0) return remaining < 0 ? "text-negative" : "text-foreground";
  if (remaining < 0) return "text-negative";
  if (remaining / plannedCents < 0.15) return "text-warning";
  return "text-positive";
}

// The Actual column takes the kind's accent so a scan of the column reads
// as "money in" / "money out" instantly, matching the group dot colors.
export function actualColorClass(kind: CategoryKind, spentCents: number): string {
  if (spentCents === 0) return "text-muted";
  if (kind === "income" || kind === "savings" || kind === "debt") return "text-positive";
  return "text-negative"; // bills / expenses
}

export const ACTUAL_LABEL: Record<CategoryKind, string> = {
  income: "Received",
  savings: "Saved",
  bills: "Spent",
  expenses: "Spent",
  debt: "Paid",
};

type Props = {
  row: RowData;
  kind: CategoryKind;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selected: boolean;
  isEven: boolean;
  isDragOver?: boolean;
  compact?: boolean;
  onSelect: () => void;
  onDragStart: () => void;
};

function DeleteButton({ subId }: { subId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this item? This cannot be undone.")) return;
        const fd = new FormData();
        fd.set("id", subId);
        start(() => deleteSubcategory(fd));
      }}
      title="Delete item"
      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 transition-all hover:bg-negative/10 hover:text-negative group-hover:opacity-100 group-hover:text-muted/50 disabled:pointer-events-none"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function BudgetRow({ row, kind, currency, monthKey, selected, isEven, isDragOver, compact, onSelect, onDragStart }: Props) {
  const isIncome = kind === "income";
  const remaining = row.plannedCents - row.spentCents;
  const debtSetUp = row.debt != null && (row.debt.minCents > 0 || row.debt.apr > 0);
  const paidOff = kind === "debt" && debtSetUp && row.debt!.balanceCents <= 0;
  const plannedInputRef = useRef<HTMLInputElement>(null);

  const pct =
    row.plannedCents > 0
      ? Math.min(100, Math.round((row.spentCents / row.plannedCents) * 100))
      : row.spentCents > 0
        ? 100
        : 0;

  const overBudget = !isIncome && row.plannedCents > 0 && row.spentCents > row.plannedCents;

  const baseClass = selected
    ? "bg-brand-soft/50"
    : isDragOver
      ? "bg-brand-soft/40 ring-1 ring-inset ring-brand/40"
      : isEven
        ? "bg-black/[0.018] dark:bg-white/[0.03] hover:bg-brand-soft/20"
        : "hover:bg-brand-soft/25";

  const pctClass = overBudget
    ? "font-bold text-negative"
    : pct >= 100
      ? "font-bold text-positive"
      : "text-muted";

  return (
    <li
      data-drop-key={`subcat:${row.subId}`}
      className={`group relative grid grid-cols-12 items-center gap-2 px-3 ${compact ? "py-1" : "py-1.5"} ${baseClass}`}
    >
      <DeleteButton subId={row.subId} />
      {/* Name cell — grip + name + due badge — click opens ItemPanel */}
      <div className="col-span-5 flex min-w-0 items-center gap-1.5 sm:col-span-4">
        <span
          onMouseDown={(e) => { e.preventDefault(); onDragStart(); }}
          title="Drag to reorder"
          className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className={`truncate text-sm ${paidOff ? "text-muted line-through" : "text-foreground"}`}>
            {row.name}
          </span>
          {row.dueDay ? (
            <span className="hidden shrink-0 rounded bg-brand-soft/50 px-1.5 py-0.5 text-[9px] font-medium text-muted md:inline">
              due {row.dueDay}
            </span>
          ) : null}
        </button>
      </div>

      {/* Actual — read-only, click opens the panel (transactions are edited there) */}
      <button
        type="button"
        onClick={onSelect}
        className={`col-span-2 text-right text-xs font-semibold tabular-nums ${actualColorClass(kind, row.spentCents)}`}
        title={`${ACTUAL_WORD[kind]} — click to edit transactions`}
      >
        {formatMoney(row.spentCents, currency)}
      </button>

      {/* Planned — inline-editable in place. Stops click from bubbling to onSelect. */}
      <div
        className="col-span-2 flex justify-end"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PlannedInput
          subId={row.subId}
          monthKey={monthKey}
          plannedCents={row.plannedCents}
          currency={currency}
          inputRef={plannedInputRef}
        />
      </div>

      {/* Remaining */}
      <button
        type="button"
        onClick={onSelect}
        className={`col-span-2 text-right text-xs font-semibold tabular-nums ${remainingColorClass(kind, remaining, row.plannedCents)}`}
      >
        {formatMoney(remaining, currency)}
      </button>

      {/* % */}
      <button
        type="button"
        onClick={onSelect}
        className={`col-span-2 text-center text-[11px] tabular-nums ${pctClass}`}
      >
        {pct}%
      </button>
    </li>
  );
}

function PlannedInput({
  subId,
  monthKey,
  plannedCents,
  currency,
  inputRef,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  currency: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(plannedCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => upsertPlan(fd))}
      className="flex items-center justify-end gap-0.5"
    >
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      <span className="pointer-events-none text-[11px] text-muted">
        {currencySymbol(currency)}
      </span>
      <input
        key={initial}
        ref={inputRef}
        name="planned"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-full min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-xs text-foreground tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}
