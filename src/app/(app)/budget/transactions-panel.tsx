"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import type { CategoryKind } from "@/lib/categories";
import { deleteTransaction } from "./actions";
import { TransactionModal } from "./transaction-modal";
import { DOT } from "./category-icons";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "./types";

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};

// Groups the transaction list into Today / Yesterday / weekday / dated buckets.
// dateStr is "YYYY-MM-DD"; parse to a local date so the day math isn't skewed
// by the UTC offset.
function dateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const tx = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - tx.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return tx.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}

type Props = {
  monthKey: string; // YYYY-MM
  monthLabel: string; // "July 2026"
  firstOfMonth: string; // YYYY-MM-01
  currency: string;
  transactions: TxData[];
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  bucketsByAccount?: import("./types").BucketsByAccount;
  payeeOptions?: { id: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
  // Optional overrides so the same panel can be reused elsewhere (e.g. a
  // "Debt Payments" list on the Snowball page). Default to the Budget wording.
  title?: string;
  subtitle?: string;
  addLabel?: string;
  initialKind?: CategoryKind;
  filterKinds?: CategoryKind[];
  filterSubs?: { id: string; label: string }[];
  onRemoveKind?: (kind: CategoryKind) => void;
  onRemoveSub?: (id: string) => void;
  onClearFilter?: () => void;
  collapseStorageKey?: string;
  initialCollapsed?: boolean;
};

export function TransactionsPanel({
  monthKey,
  monthLabel,
  firstOfMonth,
  currency,
  transactions,
  subOptions,
  accountOptions,
  bucketsByAccount = {},
  payeeOptions = [],
  payeeLineItems = [],
  title = "Transactions",
  subtitle,
  addLabel = "Add",
  initialKind,
  filterKinds = [],
  filterSubs = [],
  onRemoveKind,
  onRemoveSub,
  onClearFilter,
  collapseStorageKey,
  initialCollapsed = false,
}: Props) {
  // null = closed, "new" = add form, otherwise an existing tx to edit.
  const [modal, setModal] = useState<"new" | TxData | null>(null);
  const [query, setQuery] = useState("");
  const [collapseState, setCollapseState] = useSessionCollapse(
    collapseStorageKey ?? `transactions-panel:${title}`,
    () => ({ collapsed: initialCollapsed }),
  );
  const collapsed = collapseState.collapsed ?? initialCollapsed;

  const q = query.trim().toLowerCase();
  const hasKindFilter = filterKinds.length > 0;
  const hasSubFilter = filterSubs.length > 0;
  const subIdSet = new Set(filterSubs.map((s) => s.id));
  const kindSet = new Set(filterKinds);
  const kindFiltered = (hasKindFilter || hasSubFilter)
    ? transactions.filter((t) =>
        (hasSubFilter && t.subId && subIdSet.has(t.subId)) ||
        (hasKindFilter && t.kind && kindSet.has(t.kind))
      )
    : transactions;
  const filtered = q
    ? kindFiltered.filter((t) =>
        [t.payee, t.subName, t.memo].some((f) => f?.toLowerCase().includes(q)),
      )
    : kindFiltered;

  // Bucket the (already newest→oldest) list into date groups, keeping order —
  // same-date rows are contiguous, so a new group starts whenever the label
  // changes.
  const groups: { label: string; txs: TxData[] }[] = [];
  for (const t of filtered) {
    const label = dateLabel(t.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.txs.push(t);
    else groups.push({ label, txs: [t] });
  }

  // Add/edit swaps the whole card for the form, in place — so it stays
  // anchored where the transactions list was (the right rail on Budget)
  // instead of covering the budget list behind a centered overlay.
  if (modal) {
    return (
      <TransactionModal
        editTx={modal === "new" ? null : modal}
        monthKey={monthKey}
        firstOfMonth={firstOfMonth}
        subOptions={subOptions}
        accountOptions={accountOptions}
        bucketsByAccount={bucketsByAccount}
        payeeOptions={payeeOptions}
        payeeLineItems={payeeLineItems}
        initialKind={modal === "new" ? initialKind : undefined}
        onClose={() => setModal(null)}
      />
    );
  }

  return (
    <div className={`relative flex ${collapsed ? "" : "max-h-[calc(100vh-6rem)] min-h-[320px]"} flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10`}>
      <div className={`flex items-center justify-between gap-2 ${collapsed ? "" : "border-b border-line"} px-4 py-3`}>
        <button
          type="button"
          onClick={() => setCollapseState((state) => ({ ...state, collapsed: !collapsed }))}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold">{title}</h2>
            {collapsed ? null : (
              <p className="truncate text-xs text-muted">
                {subtitle ?? `${monthLabel} · ${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}`}
              </p>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {addLabel}
        </button>
      </div>

      {collapsed ? null : (<>
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
            placeholder="Search transactions"
            className="w-full rounded-lg bg-background py-2 pl-9 pr-3 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {hasKindFilter || hasSubFilter ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {filterKinds.map((k) => (
              <span key={`k:${k}`} className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
                <span className={`h-2 w-2 rounded-full ${DOT[k]}`} />
                {KIND_LABEL[k]}
                <button
                  type="button"
                  onClick={() => onRemoveKind?.(k)}
                  aria-label={`Remove ${KIND_LABEL[k]} filter`}
                  className="ml-0.5 text-brand/70 hover:text-brand"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            {filterSubs.map((s) => (
              <span key={`s:${s.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
                {s.label}
                <button
                  type="button"
                  onClick={() => onRemoveSub?.(s.id)}
                  aria-label={`Remove ${s.label} filter`}
                  className="ml-0.5 text-brand/70 hover:text-brand"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            <span className="text-[11px] text-muted">
              {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}
            </span>
            {(filterKinds.length + filterSubs.length) > 1 && onClearFilter ? (
              <button
                type="button"
                onClick={onClearFilter}
                className="text-[11px] font-semibold text-muted hover:text-brand"
              >
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
          <p className="text-sm text-muted">
            {transactions.length === 0 ? (
              <>
                No transactions yet this month.
                <br />
                Tap <span className="font-semibold text-brand">Add</span> to log one.
              </>
            ) : (
              "No transactions match your search."
            )}
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto px-0 py-3 sm:px-3">
          {groups.map((g) => (
            <div key={g.label}>
              {/* Date header: label + a rule filling the rest of the row */}
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {g.label}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <ul>
                {g.txs.map((t) => (
                  <TxRow
                    key={t.id}
                    tx={t}
                    currency={currency}
                    onEdit={() => {
                      if (!t.isCardPayment) setModal(t);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      </>)}
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
  const kind = tx.kind;
  const isIncome = kind === "income";
  const canEdit = !tx.isCardPayment;
  // Income green, debt red, everything else neutral.
  const amountColor = isIncome ? "text-positive" : kind === "debt" ? "text-negative" : "text-foreground";

  const dot = kind ? DOT[kind] : "bg-muted";

  const title = tx.payee ?? tx.subName;
  // "Fidelity (Taxable) · Savings" — the payee's category, or (without a payee)
  // the memo, followed by the category name.
  const desc = [tx.payee ? tx.subName : tx.memo || null, kind ? KIND_LABEL[kind] : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-brand-soft/25">
      <button
        type="button"
        disabled={!canEdit}
        onClick={onEdit}
        title={canEdit ? undefined : "Card payment — delete and recreate it from the card"}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          </div>
          {desc ? <p className="truncate text-xs text-muted">{desc}</p> : null}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Edit + delete reveal on hover — no running balance to fade. */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            disabled={!canEdit}
            onClick={onEdit}
            title={canEdit ? "Edit transaction" : "Card payment — delete and recreate it from the card"}
            aria-label="Edit transaction"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-brand-soft hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <form action={(fd) => start(async () => { await deleteTransaction(fd); })}>
            <input type="hidden" name="id" value={tx.id} />
            <button
              type="submit"
              disabled={pending}
              title="Delete transaction"
              aria-label="Delete transaction"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-negative/10 hover:text-negative disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </form>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${amountColor}`}>
          {isIncome ? "+" : "−"}
          {formatMoney(tx.amountCents, currency)}
        </span>
      </div>
    </li>
  );
}
