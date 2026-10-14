"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { ModalShell } from "@/components/modal-shell";
import type { AccountOption } from "../budget/types";
import { TransferEditorModal, type EditableTransfer } from "../transactions/transfer-editor-modal";

// Every transfer between your own accounts (bank → bank and investment → bank),
// newest first. Tap a row to edit or delete it — the same editor Transactions
// opens, so both pages change the same record.
export function TransferActivityModal({
  transfers,
  accounts,
  buckets,
  currency,
  onClose,
}: {
  transfers: EditableTransfer[];
  accounts: AccountOption[];
  buckets: { id: string; accountId: string; name: string }[];
  currency: string;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<EditableTransfer | null>(null);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const bucketOf = new Map(buckets.map((b) => [b.id, b.name]));
  const label = (accountId: string | null, bucketId: string | null) => {
    const name = accountId ? nameOf.get(accountId) ?? "Account" : "Account";
    const bucket = bucketId ? bucketOf.get(bucketId) : null;
    return bucket ? `${name} · ${bucket}` : name;
  };

  return (
    <ModalShell title="Transfer Activity" onClose={onClose} className="sm:max-w-2xl" mobileAlign="top">
      {transfers.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm">No transfers yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {transfers.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-2.5 text-left transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                <span className="min-w-0 text-sm">
                  <span className="block font-medium">
                    {label(t.accountId, t.fromBucketId)} → {label(t.toAccountId, t.toBucketId)}
                  </span>
                  <span className="block truncate text-xs tabular-nums">
                    {formatDay(t.date)}{t.memo ? ` · ${t.memo}` : ""}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatMoney(t.amountCents, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full pt-[max(env(safe-area-inset-top),1.75rem)] sm:max-w-[520px] sm:pt-0">
            <TransferEditorModal
              transfer={editing}
              accounts={accounts}
              buckets={buckets}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

// "Oct 9, 2026" — the year stays so older transfers aren't mistaken for this year's.
function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
