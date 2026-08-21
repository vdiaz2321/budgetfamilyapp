"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, moneyExpressionToCents } from "@/lib/money";
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
  income: "bg-surface",
  savings: "bg-surface",
  bills: "bg-surface",
  expenses: "bg-surface",
  debt: "bg-surface",
};
const BTN_COLOR: Record<CategoryKind, string> = {
  income: "bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-800/70 dark:hover:bg-emerald-700",
  savings: "bg-sky-600 hover:bg-sky-700",
  bills: "bg-slate-700 hover:bg-slate-800 dark:bg-slate-500 dark:hover:bg-slate-400",
  expenses: "bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-900/70",
  debt: "bg-rose-600 hover:bg-rose-700",
};
const BTN_TEXT: Record<CategoryKind, string> = {
  income: "text-foreground",
  savings: "text-white",
  bills: "text-white",
  expenses: "text-foreground dark:text-foreground",
  debt: "text-white",
};
const TAB_ACTIVE_TEXT: Record<CategoryKind, string> = {
  income: "bg-emerald-200 text-foreground dark:bg-emerald-800/70 dark:text-foreground",
  savings: "bg-surface text-sky-600 dark:text-sky-400",
  bills: "bg-surface text-indigo-600 dark:text-indigo-400",
  expenses: "bg-rose-100 text-foreground dark:bg-rose-900/50 dark:text-foreground",
  debt: "bg-surface text-rose-600 dark:text-rose-400",
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
  initialAccountId,
  initialAmountCents,
  initialPayee,
  initialDate,
  initialIsWithdrawal = false,
  restrictToInitialKind = false,
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
  initialAccountId?: string;
  initialAmountCents?: number;
  initialPayee?: string;
  initialDate?: string;
  initialIsWithdrawal?: boolean;
  restrictToInitialKind?: boolean;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const isEdit = editTx != null;
  const [txType, setTxType] = useState<CategoryKind>(editTx?.kind ?? initialKind ?? "expenses");
  // A refund is stored as a NEGATIVE amount on the same subcategory/account —
  // the actuals view (`sum(amount_cents)`) and ledger delta naturally undo it
  // from spending and return the money to the account. Seed from the sign of
  // the existing tx so the toggle reflects reality on edit.
  const [isRefund, setIsRefund] = useState<boolean>(
    editTx != null && editTx.amountCents < 0,
  );
  // Splits-on-edit: when enabled, the modal switches to the same multi-item
  // flow used when adding a new transaction. Saving with 2+ items replaces
  // the original tx with N new ones (delete + insert × N) that all share the
  // same date / account / payee / memo.
  const [splittingMode, setSplittingMode] = useState<boolean>(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(editTx?.accountId ?? initialAccountId ?? "");
  const availableBuckets = bucketsByAccount[selectedAccountId] ?? [];
  const [selectedBucketId, setSelectedBucketId] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [autoFillSubId, setAutoFillSubId] = useState<string | null>(null);
  const [convertedCents, setConvertedCents] = useState<number | null>(null);

  // Split state — for NEW transactions only. Edit mode keeps the existing single-item flow.
  const [totalCents, setTotalCents] = useState(editTx?.amountCents ?? initialAmountCents ?? 0);
  const [splits, setSplits] = useState<SplitEntry[]>(() =>
    initialSubId ? [{ subId: initialSubId, amountCents: editTx?.amountCents ?? initialAmountCents ?? 0 }] : []
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  const splitTotal = splits.reduce((s, sp) => s + sp.amountCents, 0);
  const leftToSplit = totalCents - splitTotal;

  // When exactly one item is selected, auto-fill it with the full total so the
  // user doesn't have to re-enter it after changing the amount or removing splits.
  useEffect(() => {
    // On edit, we still let the single-item sync happen when the user is
    // building up a split (splittingMode true) so the initial entry mirrors
    // the entered total.
    if (isEdit && !splittingMode) return;
    if (splits.length !== 1) return;
    if (splits[0].amountCents === totalCents) return;
    // Keep the single selected item synchronized with the entered total.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplits([{ subId: splits[0].subId, amountCents: totalCents }]);
  }, [isEdit, splittingMode, splits, totalCents]);

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
    setSplits((prev) => {
      const kept = prev.filter((sp) => selectedIds.includes(sp.subId));
      const keptIds = new Set(kept.map((sp) => sp.subId));
      const newIds = selectedIds.filter((id) => !keptIds.has(id));
      // Multiple splits: new items start at 0 so the user enters each amount
      // explicitly. Single item is filled by the effect below.
      const added = newIds.map((id) => ({ subId: id, amountCents: 0 }));
      return [...kept, ...added];
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = editTx?.date ?? initialDate ?? (today.startsWith(monthKey) ? today : firstOfMonth);
  // Both add and edit share the two-tab UI now, so "Income" narrows to income
  // subs and "Expense" opens to any spend kind (savings/bills/expenses/debt).
  // A locked initial kind (Budget's Debt/Savings row context) still filters
  // to exactly that kind so a payment posted from a debt row can't drift.
  const SPEND_KINDS = new Set<CategoryKind>(["savings", "bills", "expenses", "debt"]);
  const options =
    restrictToInitialKind && initialKind
      ? subOptions.filter((s) => s.kind === initialKind)
      : subOptions.filter((s) =>
          txType === "income" ? s.kind === "income" : SPEND_KINDS.has(s.kind),
        );

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
        // Splits-on-edit: replace the original transaction with N new ones
        // that all share the same date/account/payee/memo but each get their
        // own subcategory + amount. Only kicks in when the user opted into
        // splittingMode AND picked 2+ items. One-item saves stay as a plain
        // update so ids and audit trails don't churn.
        if (splittingMode && splits.length > 1 && editTx) {
          const deleteFd = new FormData();
          deleteFd.set("id", editTx.id);
          await deleteTransaction(deleteFd);
          for (const sp of splits) {
            const sfd = new FormData();
            fd.forEach((v, k) => {
              if (k !== "id" && k !== "subcategoryId" && k !== "amount") sfd.append(k, v);
            });
            sfd.set("subcategoryId", sp.subId);
            sfd.set("amount", (sp.amountCents / 100).toFixed(2));
            await addTransaction(sfd);
          }
        } else if (splittingMode && splits.length === 1) {
          // Split flow settled back to a single item — update the existing
          // row to that sub + amount instead of doing a delete+insert.
          fd.set("subcategoryId", splits[0].subId);
          fd.set("amount", (splits[0].amountCents / 100).toFixed(2));
          await updateTransaction(fd);
        } else {
          await updateTransaction(fd);
        }
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

      <div className="flex max-h-[92dvh] min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:h-auto sm:max-h-[85vh] sm:flex-none sm:rounded-2xl dark:ring-white/10">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Tabs: same simple two-way (Income / Expense) in both add and edit.
              Picking a subcategory in the dropdown below is what pins the true
              kind (savings / bills / expenses / debt) — the tabs only filter
              the picker into inflow vs outflow, so an edit reads as clean as
              an add. Only exception: a locked initial kind (debt/savings from
              the Budget row context) still shows its own tab. */}
          {initialKind === "debt" || initialKind === "savings" ? (
            <div className="flex gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              <div
                className={
                  "flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold shadow-sm ring-1 ring-line " +
                  TAB_ACTIVE_TEXT[initialKind]
                }
              >
                {KIND_TAB[initialKind]}
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
                      ? "shadow-sm ring-1 ring-line " + TAB_ACTIVE_TEXT[kind]
                      : "text-muted hover:bg-foreground/8 hover:text-foreground")
                  }
                >
                  {kind === "income" ? "Income" : "Expense"}
                </button>
              ))}
            </div>
          )}

          <form id="tx-form" ref={formRef} action={handleFormAction} className="mt-4 space-y-4">
            {isEdit ? <input type="hidden" name="id" value={editTx.id} /> : null}
            {!isEdit && initialIsWithdrawal ? <input type="hidden" name="isWithdrawal" value="on" /> : null}
            {/* Signals to the server action to negate the amount (refund) and
                skip bucket/debt side effects. The input's own value stays a
                positive amount either way — server does the sign flip. */}
            <input type="hidden" name="isRefund" value={isRefund ? "on" : ""} />

            <CurrencyConverter
              onUse={(usdCents) => {
                setConvertedCents(usdCents);
                setTotalCents(usdCents);
              }}
            />

            {/* Amount | Budget Item(s) */}
            <div className="grid grid-cols-2 items-start gap-2">
              <AmountInput
                inputRef={amountRef}
                defaultValue={
                  editTx
                    // Refunds are stored negative in the DB but always typed as
                    // positive dollars — flip the sign for display so the input
                    // reads $50 instead of −$50 while the Refund pill is on.
                    ? centsToDisplay(Math.abs(editTx.amountCents))
                    : initialAmountCents != null
                    ? centsToDisplay(initialAmountCents)
                    : ""
                }
                onChangeCents={setTotalCents}
                forcedCents={convertedCents}
              />

              {/* Budget item: single select for edit (unless the user opts
                  into splittingMode via "+ Add split"), multi-select for new. */}
              {isEdit && !splittingMode ? (
                <div className="flex flex-col gap-1">
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
                  <button
                    type="button"
                    onClick={() => {
                      // Seed the split list with the existing single-item so the
                      // picker opens showing what's already there, then let the
                      // user add more. Save will replace this tx with N new ones.
                      const currentSubId = editTx && editTx.kind === txType ? editTx.subId ?? "" : "";
                      setSplits(
                        currentSubId
                          ? [{ subId: currentSubId, amountCents: totalCents }]
                          : [],
                      );
                      setSplittingMode(true);
                      setPickerOpen(true);
                    }}
                    className="text-left text-xs font-semibold text-foreground/70 hover:text-foreground px-1"
                  >
                    + Add split
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="w-full truncate rounded-xl bg-background px-2 py-2.5 text-left text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                  >
                    {splits.length === 0
                      ? <span className="text-muted">Budget Items</span>
                      : splits.length === 1
                        ? <span>{options.find((o) => o.id === splits[0].subId)?.name ?? "1 item"}</span>
                        : <span>{splits.length} items</span>
                    }
                  </button>
                  {splits.length === 1 && (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="text-left text-xs font-semibold text-brand px-1"
                    >
                      + Add Split
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Merchant */}
            <PayeeField
              placeholder={PAYEE_PLACEHOLDER[txType]}
              defaultValue={editTx?.payee ?? initialPayee ?? ""}
              payeeOptions={payeeOptions}
              payeeLineItems={payeeLineItems}
              onMatch={handlePayeeMatch}
            />

            {/* Account | Date */}
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
                      ? filteredAccounts.find((account) => account.id === selectedAccountId)?.name ?? "Accounts"
                      : "Accounts"}
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
                  <option value="">Accounts</option>
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

              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
              />
            </div>

            {/* Split rows — only shown when 2+ splits exist */}
            {(!isEdit || splittingMode) && splits.length > 1 && (
              <SplitRows
                splits={splits}
                options={options}
                leftToSplit={leftToSplit}
                onRemove={(subId) => setSplits((prev) => prev.filter((sp) => sp.subId !== subId))}
                onAmountChange={(subId, cents) => {
                  setSplits((prev) => prev.map((sp) => sp.subId === subId ? { ...sp, amountCents: cents } : sp));
                }}
                onAddSplit={() => setPickerOpen(true)}
              />
            )}

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
            {/* Delete moved into the footer next to Refund so all row-level
                controls sit on one line — see the bottom action bar below. */}
          </form>
        </div>

        {/* Bottom action bar — flex-wrap so the right-side controls fall
            under the left group on narrow (mobile) widths instead of running
            off the edge, and everything shrinks a step tighter on mobile. */}
        <div className={"flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-line px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]  " + HEADER_TINT[txType]}>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-1.5 py-1 text-xs font-bold text-muted transition hover:text-foreground sm:px-2 sm:py-1.5 sm:text-sm"
            >
              Cancel
            </button>
            {/* Refund toggle — only meaningful for spend kinds. Off: normal
                spend; On: server stores amount as negative so it credits the
                account and reduces the sub's actual spend. Hidden on income
                (a refund of income doesn't exist) and on the locked
                debt/savings context (those flows have their own semantics). */}
            {txType !== "income" && !initialIsWithdrawal && !(restrictToInitialKind && (initialKind === "debt" || initialKind === "savings")) ? (
              <button
                type="button"
                onClick={() => setIsRefund((v) => !v)}
                aria-pressed={isRefund}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
                  isRefund
                    ? "bg-positive/20 text-positive ring-positive/40 hover:bg-positive/30"
                    : "bg-transparent text-muted ring-line hover:text-foreground"
                }`}
              >
                {isRefund ? "✓ Refund" : "Refund"}
              </button>
            ) : null}
            {/* Delete lives here so the footer holds every row-level control
                (Cancel · Refund · Delete) in one line. Same 11px tuning so it
                fits on the same row as the primary save on the right. */}
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
                className="rounded-full px-2.5 py-1 text-[11px] font-bold text-negative ring-1 ring-negative/30 transition hover:bg-negative/10 disabled:opacity-60"
              >
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {!isEdit ? (
              <button
                type="submit"
                form="tx-form"
                name="cleared"
                value="on"
                disabled={pending || splits.length === 0}
                className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-60 sm:px-3 sm:py-1.5 sm:text-sm dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60 dark:hover:bg-emerald-900/40"
              >
                Clear
              </button>
            ) : null}
            <button
              type="submit"
              form="tx-form"
              disabled={pending || ((!isEdit || splittingMode) && splits.length === 0)}
              className={"rounded-xl px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-60 sm:px-3.5 sm:py-1.5 sm:text-sm " + BTN_COLOR[txType] + " " + BTN_TEXT[txType]}
            >
              {pending
                ? "Saving..."
                : isRefund
                ? isEdit
                  ? "Save Refund"
                  : "Add Refund"
                : isEdit
                ? "Save"
                : initialIsWithdrawal
                ? "Withdraw"
                : "Add " + KIND_SHORT[txType]}
            </button>
            {isEdit ? (
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
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold text-foreground ring-1 transition disabled:opacity-60 sm:px-3 sm:py-1.5 sm:text-sm ${
                  editTx.cleared
                    ? "bg-positive/25 ring-positive/40 hover:bg-positive/35"
                    : "bg-positive/10 ring-positive/25 hover:bg-positive/20"
                }`}
              >
                {editTx.cleared ? "Unclear" : "Clear"}
              </button>
            ) : null}
          </div>
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
            <div className="shrink-0">
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

