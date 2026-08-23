"use client";

import { ModalShell } from "@/components/modal-shell";
import { SubscriptionsBoard, type CreditCardOption } from "./subscriptions-board";
import type { IrregularBillRow, SubscriptionRow } from "./types";

export function SubscriptionsModal({
  currency,
  subscriptions,
  irregularBills,
  creditCards,
  onClose,
  showOnly,
  initialSubscriptionEdit,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  onClose: () => void;
  showOnly?: "subscriptions" | "irregular";
  initialSubscriptionEdit?: string | "new";
}) {
  const title =
    showOnly === "subscriptions"
      ? initialSubscriptionEdit === "new"
        ? "Add subscription"
        : "Edit subscription"
      : showOnly === "irregular"
      ? "Manage Irregular Bills"
      : "Manage Subscriptions & Irregular Bills";
  return (
    <ModalShell title={title} onClose={onClose} className="max-w-5xl">
      <SubscriptionsBoard
        currency={currency}
        subscriptions={subscriptions}
        irregularBills={irregularBills}
        creditCards={creditCards}
        showOnly={showOnly}
        initialSubscriptionEdit={initialSubscriptionEdit}
      />
    </ModalShell>
  );
}
