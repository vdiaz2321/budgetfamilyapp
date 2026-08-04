"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { deleteTransaction, deleteTransactions, toggleCleared } from "../budget/actions";
import { TransactionModal } from "../budget/transaction-modal";
import { MonthPicker } from "../budget/month-picker";
import { ImportCsvModal } from "./import-csv-modal";
import { DOT as KIND_DOT } from "../budget/category-icons";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "../budget/types";

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};

const GRID = "grid-cols-[1.75rem_5.5rem_2.25rem_6.5rem_minmax(7rem,1.2fr)_5.5rem_minmax(7rem,1.2fr)_minmax(5rem,0.9fr)_7rem_2rem]";

type Props = {
  month: { key: string; label: string; firstOfMonth: string };
  currency: string;
  transactions: TxData[];
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  bucketsByAccount?: import("../budget/types").BucketsByAccount;
  payeeOptions?: { id: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
  dateRange: { from: string | null; to: string | null };
};

export function TransactionsTable({
  month,
  currency,
  transactions,
  subOptions,
  accountOptions,
  bucketsByAccount = {},
  payeeOptions = [],
  payeeLineItems = [],
  dateRange,
}: Props) {
  const router = useRouter();
  // null = closed, "new" = add form, otherwise an existing tx to edit.
  const [modal, setModal] = useState<"new" | TxData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [fromDate, setFromDate] = useState(dateRange.from ?? "");
  const [toDate, setToDate] = useState(dateRange.to ?? "");
  // Date sort — defaults to ascending (1st → 31st). Click header to flip.
  const [dateSort, setDateSort] = useState<"asc" | "desc">("asc");
  const cycleDateSort = () => setDateSort((s) => (s === "asc" ? "desc" : "asc"));
  const hasRange = Boolean(dateRange.from || dateRange.to);

  function applyRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    router.push(params.toString() ? `/transactions?${params}` : "/transactions");
  }

  function clearRange() {
    setFromDate("");
    setToDate("");
    router.push(`/transactions?month=${month.key}`);
  }

  const accountName = new Map(accountOptions.map((a) => [a.id, a.name]));

  function exportCsv() {
    const qf = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ["Date", "Amount", "Category", "Type", "Payee", "Account", "Remarks", "Cleared"].join(","),
      ...filtered.map((t) =>
        [
          qf(t.date),
          qf(((t.isWithdrawal ? -1 : 1) * t.amountCents / 100).toFixed(2)),
          qf(t.subName),
          qf(t.isCardPayment ? "Card Payment" : (t.kind ? KIND_LABEL[t.kind] : "")),
          qf(t.payee),
          qf(t.accountId ? accountName.get(t.accountId) : ""),
          qf(t.memo),
          qf(t.cleared ? "Yes" : "No"),
        ].join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${month.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  }

  function deleteSelected() {
    const ids = [...selected];
    setSelected(new Set());
    startBulk(() => deleteTransactions(ids));
  }

  const q = query.trim().toLowerCase();
  const filtered = transactions.filter((t) => {
    if (q && ![t.payee, t.subName, t.memo].some((f) => f?.toLowerCase().includes(q))) return false;
    if (accountFilter && t.accountId !== accountFilter) return false;
    if (kindFilter && t.kind !== kindFilter) return false;
    return true;
  });
  {
    const dir = dateSort === "desc" ? -1 : 1;
    filtered.sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : 0));
  }

  const incomeTotal = filtered
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const outflowTotal = filtered
    .filter((t) => t.kind !== "income" && !t.isCardPayment)
    .reduce((sum, t) => sum + t.amountCents, 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasRange ? (
          <span className="text-2xl font-bold tracking-tight text-foreground">
            Custom range
          </span>
        ) : (
          <MonthPicker monthKey={month.key} basePath="/transactions" />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-muted ring-1 ring-black/20 transition hover:bg-brand-soft hover:text-brand sm:inline-block dark:ring-white/20"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-brand ring-1 ring-brand transition hover:bg-brand-soft sm:inline-block"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setModal("new")}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Transaction
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payee, item, or note"
            className="w-full rounded-xl bg-surface py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand dark:ring-white/10"
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="hidden rounded-xl bg-surface px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand sm:block dark:ring-white/10"
        >
          <option value="">All types</option>
          {CATEGORY_KINDS.map(({ kind }) => (
            <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
          ))}
        </select>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="rounded-xl bg-surface px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand dark:ring-white/10"
        >
          <option value="">All accounts</option>
          {(() => {
            const groups: string[] = [];
            const byGroup = new Map<string, typeof accountOptions>();
            for (const a of accountOptions) {
              const g = a.group ?? "Other";
              if (!byGroup.has(g)) { groups.push(g); byGroup.set(g, []); }
              byGroup.get(g)!.push(a);
            }
            return groups.map((g) => (
              <optgroup key={g} label={g}>
                {byGroup.get(g)!.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
            ));
          })()}
        </select>
      </div>

      {/* Date range — searches across months instead of just the one selected above */}
      <div className="hidden flex-wrap items-center gap-2 text-sm sm:flex">
        <span className="text-muted">From</span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            applyRange(e.target.value, toDate);
          }}
          className="rounded-xl bg-surface px-3 py-1.5 shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand dark:ring-white/10"
        />
        <span className="text-muted">To</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            applyRange(fromDate, e.target.value);
          }}
          className="rounded-xl bg-surface px-3 py-1.5 shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand dark:ring-white/10"
        />
        <button
          type="button"
          onClick={() => {
            setFromDate("2000-01-01");
            setToDate("");
            applyRange("2000-01-01", "");
          }}
          className="rounded-xl px-3 py-1.5 font-medium text-brand hover:bg-brand-soft"
        >
          All time
        </button>
        {hasRange ? (
          <button
            type="button"
            onClick={clearRange}
            className="rounded-xl px-3 py-1.5 font-medium text-muted hover:bg-brand-soft hover:text-foreground"
          >
            Clear — back to {month.label}
          </button>
        ) : null}
      </div>

      {/* Bulk-delete bar — shown when rows are selected */}
      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-xl bg-negative/10 px-4 py-2.5 ring-1 ring-negative/20">
          <span className="text-sm font-medium text-negative">
            {selected.size} {selected.size === 1 ? "transaction" : "transactions"} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={bulkPending}
              onClick={deleteSelected}
              className="flex items-center gap-1.5 rounded-lg bg-negative px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
              Delete {selected.size}
            </button>
          </div>
        </div>
      ) : null}

      {/* Register — desktop table */}
      <section className="hidden overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 sm:block dark:ring-white/10">
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            {/* Header */}
            <div className={`grid ${GRID} items-center gap-2 border-b border-line px-4 py-2.5`}>
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length; }}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                  className="h-4 w-4 rounded accent-[var(--brand)]"
                />
              </span>
              <button
                type="button"
                onClick={cycleDateSort}
                className="flex w-full items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted hover:text-primary"
                title={
                  dateSort === "asc"
                    ? "Oldest first — click for newest first"
                    : "Newest first — click for oldest first"
                }
              >
                Date
                <span className="text-[9px] leading-none">
                  {dateSort === "desc" ? "▼" : "▲"}
                </span>
              </button>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Clear</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Amount</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Category</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Type</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Payee</span>
              <span className="flex w-full justify-start text-[11px] font-medium uppercase tracking-wide text-muted">Account</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Remarks</span>
              <span />
            </div>

            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {transactions.length === 0
                  ? "No transactions this month yet — click Add Transaction to log one."
                  : "No transactions match your filters."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((t) => (
                  <TxLine
                    key={t.id}
                    tx={t}
                    currency={currency}
                    accountName={t.accountId ? accountName.get(t.accountId) ?? "—" : "—"}
                    onEdit={() => {
                      if (!t.isCardPayment) setModal(t);
                    }}
                    selected={selected.has(t.id)}
                    onSelect={() => toggleSelect(t.id)}
                  />
                ))}
              </ul>
            )}

            {/* Totals — same grid as the rows so the net sits under the Amount column */}
            <div className={`grid ${GRID} items-center gap-2 border-t border-line bg-positive/5 px-4 py-2.5 dark:bg-positive/10`}>
              <span className="col-span-2 whitespace-nowrap text-xs font-medium text-muted">
                {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}
              </span>
              <span className="col-span-7 whitespace-nowrap text-xs text-muted">
                <span className="font-medium">Income Rc&apos;d</span>{" "}
                <span className="tabular-nums">{formatMoney(incomeTotal, currency)}</span>
                <span className="mx-1.5">–</span>
                <span className="font-medium">Spent Income</span>{" "}
                <span className="tabular-nums">{formatMoney(outflowTotal, currency)}</span>
                <span className="mx-1.5">–</span>
                <span className="font-medium">Income Left</span>{" "}
                <span className={`tabular-nums ${incomeTotal - outflowTotal >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatMoney(incomeTotal - outflowTotal, currency)}
                </span>
              </span>
              <span />
            </div>
          </div>
        </div>
      </section>

      {/* Register — mobile card list */}
      <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 sm:hidden dark:ring-white/10">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {transactions.length === 0
              ? "No transactions this month yet — tap Add Transaction to log one."
              : "No transactions match your filters."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((t) => (
              <TxCard
                key={t.id}
                tx={t}
                currency={currency}
                accountName={t.accountId ? accountName.get(t.accountId) ?? "—" : "—"}
                onTap={() => {
                  if (!t.isCardPayment) setModal(t);
                }}
              />
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line bg-positive/5 px-3 py-2 text-[11px] dark:bg-positive/10">
          <span className="whitespace-nowrap font-medium text-muted">
            {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}
          </span>
          {incomeTotal > 0 && outflowTotal > 0 && (
            <span className="truncate text-right text-muted">
              <span className="text-positive">+{formatMoney(incomeTotal, currency)}</span>
              {" · "}
              <span className="text-negative">−{formatMoney(outflowTotal, currency)}</span>
            </span>
          )}
          <span className={`whitespace-nowrap font-semibold tabular-nums ${incomeTotal - outflowTotal >= 0 ? "text-positive" : "text-negative"}`}>
            {formatMoney(incomeTotal - outflowTotal, currency)}
          </span>
        </div>
      </section>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full sm:max-w-[520px]">
            <TransactionModal
              editTx={modal === "new" ? null : modal}
              monthKey={month.key}
              firstOfMonth={month.firstOfMonth}
              subOptions={subOptions}
              accountOptions={accountOptions}
              bucketsByAccount={bucketsByAccount}
              payeeOptions={payeeOptions}
              payeeLineItems={payeeLineItems}
              onClose={() => setModal(null)}
            />
          </div>
        </div>
      ) : null}

      {importOpen ? <ImportCsvModal onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function TxLine({
  tx,
  currency,
  accountName,
  onEdit,
  selected,
  onSelect,
}: {
  tx: TxData;
  currency: string;
  accountName: string;
  onEdit: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const [clearPending, startClear] = useTransition();
  const [delPending, startDel] = useTransition();
  const isIncome = tx.kind === "income";
  const canEdit = !tx.isCardPayment;

  const onToggle = (checked: boolean) => {
    const fd = new FormData();
    fd.set("id", tx.id);
    fd.set("cleared", String(checked));
    startClear(() => toggleCleared(fd));
  };

  return (
    <li
      onDoubleClick={canEdit ? onEdit : undefined}
      title={canEdit ? "Double-click to edit" : "Card payment — delete and recreate it from the card"}
      className={`group grid ${GRID} cursor-default select-none items-center gap-2 px-4 py-2 hover:bg-brand-soft/25 ${
        selected ? "bg-brand-soft/20" : ""
      } ${tx.cleared ? "opacity-60" : ""}`}
    >
      <span onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label="Select transaction"
          className="h-4 w-4 rounded accent-[var(--brand)]"
        />
      </span>
      <button type="button" disabled={!canEdit} onClick={onEdit} className="text-left text-sm tabular-nums disabled:cursor-default">
        {tx.date.slice(5, 7)}/{tx.date.slice(8, 10)}/{tx.date.slice(2, 4)}
      </button>
      <span onDoubleClick={(e) => e.stopPropagation()} className="flex justify-center">
        <input
          type="checkbox"
          checked={tx.cleared}
          disabled={clearPending}
          onChange={(e) => onToggle(e.target.checked)}
          title="Cleared — verified against your bank / card app"
          aria-label="Cleared"
          className="h-4 w-4 rounded accent-[var(--positive)] disabled:opacity-50"
        />
      </span>
      <button
        type="button"
        disabled={!canEdit}
        onClick={onEdit}
        className={`text-center text-sm font-semibold tabular-nums disabled:cursor-default ${
          isIncome ? "text-positive" : "text-foreground"
        }`}
      >
        {isIncome ? "+" : "−"}
        {formatMoney(tx.amountCents, currency)}
      </button>
      <button type="button" disabled={!canEdit} onClick={onEdit} className="flex min-w-0 items-center gap-1.5 text-left disabled:cursor-default">
        {tx.kind ? <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[tx.kind]}`} /> : null}
        <span className="truncate text-sm">{tx.subName}</span>
      </button>
      <span className="truncate text-sm text-muted">{tx.kind ? KIND_LABEL[tx.kind] : "—"}</span>
      <button type="button" disabled={!canEdit} onClick={onEdit} className="truncate text-left text-sm font-medium disabled:cursor-default">
        {tx.payee ?? "—"}
      </button>
      <span className="truncate text-sm text-muted">{accountName}</span>
      <span className="truncate text-sm text-muted">{tx.memo ?? ""}</span>
      <form
        action={(fd) => startDel(() => deleteTransaction(fd))}
        onDoubleClick={(e) => e.stopPropagation()}
        className="justify-self-end"
      >
        <input type="hidden" name="id" value={tx.id} />
        <button
          type="submit"
          disabled={delPending}
          title="Delete transaction"
          aria-label="Delete transaction"
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-negative/10 hover:text-negative group-hover:opacity-100 disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </form>
    </li>
  );
}

function TxCard({
  tx,
  currency,
  accountName,
  onTap,
}: {
  tx: TxData;
  currency: string;
  accountName: string;
  onTap: () => void;
}) {
  const canEdit = !tx.isCardPayment;
  const isIncome = tx.kind === "income";
  const dateStr = `${tx.date.slice(5, 7)}/${tx.date.slice(8, 10)}`;

  return (
    <li>
      <button
        type="button"
        disabled={!canEdit}
        onClick={onTap}
        className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition active:bg-brand-soft/25 disabled:cursor-default ${
          tx.cleared ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="whitespace-nowrap text-xs font-medium text-muted tabular-nums">
            {dateStr}
          </span>
          <span
            className={`whitespace-nowrap text-sm font-bold tabular-nums ${
              isIncome ? "text-positive" : "text-foreground"
            }`}
          >
            {isIncome ? "+" : "−"}
            {formatMoney(tx.amountCents, currency)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {tx.kind ? <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[tx.kind]}`} /> : null}
            <span className="truncate text-sm font-medium text-foreground">{tx.subName}</span>
          </div>
          <span className="shrink-0 truncate text-xs text-muted">
            {tx.payee ?? accountName}
          </span>
        </div>
      </button>
    </li>
  );
}