// The main "$ amount" field. Supports arithmetic expressions (e.g. "26.10 + 8.19")
// — operator chips appear on focus so mobile keypads can insert them.
function AmountInput({
  inputRef,
  defaultValue,
  onChangeCents,
  forcedCents,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  defaultValue: string;
  onChangeCents: (cents: number) => void;
  forcedCents?: number | null;
}) {
  const [raw, setRaw] = useState(defaultValue);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (forcedCents != null && forcedCents > 0) {
      const display = (forcedCents / 100).toFixed(2);
      setRaw(display);
    }
  }, [forcedCents]);

  const commit = (value: string) => {
    const cents = moneyExpressionToCents(value);
    onChangeCents(cents);
    const display = cents === 0 ? "" : (cents / 100).toFixed(2);
    setRaw(display);
    if (inputRef.current) inputRef.current.value = display;
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        {!focused && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted">$</span>
        )}
        <input
          ref={inputRef}
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="0.00"
          value={raw}
          onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
          onBlur={() => { setTimeout(() => setFocused(false), 150); commit(raw); }}
          onKeyDown={(e) => {
            // Enter evaluates a typed expression like "45 + 12.50 - 3" (parser
            // in moneyExpressionToCents). No calculator chips needed — the
            // input accepts +, -, *, / directly on any keyboard.
            if (e.key === "Enter") { e.preventDefault(); commit(raw); e.currentTarget.blur(); }
          }}
          onChange={(e) => {
            setRaw(e.target.value);
            const v = parseFloat(e.target.value);
            onChangeCents(isNaN(v) ? 0 : Math.round(v * 100));
          }}
          className={`w-full rounded-xl bg-background py-2.5 pr-2 text-base font-semibold tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand ${focused ? "pl-3" : "pl-7"}`}
        />
      </div>
    </div>
  );
}

