"use client";

import { useRef, useState, useTransition } from "react";
import { centsToDisplay } from "@/lib/money";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { addTransaction, updateTransaction } from "./actions";
import type { AccountOption, SubOption, TxData } from "./types";

// Header title (verbose) vs. button label (short), plus tab labels.
const KIND_TITLE: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bill",
  expenses: "Expense",
  debt: "Debt Payment",
};
const KIND_SHORT: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bill",
  expenses: "Expense",
  debt: "Debt",
};
const KIND_TAB: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};
const PAYEE_PLACEHOLDER: Record<CategoryKind, string> = {
  income: "Where did this money come from?",
  savings: "Which fund or bank?",
  bills: "Who did you pay?",
  expenses: "Where did you spend this money?",
  debt: "Who did you pay?",
};

// Colors that shift with the selected category.
const HEADER_TINT: Record<CategoryKind, string> = {
  income: "bg-emerald-100 dark:bg-emerald-950",
  savings: "bg-sky-100 dark:bg-sky-950",
  bills: "bg-indigo-100 dark:bg-indigo-950",
  expenses: "bg-amber-100 dark:bg-amber-950",
  debt: "bg-rose-100 dark:bg-rose-950",
};
const BTN_COLOR: Record<CategoryKind, string> = {
  income: "bg-emerald-600 hover:bg-emerald-700",
  savings: "bg-sky-600 hover:bg-sky-700",
  bills: "bg-indigo-600 hover:bg-indigo-700",
  expenses: "bg-amber-500 hover:bg-amber-600",
  debt: "bg-rose-600 hover:bg-rose-700",
};
const TAB_ACTIVE_TEXT: Record<CategoryKind, string> = {
  income: "text-emerald-600 dark:text-emerald-400",
  savings: "text-sky-600 dark:text-sky-400",
  bills: "text-indigo-600 dark:text-indigo-400",
  expenses: "text-amber-600 dark:text-amber-400",
  debt: "text-rose-600 dark:text-rose-400",
};

export function TransactionModal({
  editTx,
  monthKey,
  firstOfMonth,
  subOptions,
  accountOptions,
  onClose,
}: {
  editTx: TxData | null;
  monthKey: string;
  firstOfMonth: string;
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const isEdit = editTx != null;
  const [txType, setTxType] = useState<CategoryKind>(editTx?.kind ?? "expenses");
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = editTx?.date ?? (today.startsWith(monthKey) ? today : firstOfMonth);
  const options = subOptions.filter((s) => s.kind === txType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />

      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* Header — tinted by category */}
        <div className={`relative px-6 py-4 text-center transition-colors ${HEADER_TINT[txType]}`}>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            {isEdit ? "Edit" : "Add"} {KIND_TITLE[txType]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {/* Five type tabs */}
          <div className="grid grid-cols-5 rounded-xl bg-background p-1 ring-1 ring-line">
            {CATEGORY_KINDS.map(({ kind }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setTxType(kind)}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  txType === kind
                    ? `bg-surface shadow-sm ring-1 ring-line ${TAB_ACTIVE_TEXT[kind]}`
                    : "text-muted hover:text-foreground"
                }`}
              >
                {KIND_TAB[kind]}
              </button>
            ))}
          </div>

          <form
            ref={formRef}
            action={(fd) =>
              start(async () => {
                if (isEdit) {
                  await updateTransaction(fd);
                  onClose();
                } else {
                  await addTransaction(fd);
                  if (fd.get("createAnother") === "on") {
                    formRef.current?.reset();
                  } else {
                    onClose();
                  }
                }
              })
            }
            className="mt-4 space-y-4"
          >
            {isEdit ? <input type="hidden" name="id" value={editTx.id} /> : null}

            {/* Amount */}
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted">$</span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                autoFocus
                defaultValue={editTx ? centsToDisplay(editTx.amountCents) : ""}
                className="w-full rounded-xl bg-background py-3 pl-9 pr-4 text-lg font-semibold tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {/* Date + payee */}
            <div className="grid grid-cols-[10rem_1fr] gap-3">
              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className="rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <input
                name="payee"
                type="text"
                placeholder={PAYEE_PLACEHOLDER[txType]}
                defaultValue={editTx?.payee ?? ""}
                className="min-w-0 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {/* Account */}
            <select
              name="accountId"
              defaultValue={editTx?.accountId ?? ""}
              className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Choose Account (optional)</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            {/* Budget item */}
            <div>
              <p className="mb-1.5 text-sm font-bold">Budget Items</p>
              <select
                key={txType}
                name="subcategoryId"
                required
                defaultValue={editTx && editTx.kind === txType ? editTx.subId ?? "" : ""}
                className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="" disabled>Choose Budget Item…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              {options.length === 0 ? (
                <p className="mt-1 text-xs text-muted">
                  No {KIND_TAB[txType]} items yet — add one on the budget first.
                </p>
              ) : null}
            </div>

            {/* Note */}
            <input
              name="memo"
              type="text"
              placeholder="Add a note (optional)"
              defaultValue={editTx?.memo ?? ""}
              className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 pt-2">
              {isEdit ? (
                <span />
              ) : (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="createAnother" className="h-4 w-4 rounded accent-[var(--brand)]" />
                  Create another
                </label>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-brand hover:text-brand-strong">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 ${BTN_COLOR[txType]}`}
                >
                  {pending ? "Saving…" : isEdit ? "Save" : `Add ${KIND_SHORT[txType]}`}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
