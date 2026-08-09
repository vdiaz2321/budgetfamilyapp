"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay } from "@/lib/money";
import { Fragment } from "react";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { addTransaction, updateTransaction, deleteTransaction, deletePayee, toggleCleared } from "./actions";
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
  income: "Merchant",
  savings: "Merchant",
  bills: "Merchant",
  expenses: "Merchant",
  debt: "Merchant",
};

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

type SplitEntry = { subId: string; amountCents: number };

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
  bucketsByAccount?: BucketsByAccount;
  payeeOptions?: { id: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
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
  const [autoFillSubId, setAutoFillSubId] = useState<string | null>(null);

  // Split state — for NEW transactions only. Edit mode keeps the existing single-item flow.
  const [totalCents, setTotalCents] = useState(editTx?.amountCents ?? 0);
  const [splits, setSplits] = useState<SplitEntry[]>(() =>
    initialSubId ? [{ subId: initialSubId, amountCents: editTx?.amountCents ?? 0 }] : []
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [cleared, setCleared] = useState(false);

  const splitTotal = splits.reduce((s, sp) => s + sp.amountCents, 0);
  const leftToSplit = totalCents - splitTotal;

  // When exactly one item is selected, auto-fill it with the full total so the
  // user doesn't have to re-enter it after changing the amount or removing splits.
  useEffect(() => {
    if (isEdit) return;
    if (splits.length !== 1) return;
    if (splits[0].amountCents === totalCents) return;
    // Keep the single selected item synchronized with the entered total.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplits([{ subId: splits[0].subId, amountCents: totalCents }]);
  }, [isEdit, splits, totalCents]);

  function handlePayeeMatch(item: PayeeLineItem) {
    if (item.subcategoryId) {
      const kind = subOptions.find((s) => s.id === item.subcategoryId)?.kind;
      if (kind) setTxType(kind);
      setAutoFillSubId(item.subcategoryId);
      // Also seed the splits if not yet set
      if (!isEdit) {
        setSplits([{ subId: item.subcategoryId, amountCents: item.amountCents ?? totalCents }]);
      }
    }
    if (item.amountCents != null && amountRef.current) {
      amountRef.current.value = centsToDisplay(item.amountCents);
      setTotalCents(item.amountCents);
    }
  }

  // When txType changes, clear splits (stale subcategories no longer valid).
  function handleTypeChange(kind: CategoryKind) {
    setTxType(kind);
    if (!isEdit) setSplits([]);
  }

  function handlePickerConfirm(selectedIds: string[]) {
    setPickerOpen(false);
    if (!isEdit) {
      setSplits((prev) => {
        const kept = prev.filter((sp) => selectedIds.includes(sp.subId));
        const keptIds = new Set(kept.map((sp) => sp.subId));
        const newIds = selectedIds.filter((id) => !keptIds.has(id));
        // New items get whatever is left unallocated, or 0.
        const keptTotal = kept.reduce((s, sp) => s + sp.amountCents, 0);
        const pool = Math.max(0, totalCents - keptTotal);
        const perNew = newIds.length > 0 ? Math.round(pool / newIds.length) : 0;
        const added = newIds.map((id) => ({ subId: id, amountCents: perNew }));
        return [...kept, ...added];
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = editTx?.date ?? (today.startsWith(monthKey) ? today : firstOfMonth);
  // When editing (single-select) keep options scoped to the current tab.
  // When adding (multi-select picker), income stays income-only, but spend
  // kinds share the picker so one receipt can split across e.g. Bills + Expenses.
  const SPEND_KINDS = new Set<CategoryKind>(["savings", "bills", "expenses", "debt"]);
  const options = isEdit
    ? subOptions.filter((s) => s.kind === txType)
    : subOptions.filter((s) => txType === "income" ? s.kind === "income" : SPEND_KINDS.has(s.kind));

  const allowedGroups = txType === "income" ? new Set(["Banking"]) : new Set(["Banking", "Credit Cards"]);
  const filteredAccounts = accountOptions.filter((a) => allowedGroups.has(a.group ?? "Other"));
  const accountGroups: string[] = [];
  const accountByGroup = new Map<string, typeof accountOptions>();
  for (const a of filteredAccounts) {
    const g = a.group ?? "Other";
    if (!accountByGroup.has(g)) { accountGroups.push(g); accountByGroup.set(g, []); }
    accountByGroup.get(g)!.push(a);
  }
  accountGroups.sort((a, b) => {
    if (a === "Credit Cards") return -1;
    if (b === "Credit Cards") return 1;
    return 0;
  });

  function handleFormAction(fd: FormData) {
    start(async () => {
      if (isEdit) {
        await updateTransaction(fd);
        onClose();
      } else {
        if (splits.length === 0) return;
        for (const sp of splits) {
          const sfd = new FormData();
          fd.forEach((v, k) => { if (k !== "subcategoryId" && k !== "amount") sfd.append(k, v); });
          sfd.set("subcategoryId", sp.subId);
          sfd.set("amount", (sp.amountCents / 100).toFixed(2));
          await addTransaction(sfd);
        }
        if (fd.get("createAnother") === "on") {
          formRef.current?.reset();
          setSplits([]);
          setTotalCents(0);
          setCleared(false);
        } else {
          onClose();
        }
      }
    });
  }

  return (
    <>
      {/* Budget item picker — full-screen overlay */}
      {pickerOpen && (
        <BudgetItemPicker
          options={options}
          selectedIds={new Set(splits.map((s) => s.subId))}
          onConfirm={handlePickerConfirm}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {accountPickerOpen && (
        <AccountPicker
          accountGroups={accountGroups}
          accountByGroup={accountByGroup}
          selectedAccountId={selectedAccountId}
          onSelect={(accountId) => {
            setSelectedAccountId(accountId);
            setSelectedBucketId("");
            setAccountPickerOpen(false);
          }}
          onClose={() => setAccountPickerOpen(false)}
        />
      )}

      <div className="flex max-h-[calc(100vh-6rem)] w-full flex-col overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:max-h-[85vh] sm:rounded-2xl dark:ring-white/10">
        {/* Header */}
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
          {/* Tabs: two-way (Income / Expense) when adding new; five-way when editing */}
          {isEdit ? (
            <div className="flex flex-wrap gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              {CATEGORY_KINDS.map(({ kind }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleTypeChange(kind)}
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
          ) : initialKind === "debt" ? (
            <div className="flex gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              <div
                className={
                  "flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold bg-surface shadow-sm ring-1 ring-line " +
                  TAB_ACTIVE_TEXT.debt
                }
              >
                {KIND_TAB.debt}
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              {(["income", "expenses"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleTypeChange(kind)}
                  className={
                    "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition " +
                    (txType === kind || (kind === "expenses" && txType !== "income")
                      ? "bg-surface shadow-sm ring-1 ring-line " + TAB_ACTIVE_TEXT[kind]
                      : "text-muted hover:text-foreground")
                  }
                >
                  {kind === "income" ? "Income" : "Expense"}
                </button>
              ))}
            </div>
          )}

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
                  defaultValue={editTx ? centsToDisplay(editTx.amountCents) : ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setTotalCents(isNaN(v) ? 0 : Math.round(v * 100));
                  }}
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

            {/* Account | Budget Item(s) */}
            <div className="grid grid-cols-2 items-start gap-2">
              <div>
                <input type="hidden" name="accountId" value={selectedAccountId} className="sm:hidden" />
                <button
                  type="button"
                  onClick={() => setAccountPickerOpen(true)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-background px-2 py-2.5 text-left text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:hidden"
                >
                  <span className={`min-w-0 flex-1 truncate ${selectedAccountId ? "text-foreground" : "text-muted"}`}>
                    {selectedAccountId
                      ? filteredAccounts.find((account) => account.id === selectedAccountId)?.name ?? "Choose account"
                      : txType === "income"
                        ? "Deposit to account"
                        : txType === "debt"
                          ? "Paid from account"
                          : "Charged to / paid from"}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
                <select
                  name="accountId"
                  value={selectedAccountId}
                  onChange={(e) => {
                    setSelectedAccountId(e.target.value);
                    setSelectedBucketId("");
                  }}
                  className="hidden w-full rounded-xl bg-background px-2 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:block sm:px-3"
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
                    Paying off a credit card? Use <span className="font-semibold">Pay Card</span> on the Accounts page.
                  </p>
                ) : null}
              </div>

              {/* Budget item: single select for edit, multi-select for new */}
              {isEdit ? (
                <BudgetItemField
                  key={txType + "-" + (autoFillSubId ?? "")}
                  kindLabel={KIND_TAB[txType]}
                  options={options}
                  showLabel={false}
                  defaultValue={
                    autoFillSubId ??
                    (editTx && editTx.kind === txType ? editTx.subId ?? "" : "")
                  }
                  defaultIsWithdrawal={editTx?.isWithdrawal ?? false}
                />
              ) : (
                // Trigger button for the full-screen picker
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="w-full truncate rounded-xl bg-background px-2 py-2.5 text-left text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                >
                  {splits.length === 0
                    ? <span className="text-muted">Choose Budget Item…</span>
                    : splits.length === 1
                      ? <span>{options.find((o) => o.id === splits[0].subId)?.name ?? "1 item"}</span>
                      : <span>{splits.length} items</span>
                  }
                </button>
              )}
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

            {/* Split rows — shown for new transactions with ≥1 item selected */}
            {!isEdit && splits.length > 0 && (
              <SplitRows
                splits={splits}
                options={options}
                leftToSplit={leftToSplit}
                onRemove={(subId) => setSplits((prev) => prev.filter((sp) => sp.subId !== subId))}
                onAmountChange={(subId, cents) =>
                  setSplits((prev) => prev.map((sp) => sp.subId === subId ? { ...sp, amountCents: cents } : sp))
                }
                onAddSplit={() => setPickerOpen(true)}
              />
            )}

            {/* Note */}
            <input
              name="memo"
              type="text"
              placeholder="Add a note (optional)"
              defaultValue={editTx?.memo ?? ""}
              className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
            />
            {!isEdit ? (
              <div className="flex items-center justify-between gap-3">
                <input type="hidden" name="cleared" value={cleared ? "on" : ""} />
                <span className="text-xs text-muted">Mark it cleared once it matches your bank or card.</span>
                <button
                  type="button"
                  onClick={() => setCleared((value) => !value)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                    cleared
                      ? "bg-positive/15 text-positive ring-1 ring-positive/20"
                      : "bg-background text-muted ring-1 ring-line hover:bg-positive/10 hover:text-positive"
                  }`}
                >
                  {cleared ? "Cleared ✓" : "Clear"}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                const web = "https://www.xe.com/currencyconverter/";
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                if (!isIOS) {
                  window.open(web, "_blank", "noopener,noreferrer");
                  return;
                }
                // iOS: try the app via URL scheme first. If the browser is
                // still visible after ~1.5s, the app didn't take over —
                // fall back to the web converter.
                const start = Date.now();
                const fallback = window.setTimeout(() => {
                  if (Date.now() - start < 2500 && document.visibilityState === "visible") {
                    window.location.href = web;
                  }
                }, 1500);
                const onHide = () => { window.clearTimeout(fallback); document.removeEventListener("visibilitychange", onHide); };
                document.addEventListener("visibilitychange", onHide);
                window.location.href = "xecurrency://";
              }}
              className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand hover:text-brand-strong hover:underline"
            >
              ↗ Convert currency with XE
            </button>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              {isEdit ? (
                <div className="flex items-center gap-1">
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
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const fd = new FormData();
                        fd.set("id", editTx.id);
                        fd.set("cleared", editTx.cleared ? "false" : "true");
                        await toggleCleared(fd);
                        onClose();
                      })
                    }
                    className="rounded-lg px-3 py-2 text-sm font-bold text-positive transition hover:bg-positive/10 disabled:opacity-60"
                  >
                    {editTx.cleared ? "Uncheck" : "Clear ✓"}
                  </button>
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-brand transition hover:bg-brand-soft hover:text-brand-strong">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || (!isEdit && splits.length === 0)}
                  className={"rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 " + BTN_COLOR[txType]}
                >
                  {pending ? "Saving..." : isEdit ? "Save" : "Add " + KIND_SHORT[txType]}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Split rows shown below the account/item row for new multi-item transactions.
function SplitRows({
  splits,
  options,
  leftToSplit,
  onRemove,
  onAmountChange,
  onAddSplit,
}: {
  splits: SplitEntry[];
  options: SubOption[];
  leftToSplit: number;
  onRemove: (subId: string) => void;
  onAmountChange: (subId: string, cents: number) => void;
  onAddSplit: () => void;
}) {
  return (
    <div className="rounded-xl ring-1 ring-line overflow-hidden">
      {splits.map((sp) => {
        const opt = options.find((o) => o.id === sp.subId);
        return (
          <div key={sp.subId} className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5 last:border-b-0">
            <button
              type="button"
              onClick={() => onRemove(sp.subId)}
              className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-negative text-white text-xs font-bold leading-none"
              aria-label="Remove"
            >
              −
            </button>
            <span className="flex-1 truncate text-sm font-medium">{opt?.name ?? sp.subId}</span>
            <div className="relative shrink-0">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">$</span>
              <SplitAmountInput
                amountCents={sp.amountCents}
                onChange={(cents) => onAmountChange(sp.subId, cents)}
              />
            </div>
          </div>
        );
      })}

      {/* Add Split + Left to Split footer */}
      <div className="flex items-center justify-between border-t border-line/60 bg-background/60 px-3 py-2">
        <button
          type="button"
          onClick={onAddSplit}
          className="text-sm font-semibold text-brand"
        >
          + Add Split
        </button>
        <span className={`text-xs font-semibold tabular-nums ${Math.abs(leftToSplit) < 2 ? "text-positive" : leftToSplit < 0 ? "text-negative" : "text-warning"}`}>
          {leftToSplit >= 0 ? "$" + (leftToSplit / 100).toFixed(2) + " left to split" : "−$" + (Math.abs(leftToSplit) / 100).toFixed(2) + " over"}
        </span>
      </div>
    </div>
  );
}

// Uncontrolled-style amount input: keeps raw string while typing, formats on blur.
// Avoids the "typing 10 → 1.00" issue caused by re-formatting on every keystroke.
function SplitAmountInput({ amountCents, onChange }: { amountCents: number; onChange: (cents: number) => void }) {
  const [raw, setRaw] = useState(amountCents === 0 ? "" : (amountCents / 100).toFixed(2));
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder="0.00"
      onChange={(e) => {
        setRaw(e.target.value);
        const v = parseFloat(e.target.value);
        onChange(isNaN(v) ? 0 : Math.round(v * 100));
      }}
      onBlur={() => {
        const v = parseFloat(raw);
        setRaw(isNaN(v) || v <= 0 ? "" : v.toFixed(2));
      }}
      className="w-24 rounded-lg bg-background py-1.5 pl-6 pr-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
    />
  );
}

// Mobile uses an app-controlled picker instead of the browser's native
// <select> sheet. iOS controls the native sheet's typography, while this keeps
// account names compact and lets the list scroll independently of the form.
function AccountPicker({
  accountGroups,
  accountByGroup,
  selectedAccountId,
  onSelect,
  onClose,
}: {
  accountGroups: string[];
  accountByGroup: Map<string, AccountOption[]>;
  selectedAccountId: string;
  onSelect: (accountId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-hidden bg-surface sm:hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <button type="button" onClick={onClose} className="text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
        <h2 className="text-base font-bold">Choose account</h2>
        <span className="w-12" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {accountGroups.map((group) => (
          <div key={group}>
            <div className="border-b border-line/40 bg-background/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {group}
            </div>
            {accountByGroup.get(group)?.map((account) => {
              const selected = account.id === selectedAccountId;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => onSelect(account.id)}
                  className="flex w-full items-center gap-3 border-b border-line/40 px-4 py-3 text-left text-sm active:bg-brand-soft/40"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${selected ? "border-brand bg-brand text-white" : "border-zinc-400 bg-transparent dark:border-zinc-600"}`}>
                    {selected ? (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m2 6 3 3 5-5" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{account.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Full-screen budget item picker with search + checkboxes + remaining amounts.
function BudgetItemPicker({
  options,
  selectedIds,
  onConfirm,
  onClose,
}: {
  options: SubOption[];
  selectedIds: Set<string>;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));

  const filtered = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-hidden bg-surface sm:h-auto sm:items-center sm:justify-center sm:bg-black/50 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[80vh] sm:w-full sm:max-w-lg sm:flex-none sm:rounded-2xl sm:shadow-xl sm:ring-1 sm:ring-line">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:rounded-t-2xl">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <h2 className="text-base font-bold">Select Budget Item(s)</h2>
        <button
          type="button"
          onClick={() => onConfirm([...checked])}
          className="text-sm font-semibold text-brand"
        >
          Done
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-line px-4 py-2">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl bg-background py-2 pl-9 pr-3 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between border-b border-line/40 bg-background/60 px-4 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Item</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Remaining</span>
      </div>

      {/* Item list */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {filtered.length === 0
          ? <p className="px-4 py-8 text-center text-sm text-muted">No items found</p>
          : (() => {
              const multiKind = new Set(filtered.map((o) => o.kind)).size > 1;
              return CATEGORY_KINDS
                .filter(({ kind }) => filtered.some((o) => o.kind === kind))
                .map(({ kind, name }) => (
                  <Fragment key={kind}>
                    {multiKind && (
                      <div className="border-b border-line/40 bg-background/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {name}
                      </div>
                    )}
                    {filtered.filter((o) => o.kind === kind).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(o.id)}
                        className="flex w-full items-center gap-3 border-b border-line/40 px-4 py-3.5 text-left last:border-b-0 active:bg-brand-soft/40"
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${checked.has(o.id) ? "border-brand bg-brand text-white" : "border-zinc-400 bg-transparent dark:border-zinc-600"}`}>
                          {checked.has(o.id) && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M2 6l3 3 5-5" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 text-sm font-medium">{o.name}</span>
                        {o.remainingCents != null && (
                          <span className={`shrink-0 text-sm tabular-nums ${o.remainingCents < 0 ? "rounded-full bg-negative/25 px-2 py-0.5 font-medium text-foreground" : "text-muted"}`}>
                            {o.remainingCents < 0
                              ? "−$" + (Math.abs(o.remainingCents) / 100).toFixed(2)
                              : "$" + (o.remainingCents / 100).toFixed(2)}
                          </span>
                        )}
                      </button>
                    ))}
                  </Fragment>
                ));
            })()
        }
      </div>
    </div>
    </div>
  );
}

// Payee field (unchanged)
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
        onChange={(e) => { setValue(e.target.value); setOpen(e.target.value.trim().length > 0); setHighlighted(-1); }}
        onFocus={() => { if (value.trim().length > 0) setOpen(true); }}
        onBlur={() => { setOpen(false); setHighlighted(-1); }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
      />
      {open && value.trim().length > 0 && matches.length > 0 ? (
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

// Single-select field used only in edit mode.
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
          This is a withdrawal — money coming out of the linked bucket (e.g. using savings for a purchase)
        </label>
      ) : null}
    </div>
  );
}
