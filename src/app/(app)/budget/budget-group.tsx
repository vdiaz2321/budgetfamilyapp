"use client";

import { useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import {
  addSubcategory,
  deleteCategoryGroup,
  moveCategoryGroup,
  renameCategoryGroup,
  reorderSubcategories,
} from "./actions";
import { ModalShell } from "@/components/modal-shell";
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
  detailsExpanded?: boolean;
  onFilter?: (kind: CategoryKind) => void;
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

function progressLabel(kind: CategoryKind, spent: number, planned: number): string {
  if (planned <= 0) return spent > 0 && (kind === "bills" || kind === "expenses") ? "-100%" : "0%";
  const raw = (spent / planned) * 100;
  return spent > planned && (kind === "bills" || kind === "expenses")
    ? `-${Math.floor(raw)}%`
    : `${Math.min(100, Math.round(raw * 10) / 10)}%`;
}

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
  detailsExpanded,
  onFilter,
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
  const subtotalOverspent = (group.kind === "bills" || group.kind === "expenses") && remainingTotal < 0;

  return (
    <section className="relative -mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-xl dark:ring-white/10">
      {/* Consolidated header: chevron + dot + name + sources chip on the left;
          inline totals + kind-tinted "+ Add" pill (+ Snowball link for debt)
          on the right. Replaces both the old header AND the old footer. */}
      {/* Mobile header — flex layout */}
      <div
        className="flex cursor-pointer items-center gap-2 bg-surface/90 px-4 py-2.5 dark:bg-brand-soft/20 sm:hidden"
        onClick={onToggle}
      >
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
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
        {!group.isSystem ? <CategoryGroupMenu group={group} /> : null}
        <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums">
          <span className="whitespace-nowrap text-xs tabular-nums">
            <span className="text-muted">{formatMoney(visiblePlannedTotal, currency)} / </span>
            <span className={`font-semibold ${actualColorClass(group.kind, visibleSpentTotal)}`}>
              {formatMoney(visibleSpentTotal, currency)}
            </span>
          </span>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); if (!open) onToggle(); setAdding(true); }}
            aria-label="Add item"
            className={`flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-semibold transition ${ADD_ACCENT[group.kind]}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Desktop header — 12-col grid aligned with rows below */}
      <div
        className="group/header hidden cursor-pointer grid-cols-12 items-center gap-2 bg-surface/90 px-3 py-2.5 dark:bg-brand-soft/20 sm:grid"
        onClick={onToggle}
      >
        <div className="col-span-5 flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggle(); }}
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
              <span className="sm:inline"> {visibleRows.length === 1 ? "item" : "items"}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); if (!open) onToggle(); setAdding(true); }}
            aria-label={`Add ${group.name} item`}
            title={`Add ${group.name} item`}
            className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-xs font-bold opacity-0 transition-opacity group-hover/header:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${ADD_ACCENT[group.kind]}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {!group.isSystem ? <CategoryGroupMenu group={group} /> : null}
        </div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggle(); onFilter?.(group.kind); }}
          title={`Show ${group.name} transactions`}
          disabled={!onFilter}
          className="col-span-7 grid grid-cols-3 items-start gap-2 rounded-md px-2 py-1 text-[11px] tabular-nums text-muted enabled:hover:bg-brand-soft enabled:cursor-pointer disabled:cursor-default"
        >
          <span className="min-w-0 text-center leading-tight">
            <span className="block text-xs font-semibold text-muted">Plan</span>
            <span className="block text-sm font-semibold text-foreground">{formatMoney(visiblePlannedTotal, currency)}</span>
          </span>
          <span className="min-w-0 text-center leading-tight">
            <span className="block text-xs font-semibold text-muted">{headerActualLabel}</span>
            <span className={`block text-sm font-semibold ${actualColorClass(group.kind, visibleSpentTotal)}`}>
              {formatMoney(visibleSpentTotal, currency)}
            </span>
          </span>
          <span className="min-w-0 text-center leading-tight">
            <span className="block text-xs font-semibold text-muted">Left</span>
            <span className={`block text-sm font-semibold ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
              {formatMoney(remainingTotal, currency)}
            </span>
          </span>
        </button>
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
              {/* Mobile column label — actual noun follows the kind (Spent/Saved/Received/Paid) */}
              <div className="flex items-center justify-end px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted sm:hidden">
                Planned / {ACTUAL_LABEL[group.kind]} &middot; Left
              </div>

              {/* Column-label strip — desktop only, must line up with BudgetRow */}
              <div className={`hidden grid-cols-12 items-center gap-2 border-b border-line/60 bg-background/40 px-3 ${compact ? "py-1.5" : "py-2"} text-[11px] font-bold uppercase tracking-wide text-muted sm:grid`}>
                <div className="col-span-5 pl-6 sm:col-span-4">{nameColumnLabel}</div>
                <div className="col-span-2 text-right">Planned</div>
                <div className="col-span-2 text-right">{ACTUAL_LABEL[group.kind]}</div>
                <div className="col-span-2 text-right">Remaining</div>
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
                      <div className="hidden grid-cols-12 items-center gap-2 border-t border-line/60 bg-brand-soft/30 px-3 py-2 text-[13px] font-bold uppercase tracking-wide text-brand sm:grid dark:bg-brand-soft/20">
                        <div className="col-span-5 pl-6 sm:col-span-4">{label}</div>
                        <div className="col-span-2 text-right tabular-nums text-foreground">{formatMoney(planned, currency)}</div>
                        <div className={`col-span-2 text-right tabular-nums ${actualColorClass(group.kind, spent)}`}>{formatMoney(spent, currency)}</div>
                        <div className={`col-span-2 text-right tabular-nums ${remainingColorClass(group.kind, remaining, planned)}`}>{formatMoney(remaining, currency)}</div>
                        <div className={`col-span-2 text-center tabular-nums ${remainingColorClass(group.kind, remaining, planned)}`}>{progressLabel(group.kind, spent, planned)}</div>
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
                        detailsExpanded={detailsExpanded}
                        onSelect={() => onSelectRow(row, group.kind)}
                        onDragStart={() => startDrag(row.subId)}
                      />
                    ))}
                  </ul>
                );

                if (!splitSavings) return renderRows(visibleRows, 0);
                return (
                  <>
                    {subtotalRow("My Savings/Investments", mineRows)}
                    {renderRows(mineRows, 0)}
                    {subtotalRow("Kids Funding", kidsRows)}
                    {renderRows(kidsRows, mineRows.length)}
                  </>
                );
              })()}
              {/* Mobile subtotal: keep the planned/spent pair, then name the
                  remaining figure explicitly so its meaning is unambiguous. */}
              <div className="flex items-center gap-2 border-t border-line bg-background/50 px-3 py-2 sm:hidden">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <path d="M8 7h8M8 11h8M8 15h8M8 19h5" />
                  </svg>
                  <span className="truncate">Subtotal</span>
                </div>
                <div className="ml-auto text-right tabular-nums">
                  <div className="text-xs">
                    <span className="text-muted">{formatMoney(visiblePlannedTotal, currency)} / </span>
                    <span className={`font-semibold ${actualColorClass(group.kind, visibleSpentTotal)}`}>
                      {formatMoney(visibleSpentTotal, currency)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px]">
                    <span className="font-medium text-muted">Remaining: </span>
                    <span className={`inline-flex font-semibold ${subtotalOverspent ? "rounded-full bg-negative/15 px-1.5 py-0.5 text-foreground ring-1 ring-negative/15" : remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
                      {formatMoney(remainingTotal, currency)}
                    </span>
                  </div>
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
                <div className={`col-span-2 text-right text-xs font-semibold tabular-nums ${actualColorClass(group.kind, visibleSpentTotal)}`}>
                  {formatMoney(visibleSpentTotal, currency)}
                </div>
                <div className="col-span-2 flex justify-end text-right text-xs font-semibold tabular-nums">
                  {subtotalOverspent ? (
                    <span className="inline-flex rounded-full bg-negative/15 px-2 py-0.5 text-foreground ring-1 ring-negative/15">
                      {formatMoney(remainingTotal, currency)}
                    </span>
                  ) : (
                    <span className={remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}>
                      {formatMoney(remainingTotal, currency)}
                    </span>
                  )}
                </div>
                <div className={`col-span-2 text-center text-xs font-bold tabular-nums ${remainingColorClass(group.kind, remainingTotal, visiblePlannedTotal)}`}>
                  {progressLabel(group.kind, visibleSpentTotal, visiblePlannedTotal)}
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

function CategoryGroupMenu({ group }: { group: GroupData }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        aria-label={`Manage ${group.name}`}
        title={`Manage ${group.name}`}
        className="rounded-md px-1.5 py-0.5 text-sm font-bold leading-none text-muted hover:bg-surface/70 hover:text-foreground"
      >
        ···
      </button>
      {open ? (
        <ModalShell title={`Manage ${group.name}`} onClose={() => setOpen(false)}>
          <div className="space-y-4 p-5">
            <form
              action={(formData) =>
                start(async () => {
                  setError(null);
                  const result = await renameCategoryGroup(formData);
                  if (result.error) setError(result.error);
                })
              }
              className="space-y-2"
            >
              <input type="hidden" name="id" value={group.categoryId} />
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold">Group name</span>
                <div className="flex gap-2">
                  <input
                    name="name"
                    required
                    defaultValue={group.name}
                    className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    Save
                  </button>
                </div>
              </label>
            </form>

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <span className="mr-auto text-sm font-semibold">Position</span>
              {(["up", "down"] as const).map((direction) => (
                <form key={direction} action={(formData) => start(() => moveCategoryGroup(formData))}>
                  <input type="hidden" name="id" value={group.categoryId} />
                  <input type="hidden" name="direction" value={direction} />
                  <button type="submit" disabled={pending} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-60">
                    Move {direction}
                  </button>
                </form>
              ))}
            </div>

            <form
              action={(formData) =>
                start(async () => {
                  setError(null);
                  const result = await deleteCategoryGroup(formData);
                  if (result.error) setError(result.error);
                  else setOpen(false);
                })
              }
              className="flex items-center gap-3 border-t border-line pt-4"
            >
              <input type="hidden" name="id" value={group.categoryId} />
              <p className="mr-auto text-xs text-muted">
                {group.rows.length === 0 ? "Empty groups can be deleted." : `Move or delete ${group.rows.length} item${group.rows.length === 1 ? "" : "s"} first.`}
              </p>
              <button type="submit" disabled={pending || group.rows.length > 0} className="rounded-lg px-3 py-2 text-sm font-semibold text-negative hover:bg-negative/10 disabled:cursor-not-allowed disabled:opacity-40">
                Delete group
              </button>
            </form>

            {error ? <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p> : null}
          </div>
        </ModalShell>
      ) : null}
    </>
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
