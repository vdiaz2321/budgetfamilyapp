"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney, centsToDisplay, currencySymbol } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { DOT } from "./category-icons";
import { reorderIrregularBills, reorderSubscriptions, updateIrregularBillTypical, updateSubscriptionAmount, updateSubscriptionDueDate } from "../subscriptions/actions";
import { CYCLE_LABEL, SubscriptionForm, type CreditCardOption, usePointerReorder } from "../subscriptions/subscriptions-board";
import { actualColorClass, remainingColorClass } from "./budget-row";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

// One column template for the header and every row, so a column added on one
// can't drift from the other. Mobile keeps Name / Plan / Left — Spent is the
// one of the three that can be inferred from the other two.
const ROW_COLS =
  "grid-cols-[auto_minmax(0,1fr)_4.75rem_4.75rem] sm:grid-cols-[auto_minmax(0,1.5fr)_4.75rem_4.75rem_4.75rem_4rem_5.5rem_minmax(0,0.85fr)]";

// Weekly and monthly charges come first — they are the ones that repeat inside
// the month you are looking at — then quarterly, then annual.
const CYCLE_RANK: Record<SubscriptionRow["billingCycle"], number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 2,
  annual: 3,
};

/**
 * Cycle, then due date. Monthly rows compare on the day of the month; annual
 * and quarterly rows compare on month-and-day, so they read in calendar order
 * (Jan → Dec) rather than by which happens to fall next. Rows with no due date
 * sort last within their cycle.
 */
