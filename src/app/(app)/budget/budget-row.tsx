"use client";

import { useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { upsertPlan } from "./actions";
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

// How far through the month we are, as a percentage — the reference point a
// spending bar needs to mean anything. 74% spent on the 22nd of a 31-day month
// is on pace; the same 74% on the 5th is not.
//
// Null for any month that isn't the current one: a finished month has no
// "pace" left to judge, and a future month hasn't started.
export function monthElapsedPct(monthKey: string): number | null {
  const [y, m] = monthKey.split("-").map(Number);
  const now = new Date();
  if (y !== now.getFullYear() || m !== now.getMonth() + 1) return null;
  const daysInMonth = new Date(y, m, 0).getDate();
  return Math.min(100, (now.getDate() / daysInMonth) * 100);
}

// A thin marker showing today's position along a spending bar. Purely visual —
// no extra row, no extra text.
function PaceMarker({ pct }: { pct: number | null }) {
  if (pct == null || pct <= 0 || pct >= 100) return null;
  return (
    <span
      className="absolute inset-y-0 z-10 w-px bg-foreground/45"
      style={{ left: `${pct}%` }}
      aria-hidden
    />
  );
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

function DueAccountIndicator({ dueDay, compact = false }: { dueDay: number; compact?: boolean }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-muted ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
      {compact ? `D${dueDay}` : `Due ${dueDay}`} · linked
    </span>
  );
}

export function BudgetRow({ row, kind, currency, monthKey, selected, isEven, isDragOver, compact, detailsExpanded, onSelect, onDragStart, autoPlanned }: Props) {
  const remaining = row.plannedCents - row.spentCents;
  const elapsedPct = monthElapsedPct(monthKey);
  const debtSetUp = row.debt != null && (row.debt.minCents > 0 || row.debt.apr > 0);
  const paidOff = kind === "debt" && debtSetUp && row.debt!.balanceCents <= 0;
  const showDueAccount = row.dueDay != null && row.paymentAccountId != null;
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
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, input, form, select, textarea, [data-row-click-ignore]")) return;
        onSelect();
      }}
      className={`group relative flex flex-col gap-1.5 px-3 py-2 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 ${compact ? "sm:py-1" : "sm:py-1.5"} ${baseClass}`}
    >
      {/* Mobile row: the progress stripe spans Category + Planned only, so it
          stops before the Spent value instead of stretching across the row. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-1.5 sm:hidden">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 items-center gap-1.5 text-left text-sm text-foreground"
        >
          <span className="min-w-0 truncate">{row.name}</span>
          {showDueAccount ? <DueAccountIndicator dueDay={row.dueDay!} compact /> : null}
        </button>

        <div className="text-[15px] tabular-nums text-muted">
          {autoPlanned ?? row.autoPlanned ? (
            <span>{formatMoney(row.plannedCents, currency)}</span>
          ) : (
            <MobilePlannedInput subId={row.subId} monthKey={monthKey} plannedCents={row.plannedCents} spentCents={row.spentCents} currency={currency} />
          )}
        </div>

        <button
          type="button"
          onClick={onSelect}
          className={`text-[15px] font-semibold tabular-nums ${
            remaining < 0 ? "text-negative" : actualColorClass(kind, row.spentCents)
          }`}
        >
          / {formatMoney(row.spentCents, currency)}
        </button>

        {/* Remaining — the number the row is actually consulted for. Desktop
            has always had its own column; mobile used to force mental
            arithmetic from Planned and Spent. */}
        <button
          type="button"
          onClick={onSelect}
          className="text-[15px] font-bold tabular-nums"
        >
          {overBudget ? (
            <span className="inline-flex rounded-full bg-negative/15 px-1.5 py-0.5 text-foreground ring-1 ring-negative/15">
              {formatMoney(remaining, currency)}
            </span>
          ) : (
            <span className={remainingColorClass(kind, remaining, row.plannedCents)}>
              {formatMoney(remaining, currency)}
            </span>
          )}
        </button>

        <div
          className="relative -ml-3 -mr-3 col-span-full mt-1.5 h-1.5 overflow-hidden rounded-none bg-[#eee9df] dark:bg-white/10"
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
          <PaceMarker pct={elapsedPct} />
        </div>
      </div>

      {/* Desktop name cell */}
      <div className="hidden min-w-0 items-center gap-1.5 sm:col-span-4 sm:flex">
        <span
          onMouseDown={(e) => { e.preventDefault(); onDragStart(); }}
          data-row-click-ignore
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
          {showDueAccount ? <DueAccountIndicator dueDay={row.dueDay!} /> : null}
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
            spentCents={row.spentCents}
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

      {/* Desktop progress percentage. */}
      <button
        type="button"
        onClick={onSelect}
        className="hidden sm:col-span-2 sm:block sm:text-center sm:tabular-nums"
      >
        <span className={`block text-xs font-semibold ${pctClass}`}>{displayPct}%</span>
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
          <PaceMarker pct={elapsedPct} />
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
  spentCents,
  currency,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  spentCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(plannedCents);
  const canMatch = spentCents > 0 && spentCents !== plannedCents;

  // Display mode is a plain 12px span (matches "spent" size on the same row);
  // tap swaps in a real input at 16px so iOS won't auto-zoom on focus.
  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={`text-[15px] tabular-nums text-muted ${pending ? "ring-1 ring-brand rounded" : ""}`}
      >
        {formatMoney(plannedCents, currency)}
      </button>
    );
  }

  return (
    <form ref={formRef} action={(fd) => start(() => upsertPlan(fd))} className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      {canMatch ? (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            const el = inputRef.current;
            if (!el) return;
            el.value = `${currencySymbol(currency)}${centsToDisplay(spentCents)}`;
            formRef.current?.requestSubmit();
            setEditing(false);
          }}
          className={MATCH_BTN_CLASS}
        >
          Match spent ({formatMoney(spentCents, currency)})
        </button>
      ) : null}
      <input
        autoFocus
        ref={inputRef}
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
        className="w-24 rounded bg-transparent px-0.5 text-right text-muted tabular-nums hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </form>
  );
}

