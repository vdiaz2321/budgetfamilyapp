"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import { addSubcategory } from "./actions";
import { BudgetRow } from "./budget-row";
import type { GroupData, RowData, ViewMode } from "./types";

const ACCENT: Record<CategoryKind, string> = {
  income: "bg-positive",
  savings: "bg-sky-500",
  bills: "bg-brand",
  expenses: "bg-accent",
  debt: "bg-negative",
};

type Props = {
  group: GroupData;
  mode: ViewMode;
  onToggleMode: () => void;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selectedSubId: string | null;
  onSelectRow: (row: RowData, kind: CategoryKind) => void;
};

export function BudgetGroup({
  group,
  mode,
  onToggleMode,
  currency,
  monthKey,
  selectedSubId,
  onSelectRow,
}: Props) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [hidePaidOff, setHidePaidOff] = useState(false);

  const hasDue = KINDS_WITH_DUE.includes(group.kind);
  const isDebt = group.kind === "debt";
  const isIncome = group.kind === "income";
  // Same toggle for every group; only the "actual" label differs — income
  // "receives" money while everything else "spends" it.
  const actualLabel = isIncome ? "Received" : "Spent";
  const modeLabel = mode === "spent" ? actualLabel : "Remaining";

  const visibleRows = group.rows.filter((r) => {
    if (isDebt && hidePaidOff && r.debt && r.debt.balanceCents <= 0) return false;
    return true;
  });

  // Both modes use the same formula (planned − actual for "remaining").
  const modeTotal =
    mode === "spent" ? group.spentTotal : group.plannedTotal - group.spentTotal;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header row */}
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ACCENT[group.kind]}`} />
          <span className="font-semibold">{group.name}</span>
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {open ? (
          <>
            <span className="text-right text-[11px] font-medium uppercase tracking-wide text-muted">
              Planned
            </span>
            <button
              type="button"
              onClick={onToggleMode}
              title={`Switch ${actualLabel} / Remaining`}
              className="flex items-center justify-end gap-0.5 text-[11px] font-medium uppercase tracking-wide text-muted hover:text-foreground"
            >
              {modeLabel}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <span className="text-right text-sm font-bold tabular-nums">
              {formatMoney(group.plannedTotal, currency)}
            </span>
            <span className="text-right text-sm font-bold tabular-nums">
              {formatMoney(modeTotal, currency)}
            </span>
          </>
        )}
      </div>

      {open ? (
        <div className="border-t border-line">
          {visibleRows.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">No items yet — add one below.</p>
          ) : (
            <ul>
              {visibleRows.map((row) => (
                <BudgetRow
                  key={row.subId}
                  row={row}
                  kind={group.kind}
                  mode={mode}
                  currency={currency}
                  monthKey={monthKey}
                  selected={row.subId === selectedSubId}
                  onSelect={() => onSelectRow(row, group.kind)}
                />
              ))}
            </ul>
          )}

          {adding ? (
            <AddItemForm
              categoryId={group.categoryId}
              hasDue={hasDue}
              onDone={() => setAdding(false)}
            />
          ) : null}

          {/* Footer: add link + totals */}
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-2 border-t border-line px-4 py-2">
            <div className="flex items-center gap-3">
              {!adding ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="text-sm font-medium text-brand hover:text-brand-strong"
                >
                  + Add {group.kind === "income" ? "income" : "item"}
                </button>
              ) : null}
              {isDebt ? (
                <>
                  <button
                    type="button"
                    onClick={() => setHidePaidOff((v) => !v)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    {hidePaidOff ? "Show paid-off" : "Hide paid-off"}
                  </button>
                  <Link href="/snowball" className="text-xs font-medium text-brand hover:text-brand-strong">
                    Snowball →
                  </Link>
                </>
              ) : null}
            </div>
            <span className="text-right text-sm font-bold tabular-nums">
              {formatMoney(group.plannedTotal, currency)}
            </span>
            <span className="text-right text-sm font-bold tabular-nums">
              {formatMoney(modeTotal, currency)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AddItemForm({
  categoryId,
  hasDue,
  onDone,
}: {
  categoryId: string;
  hasDue: boolean;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <form
      action={(fd) =>
        start(async () => {
          await addSubcategory(fd);
          onDone();
        })
      }
      className="flex items-center gap-2 border-t border-line px-4 py-2"
    >
      <input type="hidden" name="categoryId" value={categoryId} />
      <input
        name="name"
        placeholder="New item name…"
        required
        autoFocus
        className="flex-1 rounded-md bg-background px-3 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
      {hasDue ? (
        <input
          name="dueDay"
          type="number"
          min={1}
          max={31}
          placeholder="Due"
          className="w-16 rounded-md bg-background px-2 py-1.5 text-right text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={onDone} className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-foreground">
        Cancel
      </button>
    </form>
  );
}
