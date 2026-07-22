"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { DOT } from "./category-icons";
import { SubscriptionsModal } from "../subscriptions/subscriptions-modal";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

const CYCLE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  weekly: "Weekly",
};

function monthlyEquivalent(amountCents: number, cycle: string): number {
  switch (cycle) {
    case "annual":
      return amountCents / 12;
    case "quarterly":
      return amountCents / 3;
    case "weekly":
      return amountCents * (52 / 12);
    default:
      return amountCents;
  }
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const GearIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export function SubscriptionsSummaryCard({
  currency,
  subscriptions,
  irregularBills,
  open,
  onToggle,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const activeSubs = subscriptions.filter((s) => s.isActive);
  const monthlyTotal = activeSubs.reduce(
    (sum, s) => sum + monthlyEquivalent(s.amountCents, s.billingCycle),
    0,
  );

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT.bills}`} />
          <span className="font-semibold">Subscriptions</span>
          <Chevron open={open} />
        </button>

        <div className="flex items-center gap-3">
          {!open ? (
            <span className="text-sm font-bold tabular-nums text-muted">
              {formatMoney(Math.round(monthlyTotal), currency)}/mo
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setManaging(true)}
            aria-label="Manage subscriptions"
            className="rounded-lg p-1.5 text-muted transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            {GearIcon}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {subscriptions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted">No subscriptions yet.</p>
              <button
                type="button"
                onClick={() => setManaging(true)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
              >
                + Add one
              </button>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {subscriptions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className={`truncate ${s.isActive ? "" : "text-muted line-through"}`}>{s.name}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted">{CYCLE_LABEL[s.billingCycle] ?? s.billingCycle}</span>
                    {s.nextRenewalDate ? <RenewalBadge date={s.nextRenewalDate} /> : null}
                    <span className="w-20 text-right font-medium tabular-nums">
                      {formatMoney(s.amountCents, currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {managing ? (
        <SubscriptionsModal
          currency={currency}
          subscriptions={subscriptions}
          irregularBills={irregularBills}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </section>
  );
}

export function IrregularBillsSummaryCard({
  currency,
  subscriptions,
  irregularBills,
  open,
  onToggle,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const [managing, setManaging] = useState(false);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT.bills}`} />
          <span className="font-semibold">Irregular Bills</span>
          <Chevron open={open} />
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setManaging(true)}
            aria-label="Manage irregular bills"
            className="rounded-lg p-1.5 text-muted transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            {GearIcon}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {irregularBills.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted">No irregular bills yet.</p>
              <button
                type="button"
                onClick={() => setManaging(true)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
              >
                + Add one
              </button>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {irregularBills.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="truncate">{b.name}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted">Irregular</span>
                    <span className="w-20 text-right font-medium tabular-nums text-muted">
                      {b.typicalAmountCents ? formatMoney(b.typicalAmountCents, currency) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {managing ? (
        <SubscriptionsModal
          currency={currency}
          subscriptions={subscriptions}
          irregularBills={irregularBills}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </section>
  );
}

function RenewalBadge({ date }: { date: string }) {
  const days = daysUntil(date);
  const upcoming = days >= 0 && days <= 30;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        upcoming
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "text-muted"
      }`}
    >
      {new Date(date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
