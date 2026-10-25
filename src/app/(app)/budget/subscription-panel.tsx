"use client";

import { formatMoney } from "@/lib/money";
import { HEADER_ACCENT, MonthTransactions } from "./item-panel";
import { remainingPrefill } from "./subscriptions-summary";
import type { SubscriptionRow } from "../subscriptions/types";
import type { TxData, TxPrefill } from "./types";

// The rail panel for one subscription — what a budget item's panel is, for a
// row of the Subscriptions card. Every subscription books to the one shared
// "Subscriptions" item, so the item panel could only ever show all of them
// together; this lists just this one's charges (the same ones its Spent
// figure counts). Its settings live in the subscription editor, one tap away.
export function SubscriptionPanel({
  sub,
  transactions,
  currency,
  accountNameById,
  onClose,
  onEditSubscription,
  onAddTransaction,
  onEditTransaction,
}: {
  sub: SubscriptionRow;
  transactions: TxData[];
  currency: string;
  accountNameById: Map<string, string>;
  onClose: () => void;
  onEditSubscription: () => void;
  onAddTransaction: (prefill?: TxPrefill) => void;
  onEditTransaction: (tx: TxData) => void;
}) {
  const planned = sub.monthPlannedCents ?? 0;
  const spent = sub.monthSpentCents ?? 0;
  const remaining = planned - spent;
  const ids = new Set(sub.monthTxIds ?? []);
  const txs = transactions
    .filter((t) => ids.has(t.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className={`relative ${HEADER_ACCENT.bills} px-4 pb-3 pt-3 pr-11`}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/30"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-white">{sub.name}</p>
            <p className="mt-0.5 text-[11px] text-white/90 tabular-nums">
              {formatMoney(spent, currency)} spent of {formatMoney(planned, currency)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-white/80">
              {remaining < 0 ? "Overspent" : "Remaining"}
            </p>
            <p className="text-xl font-bold leading-tight text-white tabular-nums">
              {formatMoney(remaining, currency)}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-line/70 bg-surface px-5 py-2">
        <button
          type="button"
          onClick={() =>
            onAddTransaction({
              cents: remainingPrefill(planned, spent, sub.amountCents),
              accountId: sub.accountId,
              payee: sub.name,
              subId: sub.subcategoryId,
              kind: "bills",
            })
          }
          className="flex-1 rounded bg-positive/15 py-1.5 text-xs font-semibold text-positive transition hover:bg-positive/25"
        >
          +Transaction
        </button>
        <button
          type="button"
          onClick={onEditSubscription}
          className="shrink-0 rounded bg-brand-soft/60 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20"
        >
          Edit subscription
        </button>
      </div>

      <MonthTransactions txs={txs} currency={currency} accountNameById={accountNameById} onEdit={onEditTransaction} />
    </div>
  );
}
