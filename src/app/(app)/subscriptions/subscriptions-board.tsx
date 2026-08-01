"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import {
  deleteIrregularBill,
  deleteSubscription,
  reorderIrregularBills,
  reorderSubscriptions,
  upsertIrregularBill,
  upsertSubscription,
} from "./actions";
import type { IrregularBillRow, SubscriptionRow } from "./types";

const CYCLE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  weekly: "Weekly",
};

// Divide any billing cycle down to its monthly-equivalent cost, so the
// header total is comparable across mixed cycles.
function monthlyEquivalent(amountCents: number, cycle: string): number {
  switch (cycle) {
    case "annual":
      return amountCents / 12;
    case "quarterly":
      return amountCents / 3;
    case "weekly":
      return amountCents * (52 / 12);
    default:
      return amountCents;
  }
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

type Reorderable = { id: string };

function usePointerReorder<T extends Reorderable>(
  rows: T[],
  onReorder: (nextRows: T[]) => void,
) {
  const rowsRef = useRef(rows);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const keyUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-reorder-id]")?.dataset.reorderId ?? null;
  };

  const startDrag = (id: string) => {
    dragId.current = id;
    document.body.style.cursor = "grabbing";

    const onMove = (event: MouseEvent) => setDragOverId(keyUnder(event.clientX, event.clientY));
    const onUp = (event: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverId(null);

      const from = dragId.current;
      dragId.current = null;
      const to = keyUnder(event.clientX, event.clientY);
      if (!from || !to || from === to) return;

      const current = rowsRef.current;
      const fromIndex = current.findIndex((row) => row.id === from);
      const toIndex = current.findIndex((row) => row.id === to);
      if (fromIndex < 0 || toIndex < 0) return;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      onReorder(next);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { dragOverId, startDrag };
}

function reorderVisibleRows<T extends Reorderable>(
  allRows: T[],
  visibleRows: T[],
  nextVisibleRows: T[],
) {
  const visibleIds = new Set(visibleRows.map((row) => row.id));
  let nextIndex = 0;
  return allRows.map((row) => {
    if (!visibleIds.has(row.id)) return row;
    return nextVisibleRows[nextIndex++];
  });
}

export type CreditCardOption = { id: string; name: string };

export function SubscriptionsBoard({
  currency,
  subscriptions,
  irregularBills,
  creditCards = [],
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
}) {
  const monthlyTotal = subscriptions
    .filter((s) => s.isActive)
    .reduce((sum, s) => sum + monthlyEquivalent(s.amountCents, s.billingCycle), 0);

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-muted">
        Manage recurring services and one-off bills here. They show up in the transaction
        payee search and auto-fill their category and amount.
      </p>

      <SubscriptionsSection
        subscriptions={subscriptions}
        currency={currency}
        monthlyTotal={monthlyTotal}
        creditCards={creditCards}
      />

      <IrregularBillsSection
        irregularBills={irregularBills}
        currency={currency}
        creditCards={creditCards}
      />
    </div>
  );
}