function compareByCycleThenDue(a: SubscriptionRow, b: SubscriptionRow): number {
  const rank = CYCLE_RANK[a.billingCycle] - CYCLE_RANK[b.billingCycle];
  if (rank !== 0) return rank;
  const key = (s: SubscriptionRow) => {
    if (!s.nextRenewalDate) return "99-99";
    return s.billingCycle === "monthly" || s.billingCycle === "weekly"
      ? s.nextRenewalDate.slice(8, 10)
      : s.nextRenewalDate.slice(5);
  };
  const byDue = key(a).localeCompare(key(b));
  return byDue !== 0 ? byDue : a.name.localeCompare(b.name);
}

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
  overspentOnly = false,
}: {
  currency: string;
  subscriptions: SubscriptionRow[];
  creditCards?: CreditCardOption[];
  onOpenSpent?: () => void;
  open: boolean;
  onToggle: () => void;
  monthPlannedCents: number;
  monthSpentCents: number;
  /** Overspent view: list only the rows that went over, and say so. The Bills
   *  group can only report that "Subscriptions" is over by $0.62 — every
   *  subscription shares that one subcategory — so without this the overspent
   *  filter names the bucket but never the charge. */
  overspentOnly?: boolean;
}) {
  const [editorTarget, setEditorTarget] = useState<string | "new" | null>(null);
  // "By due" sorts the list as a calendar — cycle first so the every-month
  // charges group together, then the due date inside each cycle. "Manual" hands
  // it back to the saved sort_order and puts the drag handles back. The two
  // can't both be on: a hand-made order that a re-sort immediately undoes reads
  // as the drag failing.
  const [sortState, setSortState] = useSessionCollapse("subs-sort", () => ({ byDue: true }));
  const byDue = sortState.byDue;
  const [manualRows, setManualRows] = useState(subscriptions);
  const [, startReorder] = useTransition();
  useEffect(() => {
    const reset = window.setTimeout(() => setManualRows(subscriptions), 0);
    return () => window.clearTimeout(reset);
  }, [subscriptions]);
  const { dragOverId, startDrag } = usePointerReorder(manualRows, (next) => {
    setManualRows(next);
    startReorder(() => reorderSubscriptions(next.map((r) => r.id)));
  });
  const rows = byDue ? [...subscriptions].sort(compareByCycleThenDue) : manualRows;
  const isOver = (s: SubscriptionRow) => (s.monthSpentCents ?? 0) > (s.monthPlannedCents ?? 0);
  const visibleRows = overspentOnly ? rows.filter(isOver) : rows;
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT.bills}`} />
          <span className="font-semibold">Subscriptions</span>
          {overspentOnly ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-negative/15 px-2 py-0.5 text-[10px] font-semibold text-negative">
              {visibleRows.length} over plan
            </span>
          ) : null}
          <Chevron open={open} />
        </button>

        <div className="flex flex-wrap items-center justify-end gap-2 text-xs tabular-nums">
          {overspentOnly ? null : onOpenSpent ? (
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
          {overspentOnly ? null : (
            <div className="flex shrink-0 overflow-hidden rounded-lg text-[11px] ring-1 ring-line">
              {([true, false] as const).map((mode) => (
                <button
                  key={String(mode)}
                  type="button"
                  onClick={() => setSortState((current) => ({ ...current, byDue: mode }))}
                  aria-pressed={byDue === mode}
                  className={`px-2 py-1 font-medium transition ${
                    byDue === mode
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:bg-brand-soft/40 hover:text-foreground"
                  }`}
                >
                  {mode ? "By due" : "Manual"}
                </button>
              ))}
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
          {visibleRows.length === 0 && editorTarget !== "new" ? (
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
              {overspentOnly ? null : (
                <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-background/40">
                  <SummaryMetric label="Monthly total" value={formatMoney(Math.round(monthlyTotal), currency)} />
                  <SummaryMetric label="Annual Total" value={formatMoney(annualBilledTotal, currency)} />
                  <SummaryMetric label="Total Combined Annual" value={formatMoney(annualizedTotal, currency)} />
                </div>
              )}
              <div className={`grid items-center gap-3 border-b border-line px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted ${ROW_COLS}`}>
                <span className="w-3" aria-hidden />
                <span>Name</span>
                <span className="text-center">Plan</span>
                <span className="hidden text-center sm:inline">Spent</span>
                <span className="text-center">Left</span>
                <span className="hidden text-center sm:inline">Cycle</span>
                <span className="hidden text-center sm:inline">Due</span>
                <span className="hidden sm:inline">Card</span>
              </div>
              <div className="divide-y divide-line">
              {visibleRows.map((s) => {
                const cardName = s.accountId ? cardMap.get(s.accountId) : null;
                const planned = s.monthPlannedCents ?? 0;
                const spent = s.monthSpentCents ?? 0;
                const left = planned - spent;
                // Paid = this month's charge has already landed as a transaction.
                // The due badge goes quiet once it has; a date that is still
                // days away is only "coming up" while the money hasn't moved.
                const paid = planned > 0 && spent >= planned;
                // An annual sub in one of its eleven quiet months has no
                // figures for this month — "—" says that, where three $0.00s
                // read like real amounts. Its due month shows the numbers,
                // zeros included, because then the zero means "not paid yet".
                const offCycle = s.billingCycle !== "monthly" && planned === 0 && spent === 0;
                const money = (cents: number) => (offCycle ? "—" : formatMoney(cents, currency));
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
                    className={`group grid cursor-pointer items-center gap-3 px-4 py-2 text-sm transition hover:bg-brand-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${ROW_COLS} ${
                      !byDue && dragOverId === s.id ? "bg-brand-soft/40" : ""
                    }`}
                  >
                    {byDue ? (
                      <span className="w-3" aria-hidden />
                    ) : (
                      <span
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startDrag(s.id); }}
                        className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
                      >
                        {DragHandle}
                      </span>
                    )}
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`min-w-0 truncate ${s.isActive ? "" : "text-muted line-through"}`}>{s.name}</span>
                      {/* Due badge sits inline right of the name on mobile —
                          no extra row. On sm+ this hides and the dedicated
                          Due column to the right takes over. */}
                      <span className="shrink-0 sm:hidden" onClick={(event) => event.stopPropagation()}>
                        <DueCell id={s.id} name={s.name} date={s.nextRenewalDate} billingCycle={s.billingCycle} paid={paid} />
                      </span>
                    </div>
                    {/* Plan is this month's charge, not the sticker price: an
                        annual sub plans nothing in the eleven months it isn't
                        billed, which is what makes "am I under plan?" readable
                        row by row. */}
                    {offCycle ? (
                      <span className="text-center tabular-nums text-muted/50">—</span>
                    ) : (
                      <span onClick={(event) => event.stopPropagation()}>
                        <PlanInput id={s.id} amountCents={planned} currency={currency} />
                      </span>
                    )}
                    <span className={`hidden text-center tabular-nums sm:inline ${offCycle ? "text-muted/50" : actualColorClass("bills", spent)}`}>
                      {money(spent)}
                    </span>
                    <span className={`text-center tabular-nums ${offCycle ? "text-muted/50" : remainingColorClass("bills", left, planned)}`}>
                      {money(left)}
                    </span>
                    <span className="hidden text-center text-xs text-muted sm:inline">
                      {CYCLE_LABEL[s.billingCycle] ?? s.billingCycle}
                    </span>
                    <span className="hidden sm:flex sm:items-center sm:justify-center" onClick={(event) => event.stopPropagation()}>
                      <DueCell id={s.id} name={s.name} date={s.nextRenewalDate} billingCycle={s.billingCycle} paid={paid} />
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
  paid,
}: {
  id: string;
  name: string;
  date: string | null;
  billingCycle: SubscriptionRow["billingCycle"];
  /** This month's charge has already been paid — the badge stops nagging. */
  paid?: boolean;
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
          paid={paid}
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
  paid,
  label,
  onClick,
}: {
  date: string;
  billingCycle: SubscriptionRow["billingCycle"];
  paid?: boolean;
  label?: string;
  onClick?: () => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  const dueSoon = billingCycle === "monthly" || (days >= 0 && days <= 30);
  // Paid outranks the date. Claude renews on the 28th and was charged on the
  // 28th; an amber "coming up" badge on money that has already left the account
  // is telling you to act on something that is done.
  const className = `rounded-full px-2 py-0.5 text-xs font-medium ${
    paid
      ? "bg-black/[0.04] text-muted dark:bg-white/[0.06]"
      : billingCycle === "monthly"
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

/**
 * The Plan cell, editable in place.
 *
 * Clicking a row opens the full editor, which is the wrong weight for changing
 * a price — so this cell stops the click and puts the caret in the number
 * instead. It saves on blur, like every other inline money field.
 */
function PlanInput({
  id,
  amountCents,
  currency,
}: {
  id: string;
  amountCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(amountCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => updateSubscriptionAmount(fd))}
      className="flex items-center justify-center gap-px"
    >
      <input type="hidden" name="id" value={id} />
      <span className={`pointer-events-none select-none text-sm ${amountCents === 0 ? "text-muted/50" : "text-muted"}`}>
        {currencySymbol(currency)}
      </span>
      <input
        key={initial}
        name="amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        style={{
          width: `calc(${initial.replace(/[^0-9]/g, "").length}ch + ${
            initial.length - initial.replace(/[^0-9]/g, "").length
          } * 0.42ch)`,
        }}
        className={`min-w-0 rounded-md bg-transparent px-0 py-0.5 text-center text-sm font-medium tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${
          amountCents === 0 ? "text-muted/50" : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
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
