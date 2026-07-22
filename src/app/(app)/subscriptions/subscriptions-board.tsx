"use client";

import { useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import {
  deleteIrregularBill,
  deleteSubscription,
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

export function SubscriptionsBoard({
  currency,
  subscriptions,
  irregularBills,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
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
      />

      <IrregularBillsSection
        irregularBills={irregularBills}
        currency={currency}
      />
    </div>
  );
}

function SubscriptionsSection({
  subscriptions,
  currency,
  monthlyTotal,
}: {
  subscriptions: SubscriptionRow[];
  currency: string;
  monthlyTotal: number;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);

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
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Cycle</th>
                <th className="px-2 py-2">Next Renewal</th>
                <th className="px-2 py-2">Active</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) =>
                editing === s.id ? (
                  <SubscriptionFormRow
                    key={s.id}
                    row={s}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-2 py-2 font-medium">{s.name}</td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {formatMoney(s.amountCents, currency)}
                    </td>
                    <td className="px-2 py-2 text-center text-muted">
                      {CYCLE_LABEL[s.billingCycle] ?? s.billingCycle}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {s.nextRenewalDate ? (
                        <RenewalBadge date={s.nextRenewalDate} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {s.isActive ? (
                        <span className="text-positive">Active</span>
                      ) : (
                        <span className="text-muted">Paused</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
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
  onDone,
}: {
  row: SubscriptionRow | null;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <tr className="border-t border-line bg-brand-soft/10">
      <td colSpan={6} className="px-2 py-3">
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
              className="rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {Object.entries(CYCLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Next Renewal
            <input
              name="nextRenewalDate"
              type="date"
              defaultValue={row?.nextRenewalDate ?? ""}
              className="rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
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
  irregularBills,
  currency,
}: {
  irregularBills: IrregularBillRow[];
  currency: string;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);

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
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2">Typical Amount</th>
                <th className="px-2 py-2">Notes</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {irregularBills.map((b) =>
                editing === b.id ? (
                  <IrregularBillFormRow
                    key={b.id}
                    row={b}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <tr key={b.id} className="border-t border-line">
                    <td className="px-2 py-2 font-medium">{b.name}</td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {b.typicalAmountCents ? formatMoney(b.typicalAmountCents, currency) : "—"}
                    </td>
                    <td className="px-2 py-2 text-center text-muted">{b.notes || "—"}</td>
                    <td className="px-2 py-2 text-right">
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
  onDone,
}: {
  row: IrregularBillRow | null;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <tr className="border-t border-line bg-brand-soft/10">
      <td colSpan={4} className="px-2 py-3">
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
        className="rounded-md px-2 py-1 text-xs font-semibold text-negative hover:bg-negative/10 disabled:opacity-60"
      >
        Delete
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
