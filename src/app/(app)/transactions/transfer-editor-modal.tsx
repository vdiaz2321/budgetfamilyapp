"use client";

import { useState, useTransition } from "react";
import { centsToGroupedDisplay } from "@/lib/money";
import { updateAccountTransfer } from "../accounts/actions";
import { deleteTransaction } from "../budget/actions";
import type { AccountOption, TxData } from "../budget/types";

type TransferBucket = { id: string; accountId: string; name: string };

export function TransferEditorModal({
  transfer,
  accounts,
  buckets,
  onClose,
}: {
  transfer: TxData;
  accounts: AccountOption[];
  buckets: TransferBucket[];
  onClose: () => void;
}) {
  const movable = accounts.filter((account) =>
    !["Credit Cards", "Investments", "Loans"].includes(account.group ?? "Other"),
  );
  const [fromId, setFromId] = useState(transfer.accountId ?? movable[0]?.id ?? "");
  const [toId, setToId] = useState(transfer.toAccountId ?? movable[1]?.id ?? "");
  const [fromBucketId, setFromBucketId] = useState(transfer.fromBucketId ?? "");
  const [toBucketId, setToBucketId] = useState(transfer.toBucketId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fromBuckets = buckets.filter((bucket) => bucket.accountId === fromId);
  const toBuckets = buckets.filter((bucket) => bucket.accountId === toId);

  const remove = () => {
    const fd = new FormData();
    fd.set("id", transfer.id);
    start(async () => {
      await deleteTransaction(fd);
      onClose();
    });
  };

  return (
    <div className="w-full rounded-none bg-surface p-4 shadow-lg sm:rounded-xl sm:ring-1 sm:ring-black/10 dark:sm:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">Edit transfer</h2>
          <p className="text-xs text-muted">Updates both account balances together.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <form
        action={(fd) =>
          start(async () => {
            setError(null);
            const result = await updateAccountTransfer(fd);
            if (result?.error) setError(result.error);
            else onClose();
          })
        }
        className="space-y-3"
      >
        <input type="hidden" name="transactionId" value={transfer.id} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={centsToGroupedDisplay(transfer.amountCents)}
              required
              className="w-full rounded-lg bg-background px-3 py-2 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Date">
            <input
              name="date"
              type="date"
              defaultValue={transfer.date}
              required
              className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
        </div>

        <Field label="From">
          <select
            name="fromAccountId"
            value={fromId}
            onChange={(event) => {
              setFromId(event.target.value);
              setFromBucketId("");
            }}
            required
            className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {movable.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </Field>
        {fromBuckets.length > 0 ? (
          <Field label="From bucket">
            <select
              name="fromBucketId"
              value={fromBucketId}
              onChange={(event) => setFromBucketId(event.target.value)}
              required
              className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Choose a bucket…</option>
              {fromBuckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="To">
          <select
            name="toAccountId"
            value={toId}
            onChange={(event) => {
              setToId(event.target.value);
              setToBucketId("");
            }}
            required
            className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {movable.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </Field>
        {toBuckets.length > 0 ? (
          <Field label="To bucket">
            <select
              name="toBucketId"
              value={toBucketId}
              onChange={(event) => setToBucketId(event.target.value)}
              required
              className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Choose a bucket…</option>
              {toBuckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Note">
          <input
            name="memo"
            defaultValue={transfer.memo ?? ""}
            className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        {error ? <p className="text-xs font-medium text-negative">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-negative hover:bg-negative/10 disabled:opacity-50"
          >
            Delete transfer
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save transfer"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
