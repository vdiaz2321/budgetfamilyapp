"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import { addSubcategory } from "./actions";
import { BudgetRow, remainingColorClass } from "./budget-row";
import { DOT } from "./category-icons";
import type { GroupData, RowData } from "./types";

type Props = {
  group: GroupData;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selectedSubId: string | null;
  onSelectRow: (row: RowData, kind: CategoryKind) => void;
  // Open/collapsed is lifted to the board so one button can expand/collapse all.
  open: boolean;
  onToggle: () => void;
  // The debt currently getting the snowball's extra payment — badged
  // "next to pay" on its row. Only meaningful for the debt group.
  snowballFocusSubId: string | null;
};

export function BudgetGroup({
  group,
  currency,
  monthKey,
  selectedSubId,
  onSelectRow,
  open,
  onToggle,
  snowballFocusSubId,
}: Props) {
  const [adding, setAdding] = useState(false);

  const hasDue = KINDS_WITH_DUE.includes(group.kind);
  const isDebt = group.kind === "debt";
  const isIncome = group.kind === "income";
  // Income "receives" money; everything else "spends" it.
  const actualLabel = isIncome ? "Received" : "Spent";

  // Paid-off debts always drop out of the Budget page — they still live on
  // the Snowball page (through the end of the year they were paid off).
  const visibleRows = group.rows.filter((r) => {
    if (isDebt && r.debt && r.debt.balanceCents <= 0) return false;
    return true;
  });

  const remainingTotal = group.plannedTotal - group.spentTotal;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[group.kind]}`} />
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

        {!open ? (
          <div className="flex items-center gap-3 text-sm font-bold tabular-nums">
            <span className="text-muted">{formatMoney(group.plannedTotal, currency)}</span>
            <span>{formatMoney(group.spentTotal, currency)}</span>
            <span className={remainingColorClass(group.kind, remainingTotal, group.plannedTotal)}>
              {formatMoney(remainingTotal, currency)}
            </span>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-line">
          {visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
              <svg
                width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                className="text-muted/60" aria-hidden
              >
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              <p className="text-sm font-medium text-foreground">No {group.name.toLowerCase()} yet</p>
              <p className="text-sm text-muted">Track your first item to see it here.</p>
            </div>
          ) : (
            <ul>
              {visibleRows.map((row) => (
                <BudgetRow
                  key={row.subId}
                  row={row}
                  kind={group.kind}
                  currency={currency}
                  monthKey={monthKey}
                  selected={row.subId === selectedSubId}
                  isSnowballFocus={
                    isDebt && row.subId === snowballFocusSubId && (row.debt?.balanceCents ?? 0) > 0
                  }
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
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
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
                <Link href="/snowball" className="text-xs font-medium text-brand hover:text-brand-strong">
                  Snowball →
                </Link>
              ) : null}
            </div>
            <div className="flex items-center gap-3 text-xs tabular-nums">
              <span className="text-muted">
                <span className="font-bold">{formatMoney(group.plannedTotal, currency)}</span> planned
              </span>
              <span className="text-foreground">
                <span className="font-bold">{formatMoney(group.spentTotal, currency)}</span>{" "}
                <span className="text-muted">{actualLabel.toLowerCase()}</span>
              </span>
              <span className={remainingColorClass(group.kind, remainingTotal, group.plannedTotal)}>
                <span className="font-bold">{formatMoney(remainingTotal, currency)}</span>{" "}
                <span className="text-muted">remaining</span>
              </span>
            </div>
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
