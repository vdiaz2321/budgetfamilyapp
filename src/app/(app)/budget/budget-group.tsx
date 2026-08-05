"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import { addSubcategory, reorderSubcategories } from "./actions";
import { ACTUAL_LABEL, actualColorClass, BudgetRow, remainingColorClass } from "./budget-row";
import { DOT } from "./category-icons";
import type { GroupData, RowData } from "./types";

type Props = {
  group: GroupData;
  currency: string;
  monthKey: string; // YYYY-MM-01
  selectedSubId: string | null;
  onSelectRow: (row: RowData, kind: CategoryKind) => void;
  open: boolean;
  onToggle: () => void;
  compact?: boolean;
};

// Per-kind accent for the "+ Add" pill so users can tell at a glance which
// group a button belongs to when it's the only thing visible.
const ADD_ACCENT: Record<CategoryKind, string> = {
  income: "bg-positive/10 text-positive hover:bg-positive/20",
  savings: "bg-sky-500/10 text-sky-500 hover:bg-sky-500/20",
  bills: "bg-brand/10 text-brand hover:bg-brand/20",
  expenses: "bg-accent/10 text-accent hover:bg-accent/20",
  debt: "bg-negative/10 text-negative hover:bg-negative/20",
};

function usePointerReorder(_categoryId: string, rows: RowData[]) {
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const keyUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>("[data-drop-key]");
    const key = rowEl?.getAttribute("data-drop-key");
    return key && key.startsWith("subcat:") ? key.slice(7) : null;
  };

  const startDrag = (id: string) => {
    dragId.current = id;
    document.body.style.cursor = "grabbing";
    const onMove = (e: MouseEvent) => setDragOverId(keyUnder(e.clientX, e.clientY));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverId(null);
      const from = dragId.current;
      dragId.current = null;
      const to = keyUnder(e.clientX, e.clientY);
      if (!from || !to || from === to) return;
      const ids = (optimisticOrder ?? rows.map((r) => r.subId));
      const fromIdx = ids.indexOf(from);
      const toIdx = ids.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...ids];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      setOptimisticOrder(next);
      const fd = new FormData();
      fd.set("orderedIds", JSON.stringify(next));
      reorderSubcategories(fd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { dragOverId, startDrag, optimisticOrder };
}

