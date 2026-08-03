"use client";

import { useRef, useState, useTransition } from "react";
import { centsToDisplay } from "@/lib/money";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { addTransaction, updateTransaction, deleteTransaction, deletePayee } from "./actions";
import type { AccountOption, BucketsByAccount, PayeeLineItem, SubOption, TxData } from "./types";

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
  debt: "Payment",
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
  bucketsByAccount = {},
  payeeOptions = [],
  payeeLineItems = [],
  initialKind,
  initialSubId,
  onClose,
}: {
  editTx: TxData | null;
  monthKey: string;
  firstOfMonth: string;
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  // Buckets available for direct attribution when the selected account has
  // them (currently only investment accounts on Fidelity/Crypto). Keyed by
  // account_id. Empty/omitted = no bucket picker ever shows.
  bucketsByAccount?: BucketsByAccount;
  // Previously-used payees (id + name), offered as suggestions below the
  // payee field as you type — not a picker, just a memory aid.
  payeeOptions?: { id: string; name: string }[];
  // Managed subscriptions/irregular bills — selecting one of these from the
  // payee suggestions auto-fills its linked budget item (and, for
  // subscriptions, its amount) instead of requiring manual mapping.
  payeeLineItems?: PayeeLineItem[];
  // Preselects the type + budget item when opened from an item's own panel
  // (e.g. its "+ Add transaction" button) instead of the general Log tab.
  initialKind?: CategoryKind;
  initialSubId?: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const isEdit = editTx != null;
  const [txType, setTxType] = useState<CategoryKind>(editTx?.kind ?? initialKind ?? "expenses");
  const [selectedAccountId, setSelectedAccountId] = useState<string>(editTx?.accountId ?? "");
  const availableBuckets = bucketsByAccount[selectedAccountId] ?? [];
  const [selectedBucketId, setSelectedBucketId] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Set when a payee suggestion matching a managed subscription/irregular
  // bill is selected — forces the Budget Item field to remount with the
  // matched subcategory preselected (see the `key` below).
  const [autoFillSubId, setAutoFillSubId] = useState<string | null>(null);

  function handlePayeeMatch(item: PayeeLineItem) {
    if (item.subcategoryId) {
      const kind = subOptions.find((s) => s.id === item.subcategoryId)?.kind;
      if (kind) setTxType(kind);
      setAutoFillSubId(item.subcategoryId);
    }
    if (item.amountCents != null && amountRef.current) {
      amountRef.current.value = centsToDisplay(item.amountCents);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = editTx?.date ?? (today.startsWith(monthKey) ? today : firstOfMonth);
  const options = subOptions.filter((s) => s.kind === txType);

  const allowedGroups = txType === "income" ? new Set(["Banking"]) : new Set(["Banking", "Credit Cards"]);
  const filteredAccounts = accountOptions.filter((a) => allowedGroups.has(a.group ?? "Other"));
  const accountGroups: string[] = [];
  const accountByGroup = new Map<string, typeof accountOptions>();
  for (const a of filteredAccounts) {
    const g = a.group ?? "Other";
    if (!accountByGroup.has(g)) { accountGroups.push(g); accountByGroup.set(g, []); }
    accountByGroup.get(g)!.push(a);
  }

  function handleFormAction(fd: FormData) {
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
    });
  }

  return (
    <div className="flex max-h-[calc(100vh-6rem)] w-full flex-col overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:max-h-[85vh] sm:rounded-2xl dark:ring-white/10">
      {/* Header — tinted by category */}
      <div className={"relative px-5 py-3.5 text-center transition-colors " + HEADER_TINT[txType]}>
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

      <div className="overflow-y-auto px-5 py-4">
        {/* Five type tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
          {CATEGORY_KINDS.map(({ kind }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTxType(kind)}
              className={
                "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition " +
                (txType === kind
                  ? "bg-surface shadow-sm ring-1 ring-line " + TAB_ACTIVE_TEXT[kind]
                  : "text-muted hover:text-foreground")
              }
            >
              {KIND_TAB[kind]}
            </button>
          ))}
        </div>

        <form ref={formRef} action={handleFormAction} className="mt-4 space-y-4">
          {isEdit ? <input type="hidden" name="id" value={editTx.id} /> : null}

          {/* Row 1: Amount | Date */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted">$</span>
              <input
                ref={amountRef}
                name="amount"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                required
                placeholder="0.00"
                autoFocus
                defaultValue={editTx ? centsToDisplay(editTx.amountCents) : ""}
                className="w-full rounded-xl bg-background py-2.5 pl-7 pr-2 text-base font-semibold tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <input
              name="date"
              type="date"
              required
              defaultValue={defaultDate}
              className="flex-1 rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
            />
          </div>

          {/* Payee */}
          <PayeeField
            placeholder={PAYEE_PLACEHOLDER[txType]}
            defaultValue={editTx?.payee ?? ""}
            payeeOptions={payeeOptions}
            payeeLineItems={payeeLineItems}
            onMatch={handlePayeeMatch}
          />

          {/* Account | Budget Items */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <select
                name="accountId"
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value);
                  setSelectedBucketId("");
                }}
                className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
              >
                <option value="">
                  {txType === "income"
                    ? "Deposit to account"
                    : txType === "debt"
                      ? "Paid from account"
                      : "Charged to / paid from account"}
                </option>
                {accountGroups.map((g) => (
                  <optgroup key={g} label={g}>
                    {accountByGroup.get(g)!.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {txType === "debt" ? (
                <p className="mt-1 px-1 text-[11px] text-muted">
                  Paying off a credit card? Use <span className="font-semibold">Pay Card</span> on the Accounts page. It debits your bank and clears the card{"'"}s Owed in one step.
                </p>
              ) : null}
            </div>
            <BudgetItemField
              key={txType + "-" + (autoFillSubId ?? "")}
              kindLabel={KIND_TAB[txType]}
              options={options}
              showLabel={false}
              defaultValue={
                autoFillSubId ??
                (editTx && editTx.kind === txType
                  ? editTx.subId ?? ""
                  : !isEdit && initialKind === txType
                    ? initialSubId ?? ""
                    : "")
              }
              defaultIsWithdrawal={editTx?.isWithdrawal ?? false}
            />
          </div>

          {/* Bucket picker */}
          {availableBuckets.length > 0 ? (
            <select
              name="bucketId"
              value={selectedBucketId}
              onChange={(e) => setSelectedBucketId(e.target.value)}
              className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
            >
              <option value="">Bucket (optional)</option>
              {availableBuckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : null}

          {/* Note */}
          <input
            name="memo"
            type="text"
            placeholder="Add a note (optional)"
            defaultValue={editTx?.memo ?? ""}
            className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
          />

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            {isEdit ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const fd = new FormData();
                    fd.set("id", editTx.id);
                    await deleteTransaction(fd);
                    onClose();
                  })
                }
                className="rounded-lg px-3 py-2 text-sm font-bold text-negative transition hover:bg-negative/10 disabled:opacity-60"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-brand transition hover:bg-brand-soft hover:text-brand-strong">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={"rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 " + BTN_COLOR[txType]}
              >
                {pending ? "Saving..." : isEdit ? "Save" : "Add " + KIND_SHORT[txType]}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// A plain text input with a self-positioned suggestion list. Supports:
// - Arrow key navigation (ArrowDown/ArrowUp) + Enter to select
// - × button on plain payee suggestions to delete them from the saved list
// `onMouseDown` + `preventDefault` keeps focus during click so onBlur
// doesn't close the list before the click fires.
function PayeeField({
  placeholder,
  defaultValue,
  payeeOptions,
  payeeLineItems = [],
  onMatch,
}: {
  placeholder: string;
  defaultValue: string;
  payeeOptions?: { id: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
  onMatch?: (item: PayeeLineItem) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, startDel] = useTransition();

  const q = value.trim().toLowerCase();
  const lineItemNames = new Set(payeeLineItems.map((i) => i.name.toLowerCase()));
  const lineMatches = q
    ? payeeLineItems.filter((i) => i.name.toLowerCase() !== q && i.name.toLowerCase().includes(q))
    : payeeLineItems;
  const plainOptions = (payeeOptions ?? []).filter((p) => !deletedIds.has(p.id));
  const plainMatches = (
    q
      ? plainOptions.filter((p) => p.name.toLowerCase() !== q && p.name.toLowerCase().includes(q))
      : plainOptions
  ).filter((p) => !lineItemNames.has(p.name.toLowerCase()));
  const lineSlice = lineMatches.slice(0, 6);
  const plainSlice = plainMatches.slice(0, 6 - Math.min(6, lineSlice.length));
  // Unified list: line items first, then plain payees
  type Entry = PayeeLineItem | { id: string; name: string };
  const matches: Entry[] = [...lineSlice, ...plainSlice];

  function select(name: string) {
    setValue(name);
    setOpen(false);
    setHighlighted(-1);
    const item = payeeLineItems.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (item) onMatch?.(item);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? matches.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      select(matches[highlighted].name);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <div className="relative">
      <input
        name="payee"
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); setHighlighted(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setHighlighted(-1); }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
      />
      {open && matches.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl bg-surface py-1 shadow-lg ring-1 ring-line">
          {matches.map((entry, idx) => {
            const isLineItem = "kind" in entry;
            const isHighlighted = idx === highlighted;
            return (
              <li key={entry.name} className={`group flex items-center ${isHighlighted ? "bg-brand-soft ring-1 ring-inset ring-brand/20" : "hover:bg-brand-soft/40"}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(entry.name)}
                  className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="flex-1 truncate">{entry.name}</span>
                  {isLineItem ? (
                    <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                      {entry.kind === "subscription" ? "Sub" : "Irregular"}
                    </span>
                  ) : null}
                </button>
                {!isLineItem ? (
                  <button
                    type="button"
                    title="Remove suggestion"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setDeletedIds((s) => new Set([...s, entry.id]));
                      startDel(() => deletePayee(entry.id));
                    }}
                    className="mr-2 shrink-0 rounded px-1 py-0.5 text-sm font-bold text-muted opacity-0 transition group-hover:opacity-100 hover:text-negative"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// Keyed by txType from the parent (remounts on tab switch, resetting local
// state) so a stale selection from another tab can't leak in. Shows the
// withdrawal toggle only when the chosen item is a Savings item linked to a
// bucket in Accounts.
function BudgetItemField({
  kindLabel,
  options,
  defaultValue,
  defaultIsWithdrawal,
  showLabel = true,
}: {
  kindLabel: string;
  options: SubOption[];
  defaultValue: string;
  defaultIsWithdrawal: boolean;
  showLabel?: boolean;
}) {
  const [subId, setSubId] = useState(defaultValue);
  const linkedBucketId = options.find((o) => o.id === subId)?.linkedBucketId;

  return (
    <div>
      {showLabel ? <p className="mb-1.5 text-sm font-bold">Budget Items</p> : null}
      <select
        name="subcategoryId"
        required
        value={subId}
        onChange={(e) => setSubId(e.target.value)}
        className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
      >
        <option value="" disabled>Choose Budget Item…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {options.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          No {kindLabel} items yet — add one on the budget first.
        </p>
      ) : null}
      {linkedBucketId ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            name="isWithdrawal"
            defaultChecked={defaultIsWithdrawal}
            className="h-4 w-4 rounded accent-[var(--brand)]"
          />
          This is a withdrawal — money coming out of the linked bucket (e.g. using savings for a
          purchase)
        </label>
      ) : null}
    </div>
  );
}
