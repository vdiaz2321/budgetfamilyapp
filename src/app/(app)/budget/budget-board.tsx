"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { setRollover } from "./actions";
import { BudgetGroup } from "./budget-group";
import { MonthPicker } from "./month-picker";
import { ItemPanel } from "./item-panel";
import { TransactionsPanel } from "./transactions-panel";
import { TransactionModal } from "./transaction-modal";
import { SummaryPanel } from "./summary-panel";
import type {
  AccountOption,
  BucketOption,
  GroupData,
  MonthNav,
  RowData,
  SubOption,
  TxData,
} from "./types";

type Props = {
  month: MonthNav;
  currency: string;
  groups: GroupData[];
  incomePlanned: number;
  outflowPlanned: number;
  leftToBudget: number;
  rollover: {
    inCents: number; // amount actually rolled in this month (0 if excluded)
    availableCents: number; // last month's leftover, regardless of the toggle
    enabled: boolean; // is last month's leftover included in this month?
    prevMonthLabel: string;
  };
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  debtAccountOptions: AccountOption[];
  bucketOptions: BucketOption[];
  snowballExtraCents: number;
  snowballFocusSubId: string | null;
  transactions: TxData[];
};

export function BudgetBoard({
  month,
  currency,
  groups,
  incomePlanned,
  outflowPlanned,
  leftToBudget,
  rollover,
  subOptions,
  accountOptions,
  debtAccountOptions,
  bucketOptions,
  snowballExtraCents,
  snowballFocusSubId,
  transactions,
}: Props) {
  const [railTab, setRailTab] = useState<"summary" | "transactions">("transactions");
  const [selected, setSelected] = useState<{ subId: string; kind: CategoryKind } | null>(null);
  // Each group's open/collapsed state, persisted per-session (survives
  // navigating away and back, resets on a fresh login) — same pattern as
  // Net Worth / Accounts. Groups default open.
  const [openGroups, setOpenGroups] = useSessionCollapse("budget-sections-open", () =>
    Object.fromEntries(groups.map((g) => [g.categoryId, true])),
  );
  const toggleGroup = (categoryId: string) =>
    setOpenGroups((o) => ({ ...o, [categoryId]: !(o[categoryId] ?? true) }));
  // Set from the item panel's "+ Add transaction" button so it doesn't
  // require switching to the Log tab first.
  const [quickAdd, setQuickAdd] = useState(false);

  // Waterfall: assignments spend this month's own income first; any shortfall
  // then draws down the rolled-in buffer, and only once that's exhausted does
  // "left to budget" actually go negative. Keeps the two numbers split while
  // making the rollover real spendable money.
  const ownLeft = leftToBudget; // incomePlanned − outflowPlanned
  const rolloverDrawn = Math.min(Math.max(0, -ownLeft), rollover.inCents);
  const displayLeft = ownLeft + rolloverDrawn; // 0 while the buffer covers it

  // Actuals for the pill: what's actually been received vs actually spent so
  // far this month (income group's spent = money received).
  const actualIncome = groups
    .filter((g) => g.kind === "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);
  const actualSpent = groups
    .filter((g) => g.kind !== "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);
  // What's really left of the cash you've actually received this month.
  const actualLeft = actualIncome - actualSpent;

  // Re-derive the selected row from fresh data each render so the panel
  // reflects saved values (and clears if the row was deleted).
  const selectedRow: RowData | null = selected
    ? groups.flatMap((g) => g.rows).find((r) => r.subId === selected.subId) ?? null
    : null;

  const itemPanel =
    selected && selectedRow ? (
      <ItemPanel
        row={selectedRow}
        kind={selected.kind}
        currency={currency}
        monthKey={month.firstOfMonth}
        debtAccountOptions={debtAccountOptions}
        bucketOptions={bucketOptions}
        snowballExtraCents={snowballExtraCents}
        isSnowballFocus={selected.subId === snowballFocusSubId}
        onClose={() => setSelected(null)}
        onAddTransaction={() => setQuickAdd(true)}
      />
    ) : null;

  return (
    // `items-start` would leave the right rail (aside) exactly as tall as its
    // own content — shorter than the budget column next to it — which caps
    // how far its `sticky` child can travel before running out of room in
    // its own container and getting dragged back up off-screen. Default
    // (stretch) cross-axis sizing makes the aside match the row height so
    // the sticky panel has the whole scroll range to stay pinned in.
    // See feedback: item detail panel required scrolling up to reach.
    <div className="mx-auto flex max-w-5xl justify-center gap-6">
      {/* Budget column */}
      <div className="w-full min-w-0 max-w-[620px] space-y-4">
        <MonthPicker monthKey={month.key} />

        {/* Left-to-budget hero card */}
        <SummaryHeroCard
          actualLeft={actualLeft}
          displayLeft={displayLeft}
          incomePlanned={incomePlanned}
          outflowPlanned={outflowPlanned}
          actualIncome={actualIncome}
          actualSpent={actualSpent}
          currency={currency}
        />

        {/* Wrapping this in `relative` gives the sticky footer bar below a
            containing block that spans the whole rollover+groups list, so it
            stays pinned to the top of the viewport for as long as that list
            is in view, instead of unsticking the instant its own row scrolls
            past — see feedback: "freeze on top when I scroll down". */}
        <div className="relative space-y-4">
          <StickyFooterBar
            actualIncome={actualIncome}
            actualSpent={actualSpent}
            actualLeft={actualLeft}
            displayLeft={displayLeft}
            outflowPlanned={outflowPlanned}
            currency={currency}
          />

          {/* Rollover: include last month's leftover cash in this month */}
          <RolloverBar
            monthFirstOfMonth={month.firstOfMonth}
            rollover={rollover}
            currency={currency}
          />

          {/* Groups */}
          <div className="space-y-3">
            {groups.map((group) => (
              <BudgetGroup
                key={group.categoryId}
                group={group}
                currency={currency}
                monthKey={month.firstOfMonth}
                selectedSubId={selected?.subId ?? null}
                onSelectRow={(row, kind) => setSelected({ subId: row.subId, kind })}
                open={openGroups[group.categoryId] ?? true}
                onToggle={() => toggleGroup(group.categoryId)}
                snowballFocusSubId={snowballFocusSubId}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right rail: item detail when selected, otherwise Summary / Log */}
      <aside className="hidden w-[360px] shrink-0 lg:block">
        <div className="sticky top-20 space-y-3">
          {itemPanel ?? (
            <>
              {/* Summary | Transactions toggle */}
              <div className="grid grid-cols-2 rounded-xl bg-surface p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                <button
                  type="button"
                  onClick={() => setRailTab("summary")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                    railTab === "summary"
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
                  </svg>
                  Summary
                </button>
                <button
                  type="button"
                  onClick={() => setRailTab("transactions")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                    railTab === "transactions"
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <span className="font-bold">$</span>
                  Transactions
                </button>
              </div>

              {railTab === "summary" ? (
                <SummaryPanel groups={groups} currency={currency} />
              ) : (
                <TransactionsPanel
                  monthKey={month.key}
                  monthLabel={month.label}
                  firstOfMonth={month.firstOfMonth}
                  currency={currency}
                  transactions={transactions}
                  subOptions={subOptions}
                  accountOptions={accountOptions}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* Mobile: item detail slides over */}
      {itemPanel ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[380px] overflow-y-auto bg-background p-2">
            {itemPanel}
          </div>
        </div>
      ) : null}

      {quickAdd && selected ? (
        <TransactionModal
          editTx={null}
          monthKey={month.key}
          firstOfMonth={month.firstOfMonth}
          subOptions={subOptions}
          accountOptions={accountOptions}
          initialKind={selected.kind}
          initialSubId={selected.subId}
          onClose={() => setQuickAdd(false)}
        />
      ) : null}
    </div>
  );
}

type BudgetTone = "good" | "warn" | "bad";

const TONE_CLASSES: Record<BudgetTone, { text: string; badge: string; icon: string }> = {
  good: { text: "text-positive", badge: "bg-positive/15 text-positive", icon: "M5 12l4 4L19 6" },
  warn: {
    text: "text-warning",
    badge: "bg-warning/15 text-warning",
    icon: "M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
  },
  bad: {
    text: "text-negative",
    badge: "bg-negative/15 text-negative",
    icon: "M12 9v4m0 4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  },
};

function getBudgetStatus(
  actualLeft: number,
  displayLeft: number,
  actualSpent: number,
  outflowPlanned: number,
): { tone: BudgetTone; badgeText: string } {
  const expenseRatio = outflowPlanned > 0 ? actualSpent / outflowPlanned : 0;
  if (actualLeft < 0) return { tone: "bad", badgeText: "Over budget" };
  if (expenseRatio >= 0.9 || actualLeft < displayLeft * 0.15) {
    return { tone: "warn", badgeText: `Tight — ${Math.round(expenseRatio * 100)}% spent` };
  }
  return { tone: "good", badgeText: "On track" };
}

function ProgressBar({
  label,
  arrow,
  actual,
  planned,
  fillClassName,
  currency,
}: {
  label: string;
  arrow: "up" | "down";
  actual: number;
  planned: number;
  fillClassName: string;
  currency: string;
}) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={arrow === "up" ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M5 12l7 7 7-7"} />
          </svg>
          {label}
        </span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{formatMoney(actual, currency)}</span>{" "}
          <span className="text-muted">/ {formatMoney(planned, currency)} planned</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-line/60">
        <div
          className={`h-full rounded-full transition-[width] duration-400 ease-out ${fillClassName}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SummaryHeroCard({
  actualLeft,
  displayLeft,
  incomePlanned,
  outflowPlanned,
  actualIncome,
  actualSpent,
  currency,
}: {
  actualLeft: number;
  displayLeft: number;
  incomePlanned: number;
  outflowPlanned: number;
  actualIncome: number;
  actualSpent: number;
  currency: string;
}) {
  const { tone, badgeText } = getBudgetStatus(actualLeft, displayLeft, actualSpent, outflowPlanned);
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div className="rounded-2xl bg-surface px-6 py-6 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted">Remaining to spend</p>
          <p className={`text-4xl font-medium tabular-nums ${toneClasses.text}`}>
            {formatMoney(actualLeft, currency)}
          </p>
          <span
            className={`mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${toneClasses.badge}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={toneClasses.icon} />
            </svg>
            {badgeText}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-muted">Budget planned</p>
          <p className="text-2xl font-medium tabular-nums text-foreground">
            {formatMoney(displayLeft, currency)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <ProgressBar
          label="Income"
          arrow="up"
          actual={actualIncome}
          planned={incomePlanned}
          fillClassName="bg-positive"
          currency={currency}
        />
        <ProgressBar
          label="Expenses"
          arrow="down"
          actual={actualSpent}
          planned={outflowPlanned}
          fillClassName="bg-negative"
          currency={currency}
        />
      </div>
    </div>
  );
}

// Split out from SummaryHeroCard so it can be rendered as its own sticky
// element — its containing block is the `relative` wrapper in BudgetBoard
// that spans the rollover bar + group list, so it stays pinned to the top of
// the viewport across that whole scroll region instead of unsticking after
// only its own row height.
function StickyFooterBar({
  actualIncome,
  actualSpent,
  actualLeft,
  displayLeft,
  outflowPlanned,
  currency,
}: {
  actualIncome: number;
  actualSpent: number;
  actualLeft: number;
  displayLeft: number;
  outflowPlanned: number;
  currency: string;
}) {
  const { tone } = getBudgetStatus(actualLeft, displayLeft, actualSpent, outflowPlanned);
  const toneClasses = TONE_CLASSES[tone];

  return (
    // No explicit z-index here on purpose: giving a `position: sticky`
    // element a z-index promotes it to its own stacking context, and in
    // testing that made it paint ABOVE `position: fixed` modals (z-50)
    // regardless of the z-index value. Leaving it `auto` still paints it
    // above normal in-flow siblings (positioned elements paint after
    // non-positioned ones), which is all that's needed for it to sit above
    // the budget groups scrolling underneath — see feedback: sticky bar was
    // covering the Add Transaction modal.
    <div className="sticky top-4 grid grid-cols-3 rounded-2xl bg-surface px-6 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="text-center">
        <p className="text-lg font-medium tabular-nums text-foreground">
          {formatMoney(actualIncome, currency)}
        </p>
        <p className="text-xs text-muted">Received</p>
      </div>
      <div className="border-l border-line text-center">
        <p className="text-lg font-medium tabular-nums text-foreground">
          {formatMoney(actualSpent, currency)}
        </p>
        <p className="text-xs text-muted">Spent</p>
      </div>
      <div className={`border-l border-line text-center ${toneClasses.text}`}>
        <p className="text-lg font-medium tabular-nums">{formatMoney(actualLeft, currency)}</p>
        <p className="text-xs text-muted">Left</p>
      </div>
    </div>
  );
}

function RolloverBar({
  monthFirstOfMonth,
  rollover,
  currency,
}: {
  monthFirstOfMonth: string;
  rollover: Props["rollover"];
  currency: string;
}) {
  const [pending, start] = useTransition();
  const { availableCents, enabled, prevMonthLabel } = rollover;

  // Nothing left over from last month, and it isn't already on → no control.
  if (availableCents <= 0 && !enabled) return null;

  const amount = formatMoney(Math.max(0, availableCents), currency);

  return (
    <form
      action={(fd) => start(() => setRollover(fd))}
      className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-sm ring-1 ${
        enabled
          ? "bg-brand-soft/50 ring-brand/30"
          : "bg-surface ring-black/5 dark:ring-white/10"
      }`}
    >
      <input type="hidden" name="month" value={monthFirstOfMonth} />
      {/* Toggling: submit the opposite of the current state. */}
      <input type="hidden" name="enable" value={enabled ? "" : "on"} />
      <span className={enabled ? "text-brand" : "text-muted"}>
        {enabled ? (
          <>
            Including <span className="font-semibold tabular-nums">{amount}</span> rolled in from{" "}
            {prevMonthLabel}
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{amount}</span> left unspent in {prevMonthLabel}
          </>
        )}
      </span>
      <button
        type="submit"
        disabled={pending}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
          enabled
            ? "text-brand hover:bg-white/40 dark:hover:bg-white/10"
            : "bg-brand text-white hover:bg-brand-strong"
        }`}
      >
        {pending ? "Saving…" : enabled ? "Undo" : "Roll in"}
      </button>
    </form>
  );
}
