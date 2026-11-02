"use client";

import { ModalShell } from "@/components/modal-shell";
import type { ContributionLine } from "@/lib/contribution-lines";
import { formatMoney } from "@/lib/money";
import type { FundSlot } from "@/lib/fund-contributions";

export type ContributionsTarget = { title: string; cents: number; slots: FundSlot[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

// Four columns from sm up; on a phone the holding and amount share a line and
// the date and bank go under them.
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 py-2 sm:grid-cols-[4.5rem_minmax(0,1.3fr)_minmax(0,1fr)_7rem]";

export function ContributionsModal({
  target,
  allLines,
  year,
  currency,
  onClose,
}: {
  target: ContributionsTarget;
  allLines: ContributionLine[];
  year: number;
  currency: string;
  onClose: () => void;
}) {
  const wanted = new Set(target.slots.map((s) => `${s.accountId}:${s.bucketId ?? "_"}`));
  const lines = allLines.filter(
    (l) => l.date.startsWith(`${year}-`) && wanted.has(`${l.accountId}:${l.bucketId ?? "_"}`),
  );
  const total = lines.reduce((sum, l) => sum + l.cents, 0);

  return (
    <ModalShell title={`${target.title} · ${year}`} onClose={onClose} mobileAlign="top" className="sm:max-w-2xl">
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
        {lines.length > 0 ? (
          <div className="divide-y divide-line rounded-lg border border-line text-sm">
            <div className={`${ROW} hidden text-center text-[11px] font-bold uppercase tracking-wide sm:grid`}>
              <span>Date</span>
              <span>Holding</span>
              <span>From / payee</span>
              <span>Amount</span>
            </div>
            {lines.map((line) => (
              <div key={line.id} className={ROW}>
                <span className="order-3 text-[13.5px] sm:order-none sm:text-center sm:text-sm">{shortDate(line.date)}</span>
                <span className="order-1 min-w-0 truncate font-semibold sm:order-none sm:text-center sm:font-normal">{line.holding}</span>
                <span className="order-4 min-w-0 truncate text-right text-[13.5px] sm:order-none sm:text-center sm:text-sm">{line.from ?? line.payee ?? ""}</span>
                <span className={`order-2 text-right font-semibold tabular-nums sm:order-none sm:text-center ${line.cents < 0 ? "text-negative" : ""}`}>
                  {formatMoney(line.cents, currency)}
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 px-3 py-2 font-bold">
              <span>{lines.length} {lines.length === 1 ? "transaction" : "transactions"}</span>
              <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </div>
          </div>
        ) : null}

        {total !== target.cents ? (
          <p className="mt-3 text-[13.5px]">
            {total === 0
              ? `No transactions on file. The ${formatMoney(target.cents, currency)} is a saved figure for ${year}.`
              : target.cents > total
              ? `${formatMoney(target.cents - total, currency)} of the ${formatMoney(target.cents, currency)} has no transaction behind it. It's a saved figure for ${year}.`
              : `The table's ${formatMoney(target.cents, currency)} is a saved figure for ${year}, not the sum of these.`}
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}
