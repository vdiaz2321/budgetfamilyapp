"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import type { CloseAdjustment, CloseChangeLine } from "@/lib/close-adjustments";
import { applyCloseChanges, leaveCloseChanges } from "./month-end-actions";

// A backdated, re-dated, edited or deleted transaction changed a month that's
// already closed. Nothing moves until Update is pressed, and today's balances
// never do: this only rewrites what a past month closed at.

export type CloseChangesData = {
  ids: string[];
  changes: CloseChangeLine[];
  adjustments: CloseAdjustment[];
  months: string[];
};

const ROW = "grid grid-cols-2 items-center gap-x-2 gap-y-1 px-3 py-2 text-center sm:grid-cols-[minmax(0,1fr)_3.5rem_6.75rem_6.75rem]";

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shortDate = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const shortMonth = (iso: string) => SHORT[Number(iso.slice(5, 7)) - 1];

function noticeLabel(data: CloseChangesData) {
  const count = data.changes.length;
  const months =
    data.months.length === 1
      ? `${LONG[Number(data.months[0].slice(5, 7)) - 1]} close`
      : `${data.months.map(shortMonth).join(", ")} closes`;
  return `${months}: ${count} ${count === 1 ? "change" : "changes"} not included`;
}

function changeNote(line: CloseChangeLine) {
  switch (line.kind) {
    case "moved":
      return `Moved from ${shortDate(line.fromDate ?? line.date)} to ${shortDate(line.date)}`;
    case "added":
      return `Added for ${shortDate(line.date)}`;
    case "removed":
      return `Removed from ${shortDate(line.date)}`;
    default:
      return `Edited, dated ${shortDate(line.date)}`;
  }
}

export function CloseChangesNotice({ data, onReview }: { data: CloseChangesData; onReview: () => void }) {
  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2 text-left text-sm font-semibold text-foreground shadow-[inset_4px_0_0_var(--viz-bills)] ring-1 ring-inset ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
    >
      <span className="pl-1">{noticeLabel(data)}</span>
      <span className="pl-1 text-brand">Review</span>
    </button>
  );
}

export function CloseChangesModal({
  data,
  currency,
  onClose,
}: {
  data: CloseChangesData;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: (ids: string[]) => Promise<{ error: string | null }>) => {
    setError(null);
    start(async () => {
      const result = await action(data.ids);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <ModalShell title="Update closing balances?" onClose={onClose} mobileAlign="top" className="sm:max-w-xl">
      <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.changes.map((line) => (
            <li key={line.id} className="px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">{line.label}</span>
                <span className="shrink-0 tabular-nums">{formatMoney(Math.abs(line.amountCents), currency)}</span>
              </div>
              <p className="text-[13.5px] italic">{changeNote(line)}</p>
            </li>
          ))}
        </ul>

        {/* Four columns from sm up. Too narrow for them on a phone, where the
            After figure ran off the card: the name takes its own line and each
            figure carries its own label. */}
        <div className="divide-y divide-line rounded-lg border border-line text-sm">
          <div className={`${ROW} hidden text-[11px] font-bold uppercase tracking-wide sm:grid`}>
            <span>Account</span>
            <span>Month</span>
            <span>Close now</span>
            <span>After</span>
          </div>
          {data.adjustments.map((a) => (
            <div key={`${a.month}|${a.bucketId ?? a.accountId}`} className={ROW}>
              <span className="col-span-2 font-semibold sm:col-span-1 sm:font-normal">
                {a.name}
                <span className="sm:hidden"> · {shortMonth(a.month)}</span>
              </span>
              <span className="hidden sm:block">{shortMonth(a.month)}</span>
              <span className="tabular-nums">
                <span className="block text-[11px] font-bold uppercase tracking-wide sm:hidden">Close now</span>
                {formatMoney(a.nowCents, currency)}
              </span>
              <span className="font-bold tabular-nums">
                <span className="block text-[11px] uppercase tracking-wide sm:hidden">After</span>
                {formatMoney(a.afterCents, currency)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[13.5px]">Today&apos;s balances don&apos;t change.</p>
        {error ? <p className="text-sm font-semibold text-negative">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(leaveCloseChanges)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/40"
          >
            Leave as is
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(applyCloseChanges)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