// The Match-spent affordance is a real button sitting over a data row, so it
// has to read as pressable at a glance — solid fill, not a bordered tooltip.
const MATCH_BTN_CLASS =
  "absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-[12px] font-bold text-white shadow-md ring-1 ring-black/10 transition hover:bg-foreground/75 active:scale-95";

function PlannedInput({
  subId,
  monthKey,
  plannedCents,
  spentCents,
  currency,
  inputRef,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  spentCents: number;
  currency: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [pending, start] = useTransition();
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(plannedCents);
  // Nothing to match to on an untouched row, and no point offering it when
  // Planned already equals Actual.
  const canMatch = spentCents > 0 && spentCents !== plannedCents;

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => upsertPlan(fd))}
      className="group/planned relative flex items-center justify-end gap-1"
    >
      <input type="hidden" name="subcategoryId" value={subId} />
      <input type="hidden" name="month" value={monthKey} />
      {focused && canMatch ? (
        <button
          type="button"
          // pointerdown lands before the input's blur; preventing its default
          // keeps focus (and therefore this button) alive long enough for the
          // tap/click to register — on iOS a mousedown handler would be too late.
          onPointerDown={(e) => {
            e.preventDefault();
            const el = inputRef.current;
            if (!el) return;
            el.value = `${currencySymbol(currency)}${centsToDisplay(spentCents)}`;
            formRef.current?.requestSubmit();
          }}
          className={MATCH_BTN_CLASS}
        >
          Match spent ({formatMoney(spentCents, currency)})
        </button>
      ) : null}
      <input
        key={initial}
        ref={inputRef}
        name="planned"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={`${currencySymbol(currency)}${initial}`}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={(e) => {
          setFocused(false);
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
