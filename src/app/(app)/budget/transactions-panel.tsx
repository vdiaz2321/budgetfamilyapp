"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { deleteTransaction } from "./actions";
import { TransactionModal } from "./transaction-modal";
import type { AccountOption, SubOption, TxData } from "./types";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Props = {
  monthKey: string; // YYYY-MM
  monthLabel: string; // "July 2026"
  firstOfMonth: string; // YYYY-MM-01
  currency: string;
  transactions: TxData[];
  subOptions: SubOption[];
  accountOptions: AccountOption[];
};

export function TransactionsPanel({
  monthKey,
  monthLabel,
  firstOfMonth,
  currency,
  transactions,
  subOptions,
  accountOptions,
}: Props) {
  // null = closed, "new" = add form, otherwise an existing tx to edit.
  const [modal, setModal] = useState<"new" | TxData | null>(null);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? transactions.filter((t) =>
        [t.payee, t.subName, t.memo].some((f) => f?.toLowerCase().includes(q)),
      )
    : transactions;

  return (
    <div className="relative flex max-h-[calc(100vh-6rem)] min-h-[320px] flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Transactions</h2>
          <p className="text-xs text-muted">{monthLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Transaction
        </button>
      </div>

      <div className="border-b border-line px-3 py-2.5">
        <div className="relative">
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
            placeholder="Search"
            className="w-full rounded-lg bg-background py-2 pl-9 pr-3 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
          <p className="text-sm text-muted">
            {transactions.length === 0 ? (
              <>
                No transactions yet this month.
                <br />
                Tap <span className="font-semibold text-brand">Add Transaction</span> to log one.
              </>
            ) : (
              "No transactions match your search."
            )}
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {filtered.map((t) => (
            <TxRow key={t.id} tx={t} currency={currency} onEdit={() => setModal(t)} />
          ))}
        </ul>
      )}

      {modal ? (
        <TransactionModal
          editTx={modal === "new" ? null : modal}
          monthKey={monthKey}
          firstOfMonth={firstOfMonth}
          subOptions={subOptions}
          accountOptions={accountOptions}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function TxRow({
  tx,
  currency,
  onEdit,
}: {
  tx: TxData;
  currency: string;
  onEdit: () => void;
}) {
  const [pending, start] = useTransition();
  const day = tx.date.slice(8, 10);
  const monthIdx = parseInt(tx.date.slice(5, 7), 10) - 1;
  const isIncome = tx.kind === "income";

  return (
    <li className="group flex items-center gap-3 px-4 py-2 hover:bg-brand-soft/25">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="w-8 shrink-0 text-center">
          <p className="text-[9px] font-semibold uppercase text-muted">{MONTHS_SHORT[monthIdx]}</p>
          <p className="text-sm font-bold leading-tight">{day}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tx.payee ?? tx.subName}</p>
          <p className="truncate text-xs text-muted">{tx.payee ? tx.subName : tx.memo ?? ""}</p>
        </div>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${isIncome ? "text-positive" : "text-foreground"}`}>
          {isIncome ? "+" : "−"}
          {formatMoney(tx.amountCents, currency)}
        </span>
      </button>
      <form action={(fd) => start(() => deleteTransaction(fd))} className="shrink-0">
        <input type="hidden" name="id" value={tx.id} />
        <button
          type="submit"
          disabled={pending}
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
