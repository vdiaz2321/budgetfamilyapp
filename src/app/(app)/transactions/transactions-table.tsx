"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { deleteTransaction, toggleCleared } from "../budget/actions";
import { TransactionModal } from "../budget/transaction-modal";
import { MonthPicker } from "../budget/month-picker";
import type { AccountOption, SubOption, TxData } from "../budget/types";

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};
// Same accent dots as the budget groups — the tabs stay visually connected.
const KIND_DOT: Record<CategoryKind, string> = {
  income: "bg-positive",
  savings: "bg-sky-500",
  bills: "bg-brand",
  expenses: "bg-accent",
  debt: "bg-negative",
};

const GRID = "grid-cols-[2.25rem_5.5rem_minmax(7rem,1.2fr)_minmax(8rem,1.4fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_7rem_2rem]";

type Props = {
  month: { key: string; label: string; firstOfMonth: string };
  currency: string;
  transactions: TxData[];
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  dateRange: { from: string | null; to: string | null };
};

export function TransactionsTable({
  month,
  currency,
  transactions,
  subOptions,
  accountOptions,
  dateRange,
}: Props) {
  const router = useRouter();
  // null = closed, "new" = add form, otherwise an existing tx to edit.
  const [modal, setModal] = useState<"new" | TxData | null>(null);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [fromDate, setFromDate] = useState(dateRange.from ?? "");
  const [toDate, setToDate] = useState(dateRange.to ?? "");
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

  const q = query.trim().toLowerCase();
  const filtered = transactions.filter((t) => {
    if (q && ![t.payee, t.subName, t.memo].some((f) => f?.toLowerCase().includes(q))) return false;
    if (accountFilter && t.accountId !== accountFilter) return false;
    if (kindFilter && t.kind !== kindFilter) return false;
    return true;
  });

  const incomeTotal = filtered
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const outflowTotal = filtered
    .filter((t) => t.kind !== "income")
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
          className="rounded-xl bg-surface px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand dark:ring-white/10"
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
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Date range — searches across months instead of just the one selected above */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
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

      {/* Register */}
      <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            {/* Header */}
            <div className={`grid ${GRID} items-center gap-2 border-b border-line px-4 py-2.5`}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Clear</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Date</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Payee</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Category</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Account</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Memo</span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-muted">Amount</span>
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
                    onEdit={() => setModal(t)}
                  />
                ))}
              </ul>
            )}

            {/* Totals */}
            <div className="flex items-center justify-between gap-4 border-t border-line bg-positive/5 px-4 py-2.5 dark:bg-positive/10">
              <span className="whitespace-nowrap text-sm font-bold">
                {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}
              </span>
              <div className="flex items-baseline gap-3">
                <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted">
                  Income {formatMoney(incomeTotal, currency)} · Spent {formatMoney(outflowTotal, currency)}
                </span>
                <span
                  className={`whitespace-nowrap text-sm font-bold tabular-nums ${
                    incomeTotal - outflowTotal >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {formatMoney(incomeTotal - outflowTotal, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {modal ? (
        <TransactionModal
          editTx={modal === "new" ? null : modal}
          monthKey={month.key}
          firstOfMonth={month.firstOfMonth}
          subOptions={subOptions}
          accountOptions={accountOptions}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function TxLine({
  tx,
  currency,
  accountName,
  onEdit,
}: {
  tx: TxData;
  currency: string;
  accountName: string;
  onEdit: () => void;
}) {
  const [clearPending, startClear] = useTransition();
  const [delPending, startDel] = useTransition();
  const isIncome = tx.kind === "income";

  const onToggle = (checked: boolean) => {
    const fd = new FormData();
    fd.set("id", tx.id);
    fd.set("cleared", String(checked));
    startClear(() => toggleCleared(fd));
  };

  return (
    <li
      className={`group grid ${GRID} items-center gap-2 px-4 py-2 hover:bg-brand-soft/25 ${
        tx.cleared ? "opacity-60" : ""
      }`}
    >
      <span>
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
      <button type="button" onClick={onEdit} className="text-left text-sm tabular-nums">
        {tx.date.slice(5, 7)}/{tx.date.slice(8, 10)}/{tx.date.slice(2, 4)}
      </button>
      <button type="button" onClick={onEdit} className="truncate text-left text-sm font-medium">
        {tx.payee ?? "—"}
      </button>
      <button type="button" onClick={onEdit} className="flex min-w-0 items-center gap-1.5 text-left">
        {tx.kind ? <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[tx.kind]}`} /> : null}
        <span className="truncate text-sm">{tx.subName}</span>
      </button>
      <span className="truncate text-sm text-muted">{accountName}</span>
      <span className="truncate text-sm text-muted">{tx.memo ?? ""}</span>
      <button
        type="button"
        onClick={onEdit}
        className={`text-right text-sm font-semibold tabular-nums ${
          isIncome ? "text-positive" : "text-foreground"
        }`}
      >
        {isIncome ? "+" : "−"}
        {formatMoney(tx.amountCents, currency)}
      </button>
      <form action={(fd) => startDel(() => deleteTransaction(fd))} className="justify-self-end">
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
