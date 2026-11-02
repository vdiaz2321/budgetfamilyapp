"use client";

import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney, centsToDisplay, currencySymbol } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { ACC_HOVER, ADD_BTN, AccentEdge, SECTION_CLS, TAP_AREA, headerWash } from "./category-icons";
import { reorderIrregularBills, reorderSubscriptions, setIrregularBillMonthPlan, updateSubscriptionAmount, updateSubscriptionDueDate } from "../subscriptions/actions";
import { SubscriptionForm, type CreditCardOption, usePointerReorder } from "../subscriptions/subscriptions-board";
import { actualColorClass, progressLabel, remainingColorClass } from "./budget-row";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";
import type { TxData, TxPrefill } from "./types";
import { planNavKeyDown } from "./plan-nav";
import { MATCH_BTN_CLASS } from "./budget-row";
import { currentMonthStart } from "@/lib/subscription-renewal";

// One column template for the header and every row, so a column added on one
// can't drift from the other. Mobile keeps Name / Plan / Left — Spent is the
// one of the three that can be inferred from the other two. A wide card uses
// the budget groups' 14-column grid (name block 4, five tiles 2 each), so the
// cells sit under CardHeader's Planned / Spent / Remaining / Spent % / Total Yr
// tiles. It swaps on the card's width (@md), like the groups.
const ROW_COLS =
  "grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] gap-3 px-4 @md:grid-cols-14 @md:gap-2 @md:px-3";
const NAME_CELL = "flex min-w-0 items-center gap-2 @md:col-span-4";
const WIDE_CELL = "hidden text-center text-sm font-semibold tabular-nums @md:col-span-2 @md:block";
// Section-heading subtotal: the same slot, bold so it reads as a total.
const HEAD_WIDE = "hidden text-center text-sm font-bold tabular-nums @md:col-span-2 @md:block";
// Column-label version: same slot, the label row's own small caps text.
const WIDE_LABEL = "hidden text-center @md:col-span-2 @md:block";
// Same look as the budget groups' column-label row.
const LABEL_ROW = "items-center bg-background/40 py-2 text-[11px] font-bold uppercase tracking-wide text-muted";
// Irregular Bills: phones show the name, then Plan / Spent inline at the right.
const IRREGULAR_COLS =
  "items-center grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 @md:grid-cols-14 @md:gap-2 @md:px-3";

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

