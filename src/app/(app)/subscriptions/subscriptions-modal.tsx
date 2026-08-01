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
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  onClose: () => void;
}) {
  return (
    <ModalShell title="Manage Subscriptions & Irregular Bills" onClose={onClose} className="max-w-5xl">
      <SubscriptionsBoard
        currency={currency}
        subscriptions={subscriptions}
        irregularBills={irregularBills}
        creditCards={creditCards}
      />
    </ModalShell>
  );
}
