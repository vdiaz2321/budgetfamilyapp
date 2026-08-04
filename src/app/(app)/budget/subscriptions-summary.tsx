"use client";

import { useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { DOT } from "./category-icons";
import { SubscriptionsModal } from "../subscriptions/subscriptions-modal";
import { updateSubscriptionDueDate } from "../subscriptions/actions";
import type { CreditCardOption } from "../subscriptions/subscriptions-board";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

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
  creditCards,
  open,
  onToggle,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  open: boolean;
  onToggle: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const activeSubs = subscriptions.filter((s) => s.isActive);
  const monthlyTotal = activeSubs
    .filter((s) => s.billingCycle === "monthly")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualBilledTotal = activeSubs
    .filter((s) => s.billingCycle === "annual")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualizedTotal = Math.round(monthlyTotal * 12);
  const cardMap = new Map((creditCards ?? []).map((c) => [c.id, c.name]));

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
            <>
              <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-background/40">
                <SummaryMetric label="Monthly total" value={formatMoney(Math.round(monthlyTotal), currency)} />
                <SummaryMetric label="Annual billed" value={formatMoney(annualBilledTotal, currency)} />
                <SummaryMetric label="Total annual" value={formatMoney(annualizedTotal, currency)} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted sm:grid-cols-[minmax(0,1.5fr)_6.5rem_7rem_minmax(0,1.2fr)]">
                <span>Name</span>
                <span className="text-right">Amount</span>
                <span className="hidden text-center sm:inline">Due</span>
                <span className="hidden sm:inline">Card</span>
              </div>
              <div className="divide-y divide-line">
              {subscriptions.map((s) => {
                const cardName = s.accountId ? cardMap.get(s.accountId) : null;
                return (
                  <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1.5fr)_6.5rem_7rem_minmax(0,1.2fr)]">
                    <span className={`min-w-0 truncate ${s.isActive ? "" : "text-muted line-through"}`}>{s.name}</span>
                    <span className="text-right font-medium tabular-nums">{formatMoney(s.amountCents, currency)}</span>
                    <span className="hidden sm:flex sm:items-center sm:justify-center">
                      <DueCell id={s.id} name={s.name} date={s.nextRenewalDate} billingCycle={s.billingCycle} />
                    </span>
                    <span className="hidden min-w-0 truncate text-xs text-muted sm:inline">{cardName ?? "—"}</span>
                  </div>
                );
              })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {managing ? (
        <SubscriptionsModal
          currency={currency}
          subscriptions={subscriptions}
          irregularBills={irregularBills}
          creditCards={creditCards}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2 text-center">
      <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function DueCell({
  id,
  name,
  date,
  billingCycle,
}: {
  id: string;
  name: string;
  date: string | null;
  billingCycle: SubscriptionRow["billingCycle"];
}) {
  const monthly = billingCycle === "monthly";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => dueInputValue(date, monthly));
  const [, start] = useTransition();
  const cancelled = useRef(false);

  function save() {
    const nextDate = buildDueDate(value, date, monthly);
    if (!nextDate) return;
    const form = new FormData();
    form.set("id", id);
    form.set("nextRenewalDate", nextDate);
    start(async () => {
      await updateSubscriptionDueDate(form);
      setEditing(false);
    });
  }

  function beginEditing() {
    cancelled.current = false;
    setValue(dueInputValue(date, monthly));
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="flex justify-center">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          placeholder={monthly ? "DD" : "MM/DD"}
          autoFocus
          aria-label={`Due date for ${name}`}
          onChange={(event) => setValue(event.target.value.replace(/[^\d/]/g, "").slice(0, 5))}
          onBlur={() => {
            if (!cancelled.current) save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") {
              cancelled.current = true;
              setEditing(false);
            }
          }}
          className="w-[6.5rem] rounded-lg bg-background px-1.5 py-1 text-center text-xs ring-1 ring-brand focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
    );
  }

  return (
    <span className="whitespace-nowrap text-center text-xs">
      {date ? (
        <RenewalBadge
          date={date}
          billingCycle={billingCycle}
          label={monthly ? date.slice(8, 10) : undefined}
          onClick={beginEditing}
        />
      ) : (
        <button
          type="button"
          onClick={beginEditing}
          className="rounded px-2 py-0.5 text-muted transition hover:bg-brand-soft hover:text-brand"
          aria-label={`Set due date for ${name}`}
        >
          —
        </button>
      )}
    </span>
  );
}

function dueInputValue(date: string | null, monthly: boolean) {
  if (!date) return "";
  return monthly ? String(Number(date.slice(8, 10))) : date.slice(5).replace("-", "/");
}

function buildDueDate(value: string, currentDate: string | null, monthly: boolean) {
  const today = new Date();
  const year = currentDate?.slice(0, 4) ?? String(today.getFullYear());
  const month = currentDate?.slice(5, 7) ?? String(today.getMonth() + 1).padStart(2, "0");

  if (monthly) {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    return `${year}-${month}-${String(day).padStart(2, "0")}`;
  }

  const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, monthValue, dayValue] = match;
  const monthNumber = Number(monthValue);
  const dayNumber = Number(dayValue);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

export function IrregularBillsSummaryCard({
  currency,
  subscriptions,
  irregularBills,
  creditCards,
  open,
  onToggle,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
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
          creditCards={creditCards}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </section>
  );
}

function RenewalBadge({
  date,
  billingCycle,
  label,
  onClick,
}: {
  date: string;
  billingCycle: SubscriptionRow["billingCycle"];
  label?: string;
  onClick?: () => void;
}) {
  const className = `rounded-full px-2 py-0.5 text-xs font-medium ${
    billingCycle === "monthly"
      ? "bg-positive/10 text-positive dark:bg-positive/20"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
  }`;
  const displayLabel = label ?? new Date(date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:brightness-95`} aria-label={`Edit due date ${displayLabel}`}>
      {displayLabel}
    </button>
  ) : (
    <span className={className}>{displayLabel}</span>
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