/** Weekly and monthly rows bill inside the month being viewed; the rest don't. */
function isMonthlyCycle(cycle: SubscriptionRow["billingCycle"]): boolean {
  return cycle === "monthly" || cycle === "weekly";
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
  monthFirstOfMonth,
  open,
  onToggle,
  monthPlannedCents,
  monthSpentCents,
  otherSpentCents = 0,
  onOpenSpent,
  overspentOnly = false,
  transactions = [],
  accountNameById,
  onEditTransaction,
  onAddTransaction,
  editRequestId = null,
  onEditRequestHandled,
  selectedId = null,
  onSelect,
}: {
  /** Charges on Subscriptions that match no subscription by payee. */
  otherSpentCents?: number;
  currency: string;
  subscriptions: SubscriptionRow[];
  /** First of the month being viewed (YYYY-MM-01) — the month a Plan edit
   *  applies to when the row isn't billed then. */
  monthFirstOfMonth: string;
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
  /** This month's transactions, so a row's editor can show the actual charge.
   *  Rows carry `monthTxIds` — the ids the server matched to them. */
  transactions?: TxData[];
  accountNameById?: Map<string, string>;
  onEditTransaction?: (tx: TxData) => void;
  onAddTransaction?: (prefill?: TxPrefill) => void;
  /** Opens this subscription's editor from outside the card — the Due this
   *  week list uses it so clicking a subscription there edits it in place. */
  editRequestId?: string | null;
  onEditRequestHandled?: () => void;
  /** With this, a row click opens that subscription's rail panel (its
   *  charges, like any budget item) instead of the editor. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [editorTarget, setEditorTarget] = useState<string | "new" | null>(null);
  const planLocked = monthFirstOfMonth < currentMonthStart();
  useEffect(() => {
    if (!editRequestId) return;
    const open = window.setTimeout(() => {
      setEditorTarget(editRequestId);
      onEditRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(open);
  }, [editRequestId, onEditRequestHandled]);
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
  // Manual drag stays inside a section: dropping a monthly row onto an annual
  // one would save an order the split list can't show, so it's ignored.
  const dragFrom = useRef<string | null>(null);
  const { dragOverId, startDrag: startPointerDrag } = usePointerReorder(manualRows, (next) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from) {
      const oldIndex = manualRows.findIndex((r) => r.id === from);
      const newIndex = next.findIndex((r) => r.id === from);
      const target = next[newIndex > oldIndex ? newIndex - 1 : newIndex + 1];
      if (target && isMonthlyCycle(target.billingCycle) !== isMonthlyCycle(next[newIndex].billingCycle)) return;
    }
    setManualRows(next);
    startReorder(() => reorderSubscriptions(next.map((r) => r.id)));
  });
  const startDrag = (id: string) => {
    dragFrom.current = id;
    startPointerDrag(id);
  };
  // Monthly open, Annual shut: the yearly rows show "—" eleven months of the
  // year, so they stay folded until wanted.
  const [sectionOpen, setSectionOpen] = useSessionCollapse("subs-sections", () => ({ monthly: true, annual: false }));
  const rows = byDue ? [...subscriptions].sort(compareByCycleThenDue) : manualRows;
  const isOver = (s: SubscriptionRow) => (s.monthSpentCents ?? 0) > (s.monthPlannedCents ?? 0);
  const visibleRows = overspentOnly ? rows.filter(isOver) : rows;
  const monthlyRows = visibleRows.filter((s) => isMonthlyCycle(s.billingCycle));
  const yearlyRows = visibleRows.filter((s) => !isMonthlyCycle(s.billingCycle));
  const yearlyLabel = yearlyRows.some((s) => s.billingCycle === "quarterly")
    ? yearlyRows.some((s) => s.billingCycle === "annual") ? "Annual & quarterly" : "Quarterly"
    : "Annual";
  const activeSubs = rows.filter((s) => s.isActive);
  const monthlyTotal = activeSubs
    .filter((s) => s.billingCycle === "monthly")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualBilledTotal = activeSubs
    .filter((s) => s.billingCycle === "annual")
    .reduce((sum, s) => sum + s.amountCents, 0);
  const annualizedTotal = Math.round(monthlyTotal * 12) + annualBilledTotal;
  const cardMap = new Map((creditCards ?? []).map((c) => [c.id, c.name]));
  // The row the editor is open on, and the transactions the server matched to
  // it this month. Looked up by id rather than filtered by payee again so the
  // list can never disagree with the Spent figure in the row.
  const editorRow = editorTarget && editorTarget !== "new"
    ? rows.find((r) => r.id === editorTarget) ?? null
    : null;
  const editorTxIds = new Set(editorRow?.monthTxIds ?? []);
  const editorTxs = transactions.filter((t) => editorTxIds.has(t.id));

  const renderRow = (s: SubscriptionRow) => {
            const cardName = s.accountId ? cardMap.get(s.accountId) : null;
            const planned = s.monthPlannedCents ?? 0;
            const spent = s.monthSpentCents ?? 0;
            const left = planned - spent;
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
                onClick={() => (onSelect ? onSelect(s.id) : setEditorTarget(s.id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (onSelect) onSelect(s.id);
                    else setEditorTarget(s.id);
                  }
                }}
                className={`group grid cursor-pointer items-center py-2 text-sm transition hover:bg-brand-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${ROW_COLS} ${
                  !byDue && dragOverId === s.id ? "bg-brand-soft/40" : ""
                } ${selectedId === s.id ? "bg-sky-50 dark:bg-sky-950/40" : ""}`}
              >
                {/* Name block: handle, name with its card under it (wide
                    card only), and the Due pill — right after the name on
                    a phone, lined up at the block's right edge when wide. */}
                <div className={NAME_CELL}>
                  {byDue ? (
                    <span className="w-3 shrink-0" aria-hidden />
                  ) : (
                    <span
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startDrag(s.id); }}
                      className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
                    >
                      {DragHandle}
                    </span>
                  )}
                  <span className="min-w-0 leading-tight">
                    <span className={`block truncate ${s.isActive ? "" : "text-muted line-through"}`}>{s.name}</span>
                    {cardName ? (
                      <span className="hidden truncate text-[11px] text-foreground/80 @md:block">{cardName}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 @md:ml-auto" onClick={(event) => event.stopPropagation()}>
                    <DueCell id={s.id} name={s.name} date={s.nextRenewalDate} billingCycle={s.billingCycle} />
                  </span>
                </div>
                {/* Plan is this month's charge, not the sticker price: an
                    annual sub plans nothing in the eleven months it isn't
                    billed, which is what makes "am I under plan?" readable
                    row by row. */}
                {offCycle ? (
                  <span className="text-center tabular-nums text-muted/50 @md:col-span-2">—</span>
                ) : planLocked ? (
                  // A finished month plans what was charged — nothing to edit.
                  <span className="text-center text-sm tabular-nums @md:col-span-2">{formatMoney(planned, currency)}</span>
                ) : (
                  <span className="@md:col-span-2" onClick={(event) => event.stopPropagation()}>
                    <PlanInput
                      id={s.id}
                      amountCents={planned}
                      spentCents={spent}
                      currency={currency}
                      month={monthFirstOfMonth}
                      perMonth={s.chargesThisMonth === false}
                    />
                  </span>
                )}
                <span className={`${WIDE_CELL} ${offCycle ? "text-muted/50" : actualColorClass("bills", spent)}`}>
                  {money(spent)}
                </span>
                <span className={`text-center tabular-nums @md:col-span-2 @md:text-sm @md:font-semibold ${offCycle ? "text-muted/50" : remainingColorClass("bills", left, planned)}`}>
                  {money(left)}
                </span>
                <span className={`${WIDE_CELL} ${offCycle ? "text-muted/50" : remainingColorClass("bills", left, planned)}`}>
                  {offCycle ? "—" : progressLabel("bills", spent, planned)}
                </span>
                {/* Year to date for this one subscription, matched the
                    same way its monthly Spent is — an annual renewal that
                    already billed in March still shows here in September. */}
                <span className={`${WIDE_CELL} ${(s.ytdSpentCents ?? 0) === 0 ? "text-muted/50" : "text-foreground"}`}>
                  {formatMoney(s.ytdSpentCents ?? 0, currency)}
                </span>
              </div>
            );
  };

  return (
    <section className={SECTION_CLS} style={{ "--acc": "var(--viz-bills)" } as CSSProperties}>
      <CardHeader
        name="Subscriptions"
        open={open}
        onToggle={onToggle}
        overCount={overspentOnly ? visibleRows.length : null}
        plannedCents={monthPlannedCents}
        spentCents={monthSpentCents}
        ytdCents={subscriptions.reduce((sum, s) => sum + (s.ytdSpentCents ?? 0), 0)}
        currency={currency}
        onOpenSpent={onOpenSpent}
        onAdd={() => setEditorTarget("new")}
      />

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
                  {/* The dots are the Due pills' colours — the key to which
                      rows bill monthly and which yearly, now that the Cycle
                      column is gone. */}
                  <SummaryMetric label="Monthly total" dot={CYCLE_PILL.monthly} value={formatMoney(Math.round(monthlyTotal), currency)} />
                  <SummaryMetric label="Annual Total" dot={CYCLE_PILL.other} value={formatMoney(annualBilledTotal, currency)} />
                  <SummaryMetric label="Total Combined Annual" value={formatMoney(annualizedTotal, currency)} />
                </div>
              )}
              <div className={`grid border-b border-line/60 ${LABEL_ROW} ${ROW_COLS}`}>
                <span className={NAME_CELL}>
                  <span className="w-3 shrink-0" aria-hidden />
                  Name
                  {/* The sort sits over the column it sorts, and only once the
                      card is open — in the header it crowded out the name. */}
                  {overspentOnly ? null : (
                    <span className="flex shrink-0 overflow-hidden rounded-lg text-[11px] font-medium normal-case tracking-normal ring-1 ring-[color-mix(in_srgb,var(--acc)_30%,var(--border))]">
                      {([true, false] as const).map((mode) => (
                        <button
                          key={String(mode)}
                          type="button"
                          onClick={() => setSortState((current) => ({ ...current, byDue: mode }))}
                          aria-pressed={byDue === mode}
                          className={`px-2 py-0.5 transition ${
                            byDue === mode
                              ? "bg-[color-mix(in_srgb,var(--acc)_18%,var(--surface))] text-foreground"
                              : "text-foreground hover:bg-[color-mix(in_srgb,var(--acc)_10%,var(--surface))]"
                          }`}
                        >
                          {mode ? "By due" : "Manual"}
                        </button>
                      ))}
                    </span>
                  )}
                  {/* Over the Due pills, which sit at the right of the name block. */}
                  <span className="ml-auto hidden @md:inline">Due</span>
                </span>
                <span className="text-center @md:col-span-2">Plan</span>
                <span className={WIDE_LABEL}>Spent</span>
                <span className="text-center @md:col-span-2">Left</span>
                <span className={WIDE_LABEL}>Spent %</span>
                <span className={WIDE_LABEL}>Total Yr Spent</span>
              </div>
              <div className="divide-y divide-line">
              {overspentOnly ? (
                visibleRows.map(renderRow)
              ) : (
                <>
                  {monthlyRows.length > 0 ? (
                    <CycleSectionHeading
                      label="Monthly"
                      dot={CYCLE_PILL.monthly}
                      bar="var(--color-teal-400)"
                      rows={monthlyRows}
                      open={sectionOpen.monthly}
                      onToggle={() => setSectionOpen((c) => ({ ...c, monthly: !c.monthly }))}
                      currency={currency}
                    />
                  ) : null}
                  {sectionOpen.monthly ? monthlyRows.map(renderRow) : null}
                  {yearlyRows.length > 0 ? (
                    <CycleSectionHeading
                      label={yearlyLabel}
                      dot={CYCLE_PILL.other}
                      bar="var(--color-sky-400)"
                      rows={yearlyRows}
                      open={sectionOpen.annual}
                      onToggle={() => setSectionOpen((c) => ({ ...c, annual: !c.annual }))}
                      currency={currency}
                    />
                  ) : null}
                  {sectionOpen.annual ? yearlyRows.map(renderRow) : null}
                </>
              )}
              {!overspentOnly && otherSpentCents > 0 ? (
                <OtherChargesRow spentCents={otherSpentCents} planLocked={planLocked} currency={currency} />
              ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Portalled: the card is its own stacking context (`isolate`), so a popup
          left in here sits under the Summary rail wherever the two overlap. */}
      {editorTarget ? createPortal(
        <ModalShell
          title={editorTarget === "new" ? "Add subscription" : "Edit subscription"}
          onClose={() => setEditorTarget(null)}
          mobileAlign="top"
          className="sm:max-w-2xl"
        >
          <div className="space-y-4 px-5 py-4">
            {editorRow ? (
              <MonthPayments
                txs={editorTxs}
                currency={currency}
                plannedCents={editorRow.monthPlannedCents ?? 0}
                accountNameById={accountNameById ?? new Map()}
                onEdit={onEditTransaction ? (tx) => { setEditorTarget(null); onEditTransaction(tx); } : undefined}
                onAdd={
                  onAddTransaction
                    ? () => {
                        setEditorTarget(null);
                        onAddTransaction({
                          cents: remainingPrefill(editorRow.monthPlannedCents ?? 0, editorRow.monthSpentCents ?? 0, editorRow.amountCents),
                          accountId: editorRow.accountId,
                          payee: editorRow.name,
                          subId: editorRow.subcategoryId,
                          kind: "bills",
                        });
                      }
                    : undefined
                }
              />
            ) : null}
            <SubscriptionForm
              row={editorRow}
              creditCards={creditCards}
              onDone={() => setEditorTarget(null)}
            />
          </div>
        </ModalShell>,
        document.body,
      ) : null}
    </section>
  );
}

