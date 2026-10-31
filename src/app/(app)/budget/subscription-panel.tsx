"use client";

import { formatMoney } from "@/lib/money";
import { KIND_STRIPE, MonthTransactions, PanelHeader } from "./item-panel";
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
      <PanelHeader
        stripe={KIND_STRIPE.bills}
        onClose={onClose}
        title={<p className="truncate text-lg font-bold text-foreground">{sub.name}</p>}
      >
        <span className="font-bold">{formatMoney(spent, currency)}</span> spent of{" "}
        <span className="font-bold">{formatMoney(planned, currency)}</span>
        {remaining < 0 ? (
          <span className="font-bold text-negative"> · {formatMoney(-remaining, currency)} over</span>
        ) : null}
      </PanelHeader>

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