export function BudgetGroup({
  group,
  currency,
  monthKey,
  selectedSubId,
  onSelectRow,
  open,
  onToggle,
  compact,
}: Props) {
  const [adding, setAdding] = useState(false);
  const { dragOverId, startDrag, optimisticOrder } = usePointerReorder(group.categoryId, group.rows);

  const hasDue = KINDS_WITH_DUE.includes(group.kind);
  const isDebt = group.kind === "debt";
  const isIncome = group.kind === "income";
  const actualLabel = ACTUAL_LABEL[group.kind];
  const headerActualLabel = isIncome ? "Rec'd" : actualLabel;
  const nameColumnLabel = isIncome
    ? "Category / Label"
    : group.kind === "savings"
      ? "Account / Goal"
      : group.kind === "bills"
        ? "Expense Category"
        : "Category / Label";

  const orderedRows = optimisticOrder
    ? optimisticOrder.map((id) => group.rows.find((r) => r.subId === id)).filter(Boolean) as RowData[]
    : group.rows;
  const visibleRows = orderedRows.filter((r) => {
    if (isDebt && r.debt && r.debt.balanceCents <= 0) return false;
    return true;
  });

  // Totals mirror what's rendered — paid-off debts are hidden from the list,
  // so their planned/spent must not bulk up the subtotal either.
  const visiblePlannedTotal = visibleRows.reduce((s, r) => s + r.plannedCents, 0);
  const visibleSpentTotal = visibleRows.reduce((s, r) => s + r.spentCents, 0);
  const remainingTotal = visiblePlannedTotal - visibleSpentTotal;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Consolidated header: chevron + dot + name + sources chip on the left;
          inline totals + kind-tinted "+ Add" pill (+ Snowball link for debt)
          on the right. Replaces both the old header AND the old footer. */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[group.kind]}`} />
          <span className="font-semibold">{group.name}</span>
          <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
            {visibleRows.length}
            <span className="hidden sm:inline"> {visibleRows.length === 1 ? "item" : "items"}</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums sm:gap-4">
          {/* Mobile-only: $spent / $planned instead of Left */}
          <span className="whitespace-nowrap text-xs tabular-nums sm:hidden">
            <span className={`font-semibold ${actualColorClass(group.kind, visibleSpentTotal)}`}>
              {formatMoney(visibleSpentTotal, currency)}
            </span>
            <span className="text-muted"> / {formatMoney(visiblePlannedTotal, currency)}</span>
          </span>
          <span className="hidden text-muted lg:inline">
            {headerActualLabel}:{" "}
            <span className="font-bold text-foreground">{formatMoney(visibleSpentTotal, currency)}</span>
          </span>
          <span className="hidden text-muted lg:inline">
            Plan:{" "}
            <span className="font-bold text-foreground">{formatMoney(visiblePlannedTotal, currency)}</span>
          </span>
          <span className="hidden text-muted sm:inline">
            <span className="hidden md:inline">Left: </span>
            <span className={`font-bold ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
              {formatMoney(remainingTotal, currency)}
            </span>
          </span>
          {isDebt ? (
            <Link
              href="/snowball"
              className="hidden rounded-md px-2 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand-soft md:inline-flex"
            >
              Snowball →
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => { if (!open) onToggle(); setAdding(true); }}
            aria-label="Add item"
            className={`flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-semibold transition ${ADD_ACCENT[group.kind]}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {visibleRows.length === 0 && !adding ? (
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
            <>
              {/* Mobile column label */}
              <div className="flex items-center justify-end px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted sm:hidden">
                Planned / Spent
              </div>

              {/* Column-label strip — desktop only, must line up with BudgetRow */}
              <div className={`hidden grid-cols-12 items-center gap-2 border-b border-line/60 bg-background/40 px-3 ${compact ? "py-1" : "py-1.5"} text-[10px] font-semibold uppercase tracking-wider text-muted sm:grid`}>
                <div className="col-span-5 pl-6 sm:col-span-4">{nameColumnLabel}</div>
                <div className="col-span-2 text-right">Planned</div>
                <div className="col-span-2 text-right">Remaining</div>
                <div className="col-span-2 text-right">{ACTUAL_LABEL[group.kind]}</div>
                <div className="col-span-2 text-center">Progress</div>
              </div>

              {(() => {
                const kidsRows = group.kind === "savings" ? visibleRows.filter((r) => r.isKids) : [];
                const mineRows = group.kind === "savings" ? visibleRows.filter((r) => !r.isKids) : visibleRows;
                const splitSavings = group.kind === "savings" && kidsRows.length > 0 && mineRows.length > 0;

                const subtotalRow = (label: string, rows: RowData[]) => {
                  const planned = rows.reduce((s, r) => s + r.plannedCents, 0);
                  const spent = rows.reduce((s, r) => s + r.spentCents, 0);
                  const remaining = planned - spent;
                  return (
                    <>
                      <div className="hidden grid-cols-12 items-center gap-2 border-t border-line/60 bg-brand-soft/30 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-brand sm:grid dark:bg-brand-soft/20">
                        <div className="col-span-5 pl-6 sm:col-span-4">{label}</div>
                        <div className="col-span-2 text-right tabular-nums text-foreground">{formatMoney(planned, currency)}</div>
                        <div className={`col-span-2 text-right tabular-nums ${remainingColorClass(group.kind, remaining, planned)}`}>{formatMoney(remaining, currency)}</div>
                        <div className={`col-span-2 text-right tabular-nums ${actualColorClass(group.kind, spent)}`}>{formatMoney(spent, currency)}</div>
                        <div className={`col-span-2 text-center tabular-nums ${remainingColorClass(group.kind, remaining, planned)}`}>{planned > 0 ? `${Math.min(100, Math.round((spent / planned) * 1000) / 10)}%` : "0%"}</div>
                      </div>
                      <div className="flex items-center gap-2 border-t border-line/60 bg-brand-soft/30 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-brand sm:hidden dark:bg-brand-soft/20">
                        <span className="truncate">{label}</span>
                        <span className="ml-auto text-xs tabular-nums">
                          <span className="text-muted">{formatMoney(planned, currency)} / </span>
                          <span className={`font-semibold ${actualColorClass(group.kind, spent)}`}>{formatMoney(spent, currency)}</span>
                        </span>
                      </div>
                    </>
                  );
                };

                const renderRows = (rows: RowData[], offset: number) => (
                  <ul className="divide-y divide-line/40">
                    {rows.map((row, i) => (
                      <BudgetRow
                        key={row.subId}
                        row={row}
                        kind={group.kind}
                        currency={currency}
                        monthKey={monthKey}
                        selected={row.subId === selectedSubId}
                        isEven={(offset + i) % 2 === 1}
                        isDragOver={dragOverId === row.subId}
                        compact={compact}
                        onSelect={() => onSelectRow(row, group.kind)}
                        onDragStart={() => startDrag(row.subId)}
                      />
                    ))}
                  </ul>
                );

                if (!splitSavings) return renderRows(visibleRows, 0);
                return (
                  <>
                    {subtotalRow("My Savings", mineRows)}
                    {renderRows(mineRows, 0)}
                    {subtotalRow("Kids Funding", kidsRows)}
                    {renderRows(kidsRows, mineRows.length)}
                  </>
                );
              })()}
              {/* Mobile subtotal: label + spent/planned + remaining pill */}
              <div className="flex items-center gap-2 border-t border-line bg-background/50 px-3 py-2 sm:hidden">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <path d="M8 7h8M8 11h8M8 15h8M8 19h5" />
                  </svg>
                  <span className="truncate">Subtotal</span>
                </div>
                <div className="ml-auto text-right text-xs tabular-nums">
                  <span className="text-muted">{formatMoney(visiblePlannedTotal, currency)} / </span>
                  <span className={`font-semibold ${actualColorClass(group.kind, visibleSpentTotal)}`}>
                    {formatMoney(visibleSpentTotal, currency)}
                  </span>
                  <span className={`ml-2 font-semibold ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
                    ({formatMoney(remainingTotal, currency)})
                  </span>
                </div>
              </div>

              {/* Desktop subtotal: 12-col grid matching row layout */}
              <div className={`hidden grid-cols-12 items-center gap-2 border-t border-line bg-background/50 px-3 sm:grid ${compact ? "py-2" : "py-2.5"}`}>
                <div className="col-span-5 flex items-center gap-2 pl-6 text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-4">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 19h2M12 19h2M16 19h0" />
                  </svg>
                  <span>{group.name} subtotal</span>
                </div>
                <div className="col-span-2 text-right text-xs font-semibold tabular-nums text-foreground">
                  {formatMoney(visiblePlannedTotal, currency)}
                </div>
                <div className={`col-span-2 text-right text-xs font-semibold tabular-nums ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
                  {formatMoney(remainingTotal, currency)}
                </div>
                <div className={`col-span-2 text-right text-xs font-semibold tabular-nums ${actualColorClass(group.kind, visibleSpentTotal)}`}>
                  {formatMoney(visibleSpentTotal, currency)}
                </div>
                <div className={`col-span-2 text-center text-xs font-bold tabular-nums ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
                  {visiblePlannedTotal > 0 ? `${Math.min(100, Math.round((visibleSpentTotal / visiblePlannedTotal) * 1000) / 10)}%` : "0%"}
                </div>
              </div>
            </>
          )}

          {adding ? (
            <AddItemForm
              categoryId={group.categoryId}
              hasDue={hasDue}
              onDone={() => setAdding(false)}
            />
          ) : null}
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