/**
 * Fold-up heading over one cycle's rows. Pale sage like the other heading rows
 * over a table, with the cycle's Due-pill colour as the left bar and dot, so it
 * keys to the Monthly / Annual Total figures above. Its subtotals sit in every
 * column, zeros included, so a folded section still reads.
 */
function CycleSectionHeading({
  label,
  dot,
  bar,
  rows,
  open,
  onToggle,
  currency,
}: {
  label: string;
  dot: string;
  bar: string;
  rows: SubscriptionRow[];
  open: boolean;
  onToggle: () => void;
  currency: string;
}) {
  const plan = rows.reduce((sum, s) => sum + (s.monthPlannedCents ?? 0), 0);
  const spent = rows.reduce((sum, s) => sum + (s.monthSpentCents ?? 0), 0);
  const left = plan - spent;
  const ytd = rows.reduce((sum, s) => sum + (s.ytdSpentCents ?? 0), 0);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`grid w-full cursor-pointer items-center bg-[color-mix(in_srgb,var(--positive)_8%,var(--surface))] py-2 text-left text-sm transition hover:bg-[color-mix(in_srgb,var(--positive)_14%,var(--surface))] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${ROW_COLS}`}
      style={{ boxShadow: `inset 4px 0 0 ${bar}` }}
    >
      <span className={NAME_CELL}>
        <Chevron open={open} />
        <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ring-1 ${dot}`} />
        <span className="truncate font-bold uppercase tracking-wide">{label}</span>
        <span className="shrink-0 text-xs font-semibold text-foreground/80">{rows.length}</span>
      </span>
      <span className="text-center font-bold tabular-nums @md:col-span-2">{formatMoney(plan, currency)}</span>
      <span className={`${HEAD_WIDE} ${actualColorClass("bills", spent)}`}>{formatMoney(spent, currency)}</span>
      <span className={`text-center font-bold tabular-nums @md:col-span-2 @md:text-sm ${remainingColorClass("bills", left, plan)}`}>
        {formatMoney(left, currency)}
      </span>
      <span className={`${HEAD_WIDE} ${remainingColorClass("bills", left, plan)}`}>{progressLabel("bills", spent, plan)}</span>
      <span className={`${HEAD_WIDE}`}>{formatMoney(ytd, currency)}</span>
    </button>
  );
}

function SummaryMetric({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="min-w-0 px-3 py-2 text-center">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
        {dot ? <span aria-hidden className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ring-1 ${dot}`} /> : null}
        {label}
      </p>
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
          className="w-[6.5rem] rounded-lg bg-sky-50 dark:bg-background px-1.5 py-1 text-center text-xs ring-1 ring-brand focus:outline-none focus:ring-2 focus:ring-brand"
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
  monthFirstOfMonth,
  plannedTotalCents,
  irregularBills,
  open,
  onToggle,
  onOpenSpent,
  overspentOnly = false,
  dormantBills = [],
  otherSpentCents = 0,
  transactions = [],
  accountNameById,
  onEditTransaction,
  onAddTransaction,
}: {
  currency: string;
  monthFirstOfMonth: string;
  /** Charges on Irregular Bills that match no bill by payee. */
  otherSpentCents?: number;
  /** Month total for the header. Usually the sum of the rows below, but for
      months predating this card it falls back to the subcategory's own
      planned figure so the header matches the Bills group row. */
  plannedTotalCents: number;
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  open: boolean;
  onToggle: () => void;
  onOpenSpent?: () => void;
  /** Overspent view: list only the bills that spent more than they planned.
   *  The shared "Irregular Bills" subcategory can sit under its own plan while
   *  single bills spent against $0, so the Bills group alone never names them. */
  overspentOnly?: boolean;
  /** Bills the year filter is holding back, offered as one-click "plan it
   *  again" chips at the foot of the list. */
  dormantBills?: { id: string; name: string; typicalAmountCents: number }[];
  /** Same as the Subscriptions card: this month's rows, so a bill can show
   *  which charges its Spent figure is made of. */
  transactions?: TxData[];
  accountNameById?: Map<string, string>;
  onEditTransaction?: (tx: TxData) => void;
  onAddTransaction?: (prefill?: TxPrefill) => void;
}) {
  const [rows, setRows] = useState(irregularBills);
  // The bill whose payments popup is open, if any.
  const [paymentsFor, setPaymentsFor] = useState<string | null>(null);
  const [, startReorder] = useTransition();
  useEffect(() => {
    const reset = window.setTimeout(() => setRows(irregularBills), 0);
    return () => window.clearTimeout(reset);
  }, [irregularBills]);
  const { dragOverId, startDrag } = usePointerReorder(rows, (next) => {
    setRows(next);
    startReorder(() => reorderIrregularBills(next.map((r) => r.id)));
  });

  // Planned is per month — an irregular bill has no plan in a month it isn't
  // expected to hit, so a fresh month totals $0 until amounts are entered.
  const totalPlanned = plannedTotalCents;
  // "Other" charges count too, so the header matches the Bills group row.
  const totalSpent = irregularBills.reduce((sum, b) => sum + (b.monthSpentCents ?? 0), 0) + otherSpentCents;
  // A finished month plans what was charged — the Planned cells are fixed.
  const planLocked = monthFirstOfMonth < currentMonthStart();
  const isOver = (b: IrregularBillRow) => (b.monthSpentCents ?? 0) > (b.plannedCents ?? 0);
  const visibleRows = overspentOnly ? rows.filter(isOver) : rows;
  const paymentsBill = paymentsFor ? rows.find((b) => b.id === paymentsFor) ?? null : null;
  const paymentsTxIds = new Set(paymentsBill?.monthTxIds ?? []);
  const paymentsTxs = transactions.filter((t) => paymentsTxIds.has(t.id));

  return (
    <section className={SECTION_CLS} style={{ "--acc": "var(--viz-bills)" } as CSSProperties}>
      <CardHeader
        name="Irregular Bills"
        open={open}
        onToggle={onToggle}
        overCount={overspentOnly ? visibleRows.length : null}
        plannedCents={totalPlanned}
        spentCents={totalSpent}
        ytdCents={irregularBills.reduce((sum, b) => sum + (b.ytdSpentCents ?? 0), 0)}
        currency={currency}
        onOpenSpent={onOpenSpent}
      />

      {open ? (
        <div className="border-t border-line">
          {visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted">
                {dormantBills.length > 0
                  ? "Nothing on this year's list yet. Irregular bills are one-offs, so each year starts empty — pick one below to plan it again."
                  : "No irregular bills yet. Add items via the budget settings."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {/* Same 14 columns as the header: Planned and Spent under
                  theirs, Total Yr under its tile; a bill has no Remaining or
                  Spent % of its own, so those two cells stay empty. */}
              <div className={`hidden ${LABEL_ROW} ${IRREGULAR_COLS} @md:grid`}>
                <span className={NAME_CELL}>
                  <span className="w-3 shrink-0" aria-hidden />
                  Item
                </span>
                <span className={WIDE_LABEL}>Planned</span>
                <span className={WIDE_LABEL}>Spent</span>
                <span className="hidden @md:col-span-2 @md:block" aria-hidden />
                <span className="hidden @md:col-span-2 @md:block" aria-hidden />
                <span className={WIDE_LABEL}>Total Yr Spent</span>
              </div>
              {visibleRows.map((b) => {
                const dragOver = dragOverId === b.id;
                return (
                  // The whole row opens the bill's payments — only the
                  // Planned cell and the drag handle keep their own behaviour,
                  // since those are the two things you do IN the row.
                  <div
                    key={b.id}
                    data-reorder-id={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPaymentsFor(b.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPaymentsFor(b.id);
                      }
                    }}
                    className={`grid cursor-pointer py-2 text-sm transition hover:bg-brand-soft/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${IRREGULAR_COLS} ${dragOver ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className={NAME_CELL}>
                      {/* Dragging a FILTERED list would save an order built
                          from the rows that happen to be over — handle off. */}
                      {overspentOnly ? (
                        <span className="w-3 shrink-0" aria-hidden />
                      ) : (
                        <span
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startDrag(b.id); }}
                          className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-1 text-muted/40 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
                        >
                          {DragHandle}
                        </span>
                      )}
                      {/* The card(s) it was paid on sit under the name on a
                          wide card — the Card used column is gone. */}
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate">{b.name}</span>
                        {b.monthAccountNames?.length ? (
                          <span className="hidden truncate text-[11px] text-foreground/80 @md:block">{b.monthAccountNames.join(", ")}</span>
                        ) : null}
                      </span>
                    </div>
                    <div
                      className="hidden justify-center @md:col-span-2 @md:flex"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {planLocked ? (
                        <span className="text-sm tabular-nums">{formatMoney(b.plannedCents ?? 0, currency)}</span>
                      ) : (
                        <IrregularPlannedInput id={b.id} month={monthFirstOfMonth} plannedCents={b.plannedCents ?? 0} spentCents={b.monthSpentCents ?? 0} currency={currency} />
                      )}
                    </div>
                    <span className={`${WIDE_CELL}`}>
                      {formatMoney(b.monthSpentCents ?? 0, currency)}
                    </span>
                    <span className="hidden @md:col-span-2 @md:block" aria-hidden />
                    <span className="hidden @md:col-span-2 @md:block" aria-hidden />
                    <span className={`${WIDE_CELL} ${(b.ytdSpentCents ?? 0) === 0 ? "text-muted/50" : "text-foreground"}`}>
                      {formatMoney(b.ytdSpentCents ?? 0, currency)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2 @md:hidden">
                      <span className="text-xs text-muted">Plan</span>
                      <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                        {planLocked ? (
                          <span className="font-medium tabular-nums">{formatMoney(b.plannedCents ?? 0, currency)}</span>
                        ) : (
                          <IrregularPlannedInput id={b.id} month={monthFirstOfMonth} plannedCents={b.plannedCents ?? 0} spentCents={b.monthSpentCents ?? 0} currency={currency} />
                        )}
                      </span>
                      <span className="text-xs text-muted">Spent</span>
                      <span className="font-medium tabular-nums">{formatMoney(b.monthSpentCents ?? 0, currency)}</span>
                    </div>
                  </div>
                );
              })}
              {!overspentOnly && otherSpentCents > 0 ? (
                <OtherChargesRow variant="irregular" spentCents={otherSpentCents} planLocked={planLocked} currency={currency} />
              ) : null}
            </div>
          )}

          {!overspentOnly && dormantBills.length > 0 ? (
            <DormantBills bills={dormantBills} month={monthFirstOfMonth} currency={currency} />
          ) : null}
        </div>
      ) : null}

      {/* Portalled for the same reason as the subscription editor. */}
      {paymentsBill ? createPortal(
        <ModalShell
          title={paymentsBill.name}
          onClose={() => setPaymentsFor(null)}
          mobileAlign="top"
          className="sm:max-w-lg"
        >
          <div className="px-5 py-4">
            <MonthPayments
              txs={paymentsTxs}
              currency={currency}
              plannedCents={paymentsBill.plannedCents ?? 0}
              accountNameById={accountNameById ?? new Map()}
              onEdit={onEditTransaction ? (tx) => { setPaymentsFor(null); onEditTransaction(tx); } : undefined}
              onAdd={
                onAddTransaction
                  ? () => {
                      const bill = paymentsBill;
                      setPaymentsFor(null);
                      onAddTransaction({
                        cents: remainingPrefill(bill.plannedCents ?? 0, bill.monthSpentCents ?? 0, bill.typicalAmountCents),
                        accountId: bill.accountId,
                        payee: bill.name,
                        subId: bill.subcategoryId,
                        kind: "bills",
                      });
                    }
                  : undefined
              }
            />
          </div>
        </ModalShell>,
        document.body,
      ) : null}
    </section>
  );
}

// Charges logged on Subscriptions / Irregular Bills whose payee matches no
// row (a Nintendo game, a $127 eye exam). Listed so the card adds up to its
// Budget row. A finished month plans what was charged; this month plans $0.
function OtherChargesRow({
  variant = "subscriptions",
  spentCents,
  planLocked,
  currency,
}: {
  variant?: "subscriptions" | "irregular";
  spentCents: number;
  planLocked: boolean;
  currency: string;
}) {
  const planned = planLocked ? spentCents : 0;
  const left = planned - spentCents;
  const nameCell = (
    <span className={NAME_CELL}>
      <span className="w-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">Other</span>
    </span>
  );
  if (variant === "irregular") {
    return (
      <div className={`grid py-2 text-sm ${IRREGULAR_COLS}`}>
        {nameCell}
        <span className={`${WIDE_CELL}`}>{formatMoney(planned, currency)}</span>
        <span className={`${WIDE_CELL}`}>{formatMoney(spentCents, currency)}</span>
        <div className="flex shrink-0 items-center gap-2 @md:hidden">
          <span className="text-xs text-muted">Plan</span>
          <span className="font-medium tabular-nums">{formatMoney(planned, currency)}</span>
          <span className="text-xs text-muted">Spent</span>
          <span className="font-medium tabular-nums">{formatMoney(spentCents, currency)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`grid items-center py-2 text-sm ${ROW_COLS}`}>
      {nameCell}
      <span className="text-center text-sm tabular-nums @md:col-span-2">{formatMoney(planned, currency)}</span>
      <span className={`${WIDE_CELL} ${actualColorClass("bills", spentCents)}`}>{formatMoney(spentCents, currency)}</span>
      <span className={`text-center tabular-nums @md:col-span-2 @md:text-sm @md:font-semibold ${remainingColorClass("bills", left, planned)}`}>{formatMoney(left, currency)}</span>
      <span className={`${WIDE_CELL} ${remainingColorClass("bills", left, planned)}`}>{progressLabel("bills", spentCents, planned)}</span>
    </div>
  );
}

const CYCLE_PILL = {
  monthly: "bg-teal-100 text-teal-800 ring-teal-300 dark:bg-teal-900/50 dark:text-teal-200 dark:ring-teal-700",
  other: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:ring-sky-700",
} as const;

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
  // Two colours only, by how often it bills: teal every month (or week),
  // sky once a year (or quarter). The Cycle column that spelled it out is
  // gone (Victor, 2026-09-30); the dots on Monthly / Annual Total are the key.
  // Paid and due-soon no longer recolour the pill.
  const className = `rounded-full px-2 py-0.5 text-xs font-medium ${
    billingCycle === "monthly" || billingCycle === "weekly" ? CYCLE_PILL.monthly : CYCLE_PILL.other
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
  spentCents,
  currency,
  month,
  perMonth,
}: {
  id: string;
  amountCents: number;
  spentCents: number;
  currency: string;
  month: string;
  /** True in a month this subscription doesn't bill: the number typed here
   *  budgets that month alone instead of changing the subscription's price. */
  perMonth: boolean;
}) {
  const [pending, start] = useTransition();
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = `${currencySymbol(currency)}${centsToDisplay(amountCents)}`;
  // Same offer the budget rows make: a charge that came in over (or under)
  // plan is nearly always fixed by planning what was actually spent. Nothing
  // to match on an untouched row, and no point when the two already agree.
  const canMatch = spentCents > 0 && spentCents !== amountCents;

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => updateSubscriptionAmount(fd))}
      className="relative flex items-center justify-center gap-px"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="perMonth" value={perMonth ? "1" : "0"} />
      {focused && canMatch ? (
        <button
          type="button"
          // pointerdown lands before the input's blur, so preventing its
          // default keeps focus — and therefore this button — alive long
          // enough for the tap to register. A mousedown handler is too late
          // on iOS.
          onPointerDown={(e) => {
            e.preventDefault();
            const el = inputRef.current;
            if (!el) return;
            el.value = centsToDisplay(spentCents);
            formRef.current?.requestSubmit();
            el.blur();
          }}
          className={`absolute bottom-full left-1/2 -translate-x-1/2 ${MATCH_BTN_CLASS}`}
        >
          Match spent ({formatMoney(spentCents, currency)})
        </button>
      ) : null}
      <input
        key={`${month}:${initial}`}
        ref={inputRef}
        name="amount"
        data-plan-nav=""
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={initial}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
            return;
          }
          planNavKeyDown(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-full max-w-24 min-w-0 rounded-md bg-transparent px-1 py-0.5 text-center text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${
          amountCents === 0 ? "text-muted/50" : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
  );
}

function IrregularPlannedInput({
  id,
  month,
  plannedCents,
  spentCents,
  currency,
}: {
  id: string;
  month: string;
  plannedCents: number;
  spentCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = centsToDisplay(plannedCents);
  const initialValue = `${currencySymbol(currency)}${initial}`;
  // Same offer the budget rows and the Subscriptions card make: a bill that
  // came in over (or under) plan is nearly always fixed by planning what was
  // actually spent.
  const canMatch = spentCents > 0 && spentCents !== plannedCents;

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setIrregularBillMonthPlan(fd))}
      className="relative flex items-center"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="month" value={month} />
      {focused && canMatch ? (
        <button
          type="button"
          // pointerdown lands before the input's blur, so preventing its
          // default keeps focus — and therefore this button — alive long
          // enough for the tap to register. A mousedown handler is too late
          // on iOS.
          onPointerDown={(e) => {
            e.preventDefault();
            const el = inputRef.current;
            if (!el) return;
            el.value = `${currencySymbol(currency)}${centsToDisplay(spentCents)}`;
            formRef.current?.requestSubmit();
            el.blur();
          }}
          className={`absolute bottom-full right-0 ${MATCH_BTN_CLASS}`}
        >
          Match spent ({formatMoney(spentCents, currency)})
        </button>
      ) : null}
      <input
        key={`${month}:${initial}`}
        ref={inputRef}
        name="planned"
        data-plan-nav=""
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={initialValue}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onKeyDown={planNavKeyDown}
        onBlur={(e) => {
          setFocused(false);
          if (e.currentTarget.value !== initialValue) formRef.current?.requestSubmit();
        }}
        className={`w-24 min-w-0 rounded-md bg-transparent px-1 py-0.5 text-center text-sm text-foreground tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:text-foreground focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Header for the Subscriptions and Irregular Bills cards, built like a budget
// group's header so the three sit as one list: on a wide card the same
// 14-column grid, so Planned / Spent / Remaining / Spent % / Total Yr land
// under the group rows' five tiles; on a narrow one the name, then the
// totals on a second line. `onAdd` gets the same "+" as the groups. The overspent view drops the totals — they'd be whole-card
// figures over a filtered list.
function CardHeader({
  name,
  open,
  onToggle,
  overCount,
  plannedCents,
  spentCents,
  ytdCents,
  currency,
  onOpenSpent,
  onAdd,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  overCount: number | null;
  plannedCents: number;
  spentCents: number;
  ytdCents: number;
  currency: string;
  onOpenSpent?: () => void;
  onAdd?: () => void;
}) {
  const remainingCents = plannedCents - spentCents;
  const showTotals = overCount === null;
  // `narrow` is the wide-card header's step-down: like the budget groups, the
  // name drops to 14px while the card is under @3xl. The phone header keeps
  // its size.
  const nameButton = (narrow: boolean) => (
    <button type="button" onClick={onToggle} className={`flex min-w-0 items-center ${narrow ? "gap-1.5" : "gap-2"} text-left`} aria-expanded={open}>
      <Chevron open={open} />
      <span className={`truncate font-semibold ${narrow ? "@max-3xl:text-[14px]" : ""}`}>{name}</span>
      {overCount !== null ? (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-negative/15 px-2 py-0.5 text-[10px] font-semibold text-negative">
          {overCount} over plan
        </span>
      ) : null}
    </button>
  );
  const tiles: { label: string; value: string; color: string; onClick?: () => void }[] = [
    { label: "Planned", value: formatMoney(plannedCents, currency), color: "text-foreground", onClick: onOpenSpent },
    { label: "Spent", value: formatMoney(spentCents, currency), color: actualColorClass("bills", spentCents), onClick: onOpenSpent },
    { label: "Remaining", value: formatMoney(remainingCents, currency), color: remainingColorClass("bills", remainingCents, plannedCents) },
    { label: "Spent %", value: progressLabel("bills", spentCents, plannedCents), color: remainingColorClass("bills", remainingCents, plannedCents) },
    { label: "Total Yr Spent", value: formatMoney(ytdCents, currency), color: "text-foreground" },
  ];

  return (
    <>
      <AccentEdge />
      {/* Narrow card */}
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 @md:hidden">
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={headerWash(open)} />
        {nameButton(false)}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Same "100% spent" readout as the budget groups' phone header. */}
          {showTotals ? (
            <span className={`whitespace-nowrap text-[11px] font-bold tabular-nums ${remainingColorClass("bills", remainingCents, plannedCents)}`}>
              {progressLabel("bills", spentCents, plannedCents)} spent
            </span>
          ) : null}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              aria-label={`Add ${name} item`}
              className={`flex shrink-0 cursor-pointer items-center rounded-md px-1.5 py-1 transition ${TAP_AREA} ${ADD_BTN}`}
            >
              <PlusIcon size={10} />
            </button>
          ) : null}
        </div>
        {showTotals ? (
          <span className="w-full whitespace-nowrap pl-[23px] text-xs tabular-nums">
            <span className="font-medium text-foreground">{formatMoney(plannedCents, currency)} / </span>
            <span className={`font-semibold ${actualColorClass("bills", spentCents)}`}>{formatMoney(spentCents, currency)}</span>
            <span className="font-medium text-foreground"> · Total Yr {formatMoney(ytdCents, currency)}</span>
          </span>
        ) : null}
      </div>

      {/* Wide card — same columns as the budget group header */}
      <div className="relative hidden grid-cols-14 items-center gap-2 px-3 py-2.5 @md:grid">
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={headerWash(open)} />
        {/* "+" sits in the name column, as on the budget groups, so the
            five tiles land under theirs. */}
        <div className="col-span-4 flex min-w-0 items-center gap-2">
          {nameButton(true)}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              aria-label={`Add ${name} item`}
              className={`ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${ADD_BTN}`}
            >
              <PlusIcon size={11} />
            </button>
          ) : null}
        </div>
        {showTotals
          ? tiles.map((t) => {
              const body = (
                <>
                  <span className="block whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-foreground">{t.label}</span>
                  <span className={`block text-[12px] font-bold @xl:text-[13px] @2xl:text-sm ${t.color}`}>{t.value}</span>
                </>
              );
              const cls = "col-span-2 min-w-0 rounded-md px-0 py-1 text-center leading-tight tabular-nums";
              return t.onClick ? (
                <button key={t.label} type="button" onClick={t.onClick} className={`${cls} cursor-pointer ${ACC_HOVER}`}>
                  {body}
                </button>
              ) : (
                <div key={t.label} className={cls}>{body}</div>
              );
            })
          : null}
      </div>
    </>
  );
}

function PlusIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-[color:var(--acc)] transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * What to prefill a new payment with: whatever is still unpaid this month,
 * falling back to the row's usual amount once the plan is fully covered — a
 * second charge on an already-paid row would otherwise open at $0.00.
 */
export function remainingPrefill(plannedCents: number, spentCents: number, fallbackCents: number): number {
  const remaining = plannedCents - spentCents;
  return remaining > 0 ? remaining : fallbackCents;
}

/**
 * This month's charges for one subscription or irregular bill: whether the
 * money actually moved, and the transactions it moved as. Both cards derive
 * their Spent figure by matching transactions to the row's name, so until now
 * a row could say "$1.99 spent" without ever showing WHICH charge that was —
 * the thing every other budget item shows in its detail panel.
 */
export function MonthPayments({
  txs,
  currency,
  plannedCents,
  accountNameById,
  onEdit,
  onAdd,
}: {
  txs: TxData[];
  currency: string;
  plannedCents: number;
  accountNameById: Map<string, string>;
  onEdit?: (tx: TxData) => void;
  onAdd?: () => void;
}) {
  const spent = txs.reduce((sum, t) => sum + t.amountCents, 0);
  // "Paid" only means something against a plan. A row with no plan this month
  // (an annual sub in a quiet month) is neither paid nor unpaid — it just has
  // whatever charges landed.
  const status =
    plannedCents > 0 && spent < plannedCents
      ? { label: "Partly paid", className: "text-negative" }
      : { label: "Paid", className: "text-positive" };
  const dateLabel = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${MONTHS[m - 1]} ${d}`;
  };

  return (
    <div className="rounded-xl bg-background/60 p-3 ring-1 ring-line">
      {txs.length === 0 ? (
        <p className="px-1 text-xs text-foreground">No charge logged for this month yet.</p>
      ) : (
        <ul className="space-y-1">
          {txs.map((t, i) => {
            const acct = t.accountId ? accountNameById.get(t.accountId) : null;
            const content = (
              <>
                <span className="w-12 shrink-0 whitespace-nowrap tabular-nums text-muted">{dateLabel(t.date)}</span>
                <span className="min-w-0 flex-1 truncate text-left">
                  <span className="font-medium">{t.payee ?? "—"}</span>
                  {acct ? <span className="ml-1 text-muted">· {acct}</span> : null}
                </span>
                {i === 0 && (
                  <span className={`shrink-0 font-semibold ${status.className}`}>{status.label}</span>
                )}
                <span className="shrink-0 tabular-nums text-negative">
                  {formatMoney(t.amountCents, currency)}
                </span>
              </>
            );
            return (
              <li key={t.id}>
                {onEdit && !t.isCardPayment ? (
                  <button
                    type="button"
                    onClick={() => onEdit(t)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-xs transition hover:bg-surface-raised/60"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 px-1 py-1.5 text-xs">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong"
        >
          + Add transaction
        </button>
      ) : null}
    </div>
  );
}

/**
 * Bills from earlier years that this year's list is not carrying. Clicking one
 * plans it for the viewed month at its usual amount, which is exactly what puts
 * it back on the list — no second row with the same name, and the amount is
 * editable inline the moment it appears.
 */
function DormantBills({
  bills,
  month,
  currency,
}: {
  bills: { id: string; name: string; typicalAmountCents: number }[];
  month: string;
  currency: string;
}) {
  const [pending, startPlan] = useTransition();
  const [planningId, setPlanningId] = useState<string | null>(null);

  return (
    <div className="border-t border-line px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Not on {month.slice(0, 4)}&apos;s list
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {bills.map((bill) => (
          <button
            key={bill.id}
            type="button"
            disabled={pending && planningId === bill.id}
            onClick={() => {
              setPlanningId(bill.id);
              const fd = new FormData();
              fd.append("id", bill.id);
              fd.append("month", month);
              fd.append("planned", centsToDisplay(bill.typicalAmountCents));
              startPlan(async () => { await setIrregularBillMonthPlan(fd); });
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs transition hover:border-sky-400 hover:bg-sky-100 disabled:opacity-50 dark:hover:bg-sky-900/30"
          >
            <span>{bill.name}</span>
            <span className="tabular-nums text-muted">{formatMoney(bill.typicalAmountCents, currency)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