function SubscriptionsSection({
  subscriptions: initialSubscriptions,
  currency,
  monthlyTotal,
  creditCards = [],
}: {
  subscriptions: SubscriptionRow[];
  currency: string;
  monthlyTotal: number;
  creditCards?: CreditCardOption[];
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [rows, setRows] = useState(initialSubscriptions);
  const [, startReorder] = useTransition();
  const currentYear = new Date().getFullYear();
  useEffect(() => {
    const reset = window.setTimeout(() => setRows(initialSubscriptions), 0);
    return () => window.clearTimeout(reset);
  }, [initialSubscriptions]);
  const visibleRows = rows.filter((s) => {
    if (s.isActive) return true;
    const deactivatedYear = s.updatedAt ? new Date(s.updatedAt).getFullYear() : currentYear;
    return deactivatedYear >= currentYear;
  });
  const { dragOverId, startDrag } = usePointerReorder(visibleRows, (nextVisibleRows) => {
    setRows((prev) => reorderVisibleRows(prev, visibleRows, nextVisibleRows));
    startReorder(() => reorderSubscriptions(nextVisibleRows.map((row) => row.id)));
  });

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Subscriptions</span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-muted">
          {formatMoney(Math.round(monthlyTotal), currency)}/mo
        </span>
      </button>

      {open ? (
        <div className="border-t border-line p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="w-6 px-1 py-1"></th>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1">Amount</th>
                <th className="px-2 py-1">Cycle</th>
                <th className="px-2 py-1">Next Renewal</th>
                <th className="px-2 py-1 text-center">Card</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((s) =>
                editing === s.id ? (
                  <SubscriptionFormRow
                    key={s.id}
                    row={s}
                    creditCards={creditCards}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <tr
                    key={s.id}
                    data-reorder-id={s.id}
                    className={`border-t border-line ${!s.isActive ? "opacity-50" : ""} ${dragOverId === s.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <DragHandle onStart={() => startDrag(s.id)} label={`Drag ${s.name} to reorder`} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-medium">
                      <span className={!s.isActive ? "line-through" : ""}>{s.name}</span>
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums">
                      {formatMoney(s.amountCents, currency)}
                    </td>
                    <td className="px-2 py-1 text-center text-muted">
                      {CYCLE_LABEL[s.billingCycle] ?? s.billingCycle}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {s.nextRenewalDate ? (
                        <RenewalBadge date={s.nextRenewalDate} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-left text-muted">
                      {creditCards.find((c) => c.id === s.accountId)?.name ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <RowActions
                        onEdit={() => setEditing(s.id)}
                        onDelete={async () => {
                          const fd = new FormData();
                          fd.set("id", s.id);
                          await deleteSubscription(fd);
                        }}
                      />
                    </td>
                  </tr>
                ),
              )}
              {editing === "new" ? (
                <SubscriptionFormRow
                  row={null}
                  creditCards={creditCards}
                  onDone={() => setEditing(null)}
                />
              ) : null}
            </tbody>
          </table>

          {editing == null ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
            >
              + Add subscription
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SubscriptionFormRow({
  row,
  creditCards = [],
  onDone,
}: {
  row: SubscriptionRow | null;
  creditCards?: CreditCardOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [cycle, setCycle] = useState<string>(row?.billingCycle ?? "monthly");

  return (
    <tr className="border-t border-line bg-brand-soft/10">
      <td colSpan={7} className="px-2 py-3">
        <form
          action={(fd) =>
            start(async () => {
              await upsertSubscription(fd);
              onDone();
            })
          }
          className="flex flex-wrap items-end gap-2"
        >
          {row ? <input type="hidden" name="id" value={row.id} /> : null}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Name
            <input
              name="name"
              type="text"
              required
              defaultValue={row?.name ?? ""}
              className="w-36 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Amount
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={row ? centsToDisplay(row.amountCents) : ""}
              className="w-24 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Cycle
            <select
              name="billingCycle"
              defaultValue={row?.billingCycle ?? "monthly"}
              onChange={(e) => setCycle(e.target.value)}
              className="rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {Object.entries(CYCLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <RenewalDatePicker defaultValue={row?.nextRenewalDate ?? ""} cycle={cycle} />
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={row?.isActive ?? true}
              className="h-4 w-4 rounded accent-[var(--brand)]"
            />
            Active
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Notes
            <input
              name="notes"
              type="text"
              defaultValue={row?.notes ?? ""}
              className="w-32 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          {creditCards.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Card
              <select
                name="accountId"
                defaultValue={row?.accountId ?? ""}
                className="rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">None</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto flex items-center gap-2 pb-0.5">
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function IrregularBillsSection({
  irregularBills: initialBills,
  currency,
  creditCards = [],
}: {
  irregularBills: IrregularBillRow[];
  currency: string;
  creditCards?: CreditCardOption[];
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [rows, setRows] = useState(initialBills);
  const [, startReorder] = useTransition();
  useEffect(() => {
    const reset = window.setTimeout(() => setRows(initialBills), 0);
    return () => window.clearTimeout(reset);
  }, [initialBills]);
  const { dragOverId, startDrag } = usePointerReorder(rows, (nextRows) => {
    setRows(nextRows);
    startReorder(() => reorderIrregularBills(nextRows.map((row) => row.id)));
  });

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Irregular Bills</span>
        <span className="ml-auto text-xs text-muted">Infrequent, non-monthly purchases</span>
      </button>

      {open ? (
        <div className="border-t border-line p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="w-6 px-1 py-1"></th>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1">Typical Amount</th>
                <th className="px-2 py-1">Notes</th>
                <th className="px-2 py-1 text-center">Card</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) =>
                editing === b.id ? (
                  <IrregularBillFormRow
                    key={b.id}
                    row={b}
                    creditCards={creditCards}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <tr
                    key={b.id}
                    data-reorder-id={b.id}
                    className={`border-t border-line ${dragOverId === b.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <DragHandle onStart={() => startDrag(b.id)} label={`Drag ${b.name} to reorder`} />
                    </td>
                    <td className="px-2 py-1 font-medium">{b.name}</td>
                    <td className="px-2 py-1 text-center tabular-nums">
                      {b.typicalAmountCents ? formatMoney(b.typicalAmountCents, currency) : "—"}
                    </td>
                    <td className="px-2 py-1 text-center text-muted">{b.notes || "—"}</td>
                    <td className="px-2 py-1 text-center text-muted">
                      {creditCards.find((c) => c.id === b.accountId)?.name ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <RowActions
                        onEdit={() => setEditing(b.id)}
                        onDelete={async () => {
                          const fd = new FormData();
                          fd.set("id", b.id);
                          await deleteIrregularBill(fd);
                        }}
                      />
                    </td>
                  </tr>
                ),
              )}
              {editing === "new" ? (
                <IrregularBillFormRow
                  row={null}
                  creditCards={creditCards}
                  onDone={() => setEditing(null)}
                />
              ) : null}
            </tbody>
          </table>

          {editing == null ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
            >
              + Add irregular bill
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function IrregularBillFormRow({
  row,
  creditCards = [],
  onDone,
}: {
  row: IrregularBillRow | null;
  creditCards?: CreditCardOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <tr className="border-t border-line bg-brand-soft/10">
      <td colSpan={6} className="px-2 py-3">
        <form
          action={(fd) =>
            start(async () => {
              await upsertIrregularBill(fd);
              onDone();
            })
          }
          className="flex flex-wrap items-end gap-2"
        >
          {row ? <input type="hidden" name="id" value={row.id} /> : null}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Name
            <input
              name="name"
              type="text"
              required
              defaultValue={row?.name ?? ""}
              className="w-36 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Typical Amount
            <input
              name="typicalAmount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={row ? centsToDisplay(row.typicalAmountCents) : ""}
              className="w-28 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Notes
            <input
              name="notes"
              type="text"
              defaultValue={row?.notes ?? ""}
              className="w-40 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          {creditCards.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Card
              <select
                name="accountId"
                defaultValue={row?.accountId ?? ""}
                className="rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">None</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto flex items-center gap-2 pb-0.5">
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function RenewalDatePicker({ defaultValue, cycle }: { defaultValue?: string; cycle?: string }) {
  const isMonthly = !cycle || cycle === "monthly";

  // For monthly: extract just the day from YYYY-MM-DD; for others: extract MM/DD.
  const toDisplayMonthly = (v: string) => {
    const p = v.split("-");
    return p.length === 3 ? String(parseInt(p[2])) : "";
  };
  const toDisplayFull = (v: string) => {
    const p = v.split("-");
    return p.length === 3 ? `${p[1]}/${p[2]}` : "";
  };

  // For monthly: compute next occurrence of `day` in current or next month.
  const monthlyToHidden = (day: string) => {
    const d = parseInt(day);
    if (isNaN(d) || d < 1 || d > 31) return "";
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const yr = now.getFullYear(), mo = now.getMonth();
    const cand = new Date(yr, mo, d); cand.setHours(0, 0, 0, 0);
    const use = cand < now ? new Date(yr, mo + 1, d) : cand;
    return `${use.getFullYear()}-${String(use.getMonth() + 1).padStart(2, "0")}-${String(use.getDate()).padStart(2, "0")}`;
  };
  // For non-monthly: compute next occurrence of MM/DD.
  const fullToHidden = (d: string) => {
    const [mm, dd] = d.split("/");
    const m = parseInt(mm), dy = parseInt(dd);
    if (isNaN(m) || m < 1 || m > 12 || isNaN(dy) || dy < 1 || dy > 31) return "";
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const yr = now.getFullYear();
    const cand = new Date(yr, m - 1, dy); cand.setHours(0, 0, 0, 0);
    const year = cand < now ? yr + 1 : yr;
    return `${year}-${String(m).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  };

  const [dayDisplay, setDayDisplay] = useState(toDisplayMonthly(defaultValue ?? ""));
  const [fullDisplay, setFullDisplay] = useState(toDisplayFull(defaultValue ?? ""));

  if (isMonthly) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Due Day</span>
        <input type="hidden" name="nextRenewalDate" value={monthlyToHidden(dayDisplay)} />
        <input
          type="number"
          min="1"
          max="31"
          placeholder="1–31"
          value={dayDisplay}
          onChange={(e) => setDayDisplay(e.target.value)}
          className="w-16 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">Renewal</span>
      <input type="hidden" name="nextRenewalDate" value={fullToHidden(fullDisplay)} />
      <input
        type="text"
        placeholder="MM/DD"
        value={fullDisplay}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
          setFullDisplay(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
        }}
        className="w-20 rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </div>
  );
}

function RenewalBadge({ date }: { date: string }) {
  const days = daysUntil(date);
  const upcoming = days >= 0 && days <= 30;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        upcoming
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "text-muted"
      }`}
    >
      {new Date(date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

function DragHandle({ onStart, label }: { onStart: () => void; label: string }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onStart();
      }}
      aria-label={label}
      className="flex cursor-grab items-center rounded p-1 text-muted/50 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(onDelete)}
        title="Delete"
        className="rounded-md p-1 text-negative hover:bg-negative/10 disabled:opacity-60"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
