"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney, centsToDisplay, currencySymbol } from "@/lib/money";
import { DOT } from "./category-icons";
import { reorderIrregularBills, reorderSubscriptions, updateIrregularBillTypical, updateSubscriptionDueDate } from "../subscriptions/actions";
import { CYCLE_LABEL, SubscriptionForm, type CreditCardOption, usePointerReorder } from "../subscriptions/subscriptions-board";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

const DragHandle = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export function SubscriptionsSummaryCard({
  currency,
  subscriptions,
  creditCards,
  open,
  onToggle,
  monthPlannedCents,
  monthSpentCents,
  onOpenSpent,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  creditCards?: CreditCardOption[];
  onOpenSpent?: () => void;
  open: boolean;
  onToggle: () => void;
  monthPlannedCents: number;
  monthSpentCents: number;
}) {
  const [editorTarget, setEditorTarget] = useState<string | "new" | null>(null);
  const [rows, setRows] = useState(subscriptions);
  const [, startReorder] = useTransition();
  useEffect(() => {
    const reset = window.setTimeout(() => setRows(subscriptions), 0);
    return () => window.clearTimeout(reset);
  }, [subscriptions]);
  const { dragOverId, startDrag } = usePointerReorder(rows, (next) => {
    setRows(next);
    startReorder(() => reorderSubscriptions(next.map((r) => r.id)));
  });
  const activeSubs = rows.filter((s) => s.isActive);
  const monthlyTotal = activeSubs
    .filter((s) => s.billingCycle === "monthly")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualBilledTotal = activeSubs
    .filter((s) => s.billingCycle === "annual")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualizedTotal = Math.round(monthlyTotal * 12) + annualBilledTotal;
  const cardMap = new Map((creditCards ?? []).map((c) => [c.id, c.name]));

  return (
    <section className="relative -mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-xl dark:ring-white/10">
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

        <div className="flex items-center gap-2 text-xs tabular-nums">
          {onOpenSpent ? (
            <button
              type="button"
              onClick={onOpenSpent}
              className="cursor-pointer grid grid-cols-1 gap-0.5 sm:grid-cols-[7rem_7rem] sm:gap-3 items-center rounded px-2 py-0.5 text-right text-muted transition hover:bg-brand-soft/50 hover:text-foreground"
            >
              <span>Plan: <span className="font-semibold text-foreground">{formatMoney(monthPlannedCents, currency)}</span></span>
              <span>Spent: <span className="font-semibold text-negative">{formatMoney(monthSpentCents, currency)}</span></span>
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[7rem_7rem] sm:gap-3 items-center px-2 py-0.5 text-right text-muted">
              <span>Plan: <span className="font-semibold text-foreground">{formatMoney(monthPlannedCents, currency)}</span></span>
              <span>Spent: <span className="font-semibold text-negative">{formatMoney(monthSpentCents, currency)}</span></span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setEditorTarget("new")}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-brand/30 px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand-soft"
          >
            + Add
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {subscriptions.length === 0 && editorTarget !== "new" ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted">No subscriptions yet.</p>
              <button
                type="button"
                onClick={() => setEditorTarget("new")}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
              >
                + Add one
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-background/40">
                <SummaryMetric label="Monthly total" value={formatMoney(Math.round(monthlyTotal), currency)} />
                <SummaryMetric label="Annual Total" value={formatMoney(annualBilledTotal, currency)} />
                <SummaryMetric label="Total Combined Annual" value={formatMoney(annualizedTotal, currency)} />
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted sm:grid-cols-[auto_minmax(0,1.4fr)_6rem_5rem_6.5rem_minmax(0,1fr)]">
                <span className="w-3" aria-hidden />
                <span>Name</span>
                <span className="text-right">Amount</span>
                <span className="hidden text-center sm:inline">Cycle</span>
                <span className="hidden text-center sm:inline">Due</span>
                <span className="hidden sm:inline">Card</span>
              </div>
              <div className="divide-y divide-line">
              {rows.map((s) => {
                const cardName = s.accountId ? cardMap.get(s.accountId) : null;
                const dragOver = dragOverId === s.id;
                return (
                  <div
                    key={s.id}
                    data-reorder-id={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditorTarget(s.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setEditorTarget(s.id);
                      }
                    }}
                    className={`group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm transition hover:bg-brand-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:grid-cols-[auto_minmax(0,1.4fr)_6rem_5rem_6.5rem_minmax(0,1fr)] ${dragOver ? "bg-brand-soft/40" : ""}`}
                  >
                    <span
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startDrag(s.id); }}
                      className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
                    >
                      {DragHandle}
                    </span>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`min-w-0 truncate ${s.isActive ? "" : "text-muted line-through"}`}>{s.name}</span>
                      {/* Due badge sits inline right of the name on mobile —
                          no extra row. On sm+ this hides and the dedicated
                          Due column to the right takes over. */}
                      <span className="shrink-0 sm:hidden" onClick={(event) => event.stopPropagation()}>
                        <DueCell id={s.id} name={s.name} date={s.nextRenewalDate} billingCycle={s.billingCycle} />
                      </span>
                    </div>
                    <span className="text-right font-medium tabular-nums">{formatMoney(s.amountCents, currency)}</span>
                    <span className="hidden text-center text-xs text-muted sm:inline">
                      {CYCLE_LABEL[s.billingCycle] ?? s.billingCycle}
                    </span>
                    <span className="hidden sm:flex sm:items-center sm:justify-center" onClick={(event) => event.stopPropagation()}>
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

      {editorTarget ? (
        <ModalShell
          title={editorTarget === "new" ? "Add subscription" : "Edit subscription"}
          onClose={() => setEditorTarget(null)}
          mobileAlign="top"
          className="sm:max-w-2xl"
        >
          <div className="px-5 py-4">
            <SubscriptionForm
              row={editorTarget === "new" ? null : rows.find((r) => r.id === editorTarget) ?? null}
              creditCards={creditCards}
              onDone={() => setEditorTarget(null)}
            />
          </div>
        </ModalShell>
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
  irregularBills,
  open,
  onToggle,
  onOpenSpent,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  open: boolean;
  onToggle: () => void;
  onOpenSpent?: () => void;
}) {
  const [rows, setRows] = useState(irregularBills);
  const [, startReorder] = useTransition();
  useEffect(() => {
    const reset = window.setTimeout(() => setRows(irregularBills), 0);
    return () => window.clearTimeout(reset);
  }, [irregularBills]);
  const { dragOverId, startDrag } = usePointerReorder(rows, (next) => {
    setRows(next);
    startReorder(() => reorderIrregularBills(next.map((r) => r.id)));
  });

  const totalPlanned = irregularBills.reduce((sum, b) => sum + b.typicalAmountCents, 0);
  const totalSpent = irregularBills.reduce((sum, b) => sum + (b.monthSpentCents ?? 0), 0);

  return (
    <section className="relative -mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-xl dark:ring-white/10">
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

        <div className="flex items-center gap-2 text-xs tabular-nums">
          {onOpenSpent ? (
            <button
              type="button"
              onClick={onOpenSpent}
              className="cursor-pointer grid grid-cols-1 gap-0.5 sm:grid-cols-[7rem_7rem] sm:gap-3 items-center rounded px-2 py-0.5 text-right text-muted transition hover:bg-brand-soft/50 hover:text-foreground"
            >
              <span>Plan: <span className="font-semibold text-foreground">{formatMoney(totalPlanned, currency)}</span></span>
              <span>Spent: <span className="font-semibold text-negative">{formatMoney(totalSpent, currency)}</span></span>
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[7rem_7rem] sm:gap-3 items-center px-2 py-0.5 text-right text-muted">
              <span>Plan: <span className="font-semibold text-foreground">{formatMoney(totalPlanned, currency)}</span></span>
              <span>Spent: <span className="font-semibold text-negative">{formatMoney(totalSpent, currency)}</span></span>
            </div>
          )}
          <span className="size-8 shrink-0" aria-hidden />
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {irregularBills.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted">No irregular bills yet. Add items via the budget settings.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              <div className="hidden grid-cols-[auto_minmax(0,1.5fr)_6.5rem_6.5rem_minmax(0,1.2fr)] items-center gap-3 bg-background/40 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted sm:grid">
                <span className="w-3" aria-hidden />
                <span>Item</span>
                <span className="text-right">Planned</span>
                <span className="pl-6 text-right">Spent</span>
                <span className="pl-4">Card used</span>
              </div>
              {rows.map((b) => {
                const dragOver = dragOverId === b.id;
                return (
                  <div
                    key={b.id}
                    data-reorder-id={b.id}
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm sm:grid-cols-[auto_minmax(0,1.5fr)_6.5rem_6.5rem_minmax(0,1.2fr)] ${dragOver ? "bg-brand-soft/40" : ""}`}
                  >
                    <span
                      onMouseDown={(e) => { e.preventDefault(); startDrag(b.id); }}
                      className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
                    >
                      {DragHandle}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    <div className="hidden justify-end sm:flex">
                      <IrregularPlannedInput id={b.id} typicalAmountCents={b.typicalAmountCents} currency={currency} />
                    </div>
                    <span className="hidden pl-6 text-right font-medium tabular-nums sm:block">
                      {formatMoney(b.monthSpentCents ?? 0, currency)}
                    </span>
                    <span className="hidden min-w-0 truncate pl-4 text-xs text-muted sm:block">
                      {b.monthAccountNames?.join(", ") || "—"}
                    </span>
                    <div className="flex shrink-0 items-center gap-2 sm:hidden">
                      <span className="text-xs text-muted">Plan</span>
                      <IrregularPlannedInput id={b.id} typicalAmountCents={b.typicalAmountCents} currency={currency} />
                      <span className="text-xs text-muted">Spent</span>
                      <span className="font-medium tabular-nums">{formatMoney(b.monthSpentCents ?? 0, currency)}</span>
                    </div>
                  </div>
                );
              })}
              <p className="px-4 py-2 text-[11px] text-muted">
                Spent amounts are pulled automatically from transactions. Set a Planned amount per item to budget ahead for occasional expenses — totals sync to the Bills category above.
              </p>
            </div>
          )}
        </div>
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  const dueSoon = billingCycle === "monthly" || (days >= 0 && days <= 30);
  const className = `rounded-full px-2 py-0.5 text-xs font-medium ${
    billingCycle === "monthly"
      ? "bg-positive/10 text-positive dark:bg-positive/20"
      : dueSoon
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-black/[0.04] text-muted dark:bg-white/[0.06]"
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

function IrregularPlannedInput({
  id,
  typicalAmountCents,
  currency,
}: {
  id: string;
  typicalAmountCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(typicalAmountCents);
  const initialValue = `${currencySymbol(currency)}${initial}`;

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => updateIrregularBillTypical(fd))}
      className="flex items-center"
    >
      <input type="hidden" name="id" value={id} />
      <input
        key={initial}
        name="typicalAmount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={initialValue}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initialValue) formRef.current?.requestSubmit();
        }}
        title="Type a value or calculation, for example $1200 + 75 - 30"
        className={`w-24 min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-sm font-medium text-foreground tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
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