// Uncontrolled-style amount input: keeps raw string while typing, formats on blur.
// Accepts arithmetic expressions (e.g. "45 + 12.50 - 3") — Enter evaluates.
function SplitAmountInput({ amountCents, onChange }: { amountCents: number; onChange: (cents: number) => void }) {
  const [raw, setRaw] = useState(amountCents === 0 ? "" : (amountCents / 100).toFixed(2));

  const commit = (value: string) => {
    const cents = moneyExpressionToCents(value);
    onChange(cents);
    setRaw(cents === 0 ? "" : (cents / 100).toFixed(2));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder="0.00"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setRaw(e.target.value);
        const v = parseFloat(e.target.value);
        onChange(isNaN(v) ? 0 : Math.round(v * 100));
      }}
      onKeyDown={(e) => {
        // Enter evaluates the expression instead of submitting the form.
        if (e.key === "Enter") {
          e.preventDefault();
          commit(raw);
        }
      }}
      onBlur={() => commit(raw)}
      title="Type a value or expression, e.g. 45 + 12.50"
      className="w-24 rounded-lg bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
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
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col overflow-hidden bg-surface sm:hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <button type="button" onClick={onClose} className="text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
        <h2 className="text-base font-bold">Choose account</h2>
        <span className="w-12" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]">
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
                  className="flex w-full items-center gap-4 border-b border-line/40 px-4 py-4 text-left active:bg-brand-soft/40"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? "border-brand bg-brand text-white" : "border-zinc-400 bg-transparent dark:border-zinc-600"}`}>
                    {selected ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m2 6 3 3 5-5" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-medium">{account.name}</span>
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
  const searchRef = useRef<HTMLInputElement>(null);

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
    // Return cursor to the search box so the user can keep typing to filter
    // and pick the next item without an extra tap.
    setSearch("");
    searchRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col overflow-hidden bg-surface sm:h-auto sm:items-center sm:justify-center sm:bg-black/50 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
        <h2 className="text-base font-bold">
          Select Budget Item(s)
          {checked.size > 0 ? (
            <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900 tabular-nums dark:bg-amber-300 dark:text-amber-950">
              {checked.size}
            </span>
          ) : null}
        </h2>
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
            ref={searchRef}
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]">
        {filtered.length === 0 && checked.size === 0
          ? <p className="px-4 py-8 text-center text-sm text-muted">No items found</p>
          : (() => {
              const selectedItems = options.filter((o) => checked.has(o.id));
              const unselectedFiltered = filtered.filter((o) => !checked.has(o.id));
              const multiKind = new Set(unselectedFiltered.map((o) => o.kind)).size > 1;

              const renderItem = (o: SubOption) => (
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
              );

              return (
                <>
                  {selectedItems.length > 0 && (
                    <>
                      <div className="border-b border-line/40 bg-brand-soft/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
                        Selected
                      </div>
                      {selectedItems.map(renderItem)}
                    </>
                  )}
                  {CATEGORY_KINDS
                    .filter(({ kind }) => unselectedFiltered.some((o) => o.kind === kind))
                    .map(({ kind, name }) => {
                  const categoryItems = unselectedFiltered.filter((o) => o.kind === kind);

                  return (
                    <Fragment key={kind}>
                      {multiKind && (
                        <div className="border-b border-line/40 bg-background/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {name}
                        </div>
                      )}
                      {categoryItems.map(renderItem)}
                    </Fragment>
                  );
                    })}
                </>
              );
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

// Currencies most likely to come up on travel receipts. Add more as needed —
// the API returns rates for ~150 currencies, but a big <select> is worse UX.
const FX_CURRENCIES = [
  "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY",
  "MXN", "INR", "KRW", "TRY", "BRL", "SGD", "HKD",
  "SEK", "NOK", "DKK", "PLN", "THB", "ZAR",
] as const;

// Module-level cache so the modal doesn't re-fetch every time it opens.
let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;

function CurrencyConverter({ onUse }: { onUse: (usdCents: number) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState<string>("EUR");
  const [rates, setRates] = useState<Record<string, number> | null>(cachedRates?.rates ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || rates) return;
    // Rates cached for the session are good enough — FX moves slowly at
    // family-budget scale and one-tap "Use $X.XX" always shows the number.
    setLoading(true);
    setError(null);
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((d) => {
        if (d?.rates && typeof d.rates === "object") {
          cachedRates = { rates: d.rates, fetchedAt: Date.now() };
          setRates(d.rates);
        } else {
          setError("Couldn't load rates");
        }
      })
      .catch(() => setError("Network error — check connection"))
      .finally(() => setLoading(false));
  }, [open, rates]);

  const num = parseFloat(amount);
  const rate = rates?.[from];
  const usd = rate && !isNaN(num) && num > 0 ? num / rate : null;
  const usdCents = usd != null ? Math.round(usd * 100) : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1 rounded-md py-1.5 text-sm font-semibold text-brand hover:text-brand-strong hover:underline sm:py-0"
      >
        ↗ Convert currency to USD
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-background p-3 ring-1 ring-line">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">Convert to USD</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative hover:bg-negative/15"
          >
            Close
          </button>
          {usdCents != null && (
            <button
              type="button"
              onClick={() => { onUse(usdCents); setOpen(false); setAmount(""); }}
              className="rounded-md bg-positive/15 px-3.5 py-2 text-sm font-bold text-positive transition hover:bg-positive/25"
            >
              Use
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-24 rounded-lg bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        >
          {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-muted">=</span>
        <span className="text-sm font-bold tabular-nums text-foreground">
          {loading ? "…" : usd != null ? `$${usd.toFixed(2)}` : "$0.00"}
        </span>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-negative">{error}</p>
      ) : rate ? (
        <p className="mt-1.5 text-[10px] text-muted">
          1 USD = {rate.toFixed(4)} {from}
        </p>
      ) : null}
    </div>
  );
}
