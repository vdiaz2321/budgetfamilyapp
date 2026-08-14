"use client";

import { useRef, useState, useTransition } from "react";
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
  if (kind === "income") return remaining < 0 ? "text-negative" : "text-positive";
  if (plannedCents <= 0) return remaining < 0 ? "text-negative" : "text-foreground";
  if (remaining < 0) return "text-negative";
  if (remaining / plannedCents < 0.15) return "text-warning";
  return "text-positive";
}

// The Actual column takes the kind's accent so a scan of the column reads
// as "money in" / "money out" instantly, matching the group dot colors.
export function actualColorClass(kind: CategoryKind, spentCents: number): string {
  if (spentCents === 0) return "text-muted";
  if (kind === "income" || kind === "savings") return "text-positive";
  return "text-negative"; // bills / expenses
}

export const ACTUAL_LABEL: Record<CategoryKind, string> = {
  income: "Received",
  savings: "Invested",
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
  detailsExpanded?: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  autoPlanned?: boolean;
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
      className="absolute right-1 top-2 rounded p-0.5 text-muted/50 transition-all hover:bg-negative/10 hover:text-negative disabled:pointer-events-none sm:top-1/2 sm:-translate-y-1/2 sm:opacity-0 sm:group-hover:opacity-100 sm:group-hover:text-muted/50"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function BudgetRow({ row, kind, currency, monthKey, selected, isEven, isDragOver, compact, detailsExpanded, onSelect, onDragStart, autoPlanned }: Props) {
  const remaining = row.plannedCents - row.spentCents;
  const debtSetUp = row.debt != null && (row.debt.minCents > 0 || row.debt.apr > 0);
  const paidOff = kind === "debt" && debtSetUp && row.debt!.balanceCents <= 0;
  const plannedInputRef = useRef<HTMLInputElement>(null);

  const rawPct =
    row.plannedCents > 0
      ? (row.spentCents / row.plannedCents) * 100
      : row.spentCents > 0
        ? 100
        : 0;
  const pct = Math.min(100, Math.round(rawPct));

  // Overbudget also covers "no plan set but money went out" (spent > 0, planned 0)
  // so the current-month progress bar goes red when the row wasn't planned for.
  const overBudget = (kind === "bills" || kind === "expenses") && row.spentCents > row.plannedCents;
  const displayPct = overBudget ? -Math.floor(rawPct) : pct;
  const greenBarPct = overBudget
    ? row.plannedCents <= 0 ? 0 : (row.plannedCents / row.spentCents) * 100
    : pct;
  const redBarPct = overBudget ? 100 - greenBarPct : 0;

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
      className={`group relative flex flex-col gap-1.5 px-3 py-2 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 ${compact ? "sm:py-1" : "sm:py-1.5"} ${baseClass}`}
    >
      <DeleteButton subId={row.subId} />

      {/* Mobile row: the progress stripe spans Category + Planned only, so it
          stops before the Spent value instead of stretching across the row. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5 pr-6 sm:hidden">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 truncate text-left text-sm text-foreground"
        >
          {row.name}
        </button>

        <div className="text-xs tabular-nums text-muted">
          {autoPlanned ?? row.autoPlanned ? (
            <span>{formatMoney(row.plannedCents, currency)}</span>
          ) : (
            <MobilePlannedInput subId={row.subId} monthKey={monthKey} plannedCents={row.plannedCents} currency={currency} />
          )}
        </div>

        <button
          type="button"
          onClick={onSelect}
          className={`text-xs font-semibold tabular-nums ${
            remaining < 0 ? "text-negative" : actualColorClass(kind, row.spentCents)
          }`}
        >
          / {formatMoney(row.spentCents, currency)}
        </button>

        <div
          className="relative -ml-3 -mr-9 col-span-full mt-1.5 h-1.5 overflow-hidden rounded-none bg-[#eee9df] dark:bg-white/10"
          aria-label={`Current month progress: ${displayPct}%`}
        >
          {greenBarPct > 0 ? (
            <span
              className="absolute inset-y-0 left-0"
              style={{
                width: `${greenBarPct}%`,
                backgroundImage: "repeating-linear-gradient(135deg, rgba(74, 222, 128, .85) 0 2px, rgba(187, 247, 208, .65) 2px 4px)",
              }}
              aria-hidden
            />
          ) : null}
          {redBarPct > 0 ? (
            <span
              className="absolute inset-y-0"
              style={{
                left: `${greenBarPct}%`,
                width: `${redBarPct}%`,
                backgroundImage: "repeating-linear-gradient(135deg, rgba(248, 113, 113, .85) 0 2px, rgba(254, 202, 202, .7) 2px 4px)",
              }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>

      {/* Desktop name cell */}
      <div className="hidden min-w-0 items-center gap-1.5 sm:col-span-4 sm:flex">
        <span
          onMouseDown={(e) => { e.preventDefault(); onDragStart(); }}
          title="Drag to reorder"
          className="-ml-1 hidden shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing sm:flex"
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
        </button>

      </div>

      {/* Desktop: Planned — read-only when auto-derived */}
      <div
        className="hidden sm:col-span-2 sm:flex sm:justify-end"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {autoPlanned ?? row.autoPlanned ? (
          <span
            className="px-1 py-0.5 text-right text-xs text-muted tabular-nums"
            title="Auto-calculated from subscriptions / irregular bills"
          >
            {formatMoney(row.plannedCents, currency)}
          </span>
        ) : (
          <PlannedInput
            subId={row.subId}
            monthKey={monthKey}
            plannedCents={row.plannedCents}
            currency={currency}
            inputRef={plannedInputRef}
          />
        )}
      </div>

      {/* Desktop: Actual — read-only, click opens the panel */}
      <button
        type="button"
        onClick={onSelect}
        className={`hidden sm:col-span-2 sm:block sm:text-right sm:text-xs sm:font-semibold sm:tabular-nums ${actualColorClass(kind, row.spentCents)}`}
        title={`${ACTUAL_WORD[kind]} — click to edit transactions`}
      >
        {formatMoney(row.spentCents, currency)}
      </button>

      {/* Desktop: Remaining */}
      <button
        type="button"
        onClick={onSelect}
        className={`hidden sm:col-span-2 sm:text-right sm:text-xs sm:font-semibold sm:tabular-nums ${overBudget ? "sm:flex sm:justify-end" : "sm:block"}`}
        title={overBudget ? `Overspent by ${formatMoney(Math.abs(remaining), currency)}` : undefined}
      >
        {overBudget ? (
          <span className="inline-flex rounded-full bg-negative/15 px-2 py-0.5 text-foreground ring-1 ring-negative/15">
            {formatMoney(remaining, currency)}
          </span>
        ) : (
          <span className={remainingColorClass(kind, remaining, row.plannedCents)}>{formatMoney(remaining, currency)}</span>
        )}
      </button>

      {/* Desktop: % */}
      <button
        type="button"
        onClick={onSelect}
        className={`hidden sm:col-span-2 sm:block sm:text-center sm:text-xs sm:font-semibold sm:tabular-nums ${pctClass}`}
      >
        {displayPct}%
      </button>

      {detailsExpanded ? (
        <div className="hidden sm:col-span-6 sm:block sm:pb-0.5 sm:pl-6 sm:pr-2">
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-sm bg-[#eee9df] dark:bg-white/10"
            aria-label={`Current month progress: ${displayPct}%`}
          >
            {greenBarPct > 0 ? (
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${greenBarPct}%`,
                  backgroundImage: "repeating-linear-gradient(135deg, rgba(74, 222, 128, .85) 0 2px, rgba(187, 247, 208, .65) 2px 4px)",
                }}
                aria-hidden
              />
            ) : null}
            {redBarPct > 0 ? (
              <span
                className="absolute inset-y-0"
                style={{
                  left: `${greenBarPct}%`,
                  width: `${redBarPct}%`,
                  backgroundImage: "repeating-linear-gradient(135deg, rgba(248, 113, 113, .85) 0 2px, rgba(254, 202, 202, .7) 2px 4px)",
                }}
                aria-hidden
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function MobilePlannedInput({
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
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(plannedCents);

  // Display mode is a plain 12px span (matches "spent" size on the same row);
  // tap swaps in a real input at 16px so iOS won't auto-zoom on focus.
  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={`text-xs tabular-nums text-muted ${pending ? "ring-1 ring-brand rounded" : ""}`}
      >
        {formatMoney(plannedCents, currency)}
      </button>
    );
  }

  return (
    <form ref={formRef} action={(fd) => start(() => upsertPlan(fd))} className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      <input
        autoFocus
        key={initial}
        name="planned"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={`${currencySymbol(currency)}${initial}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          setEditing(false);
          if (e.currentTarget.value !== `${currencySymbol(currency)}${initial}`) formRef.current?.requestSubmit();
        }}
        style={{ fontSize: '16px' }}
        className="w-20 rounded bg-transparent px-0.5 text-right text-muted tabular-nums hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </form>
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
      className="group/planned relative flex items-center justify-end gap-1"
    >
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      <input
        key={initial}
        ref={inputRef}
        name="planned"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={`${currencySymbol(currency)}${initial}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== `${currencySymbol(currency)}${initial}`) formRef.current?.requestSubmit();
        }}
        title="Type a value or calculation, for example $1200 + 75 - 30"
        className={`w-24 min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-xs text-foreground tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}
