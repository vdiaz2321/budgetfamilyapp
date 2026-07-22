"use client";

import { ModalShell } from "@/components/modal-shell";
import { SubscriptionsBoard } from "./subscriptions-board";
import type { IrregularBillRow, SubscriptionRow } from "./types";

export function SubscriptionsModal({
  currency,
  subscriptions,
  irregularBills,
  onClose,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  onClose: () => void;
}) {
  return (
    <ModalShell title="Manage Subscriptions & Irregular Bills" onClose={onClose}>
      <SubscriptionsBoard
        currency={currency}
        subscriptions={subscriptions}
        irregularBills={irregularBills}
      />
    </ModalShell>
  );
}
