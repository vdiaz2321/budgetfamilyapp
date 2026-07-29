"use client";

import { useEffect, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { copyPlansFromPreviousMonth, setRollover } from "./actions";
import { BudgetGroup } from "./budget-group";
import { MonthPicker } from "./month-picker";
import { ItemPanel } from "./item-panel";
import { TransactionsPanel } from "./transactions-panel";
import { TransactionModal } from "./transaction-modal";
import { SummaryPanel } from "./summary-panel";
import { SubscriptionsSummaryCard, IrregularBillsSummaryCard } from "./subscriptions-summary";
import { BulkAddSubcategories } from "./bulk-add-subcategories";
import type {
  AccountOption,
  BucketOption,
  BucketsByAccount,
  GroupData,
  MonthNav,
  PayeeLineItem,
  RowData,
  SubOption,
  TxData,
} from "./types";
import type { CreditCardOption } from "../subscriptions/subscriptions-board";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

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
  bucketsByAccount?: BucketsByAccount;
  payeeOptions: { id: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
  snowballExtraCents: number;
  snowballFocusSubId: string | null;
  transactions: TxData[];
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
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
  bucketsByAccount = {},
  payeeOptions,
  payeeLineItems = [],
  snowballExtraCents,
  snowballFocusSubId,
  transactions,
  subscriptions,
  irregularBills,
  creditCards,
}: Props) {
  const [railTab, setRailTab] = useState<"summary" | "transactions">("summary");
  useEffect(() => {
    const saved = sessionStorage.getItem("budget-rail-tab");
    // Browser-only preference hydration; the initial state is SSR-safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "summary" || saved === "transactions") setRailTab(saved);
  }, []);
  useEffect(() => {
    sessionStorage.setItem("budget-rail-tab", railTab);
  }, [railTab]);
  const [selected, setSelected] = useState<{ subId: string; kind: CategoryKind } | null>(null);
  // Each group's open/collapsed state, persisted per-session (survives
  // navigating away and back, resets on a fresh login) — same pattern as
  // Net Worth / Accounts. Groups default open.
  const [openGroups, setOpenGroups] = useSessionCollapse("budget-sections-open", () =>
    Object.fromEntries([...groups.map((g) => [g.categoryId, false]), ["subscriptions", false], ["irregularBills", false]]),
  );
  const toggleGroup = (categoryId: string) =>
    setOpenGroups((o) => ({ ...o, [categoryId]: !(o[categoryId] ?? false) }));
  // Set from the item panel's "+ Add transaction" button so it doesn't
  // require switching to the Log tab first. `true` = new; a TxData = edit
  // (opened by clicking a row in the panel's "This month" list).
  const [quickAdd, setQuickAdd] = useState<boolean | TxData>(false);
  // Fresh transaction modal opened from the top header's "+ Add Item"
  // button — no preselected item/kind, renders as a centered overlay so it
  // works with or without a selected budget row.
  const [showAddModal, setShowAddModal] = useState(false);

  // Precompute account_id → name so the item panel's tx list can render each
  // row's account without re-scanning accountOptions on every entry.
  const accountNameById = new Map(accountOptions.map((a) => [a.id, a.name]));

  // Planned to Budget = (income planned − outflow planned) + any rolled-in
  // leftover. The rollover is real spendable money, so it always adds to the
  // displayed number — not just when covering a deficit.
  const ownLeft = leftToBudget; // incomePlanned − outflowPlanned
  const displayLeft = ownLeft + rollover.inCents;

  // Actuals for the pill: what's actually been received vs actually spent so
  // far this month (income group's spent = money received).
  const actualIncome = groups
    .filter((g) => g.kind === "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);
  const actualSpent = groups
    .filter((g) => g.kind !== "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);

  const kindTotals = (kinds: string[]) => ({
    planned: groups.filter((g) => kinds.includes(g.kind)).reduce((s, g) => s + g.plannedTotal, 0),
    spent: groups.filter((g) => kinds.includes(g.kind)).reduce((s, g) => s + g.spentTotal, 0),
  });
  const billsExpenses = kindTotals(["bills", "expenses"]);
  const savings = kindTotals(["savings"]);
  const debt = kindTotals(["debt"]);

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
        transactions={transactions}
        accountNameById={accountNameById}
        onClose={() => setSelected(null)}
        onAddTransaction={() => setQuickAdd(true)}
        onEditTransaction={(tx) => setQuickAdd(tx)}
      />
    ) : null;

  // Quick-add (from the item panel's "+ Add transaction") takes over the
  // same right-rail slot as the item panel — anchored where the budget list
  // stays visible, instead of a centered overlay.
  const railContent =
    quickAdd && selected ? (
      <TransactionModal
        editTx={quickAdd === true ? null : quickAdd}
        monthKey={month.key}
        firstOfMonth={month.firstOfMonth}
        subOptions={subOptions}
        accountOptions={accountOptions}
        bucketsByAccount={bucketsByAccount}
        payeeOptions={payeeOptions}
        payeeLineItems={payeeLineItems}
        initialKind={selected.kind}
        initialSubId={selected.subId}
        onClose={() => setQuickAdd(false)}
      />
    ) : (
      itemPanel
    );

  return (
    // `items-start` would leave the right rail (aside) exactly as tall as its
    // own content — shorter than the budget column next to it — which caps
    // how far its `sticky` child can travel before running out of room in
    // its own container and getting dragged back up off-screen. Default
    // (stretch) cross-axis sizing makes the aside match the row height so
    // the sticky panel has the whole scroll range to stay pinned in.
    // See feedback: item detail panel required scrolling up to reach.
    <div className="mx-auto max-w-5xl space-y-4">
      <TopHeader
        monthKey={month.key}
        monthFirstOfMonth={month.firstOfMonth}
        prevMonthLabel={rollover.prevMonthLabel}
        onAddItem={() => setShowAddModal(true)}
      />
      <div className="flex justify-center gap-6">
      {/* Budget column */}
      <div className="w-full min-w-0 max-w-[620px] space-y-4">
        {/* Left-to-budget hero card */}
        <SummaryHeroCard
          actualLeft={actualLeft}
          displayLeft={displayLeft}
          incomePlanned={incomePlanned}
          outflowPlanned={outflowPlanned}
          actualIncome={actualIncome}
          actualSpent={actualSpent}
          billsExpenses={billsExpenses}
          savings={savings}
          debt={debt}
          rolloverCents={rollover.inCents}
          rollover={rollover}
          monthFirstOfMonth={month.firstOfMonth}
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

          <div className="flex justify-end">
            <BulkAddSubcategories groups={groups} />
          </div>

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
                open={openGroups[group.categoryId] ?? false}
                onToggle={() => toggleGroup(group.categoryId)}
              />
            ))}

            <SubscriptionsSummaryCard
              currency={currency}
              subscriptions={subscriptions}
              irregularBills={irregularBills}
              creditCards={creditCards}
              open={openGroups["subscriptions"] ?? false}
              onToggle={() => toggleGroup("subscriptions")}
            />

            <IrregularBillsSummaryCard
              currency={currency}
              subscriptions={subscriptions}
              irregularBills={irregularBills}
              creditCards={creditCards}
              open={openGroups["irregularBills"] ?? false}
              onToggle={() => toggleGroup("irregularBills")}
            />
          </div>
        </div>
      </div>

      {/* Right rail: item detail when selected, otherwise Summary / Log */}
      <aside className="hidden w-[360px] shrink-0 lg:block">
        <div className="sticky top-20 space-y-3">
          {railContent ?? (
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
                  bucketsByAccount={bucketsByAccount}
                  payeeOptions={payeeOptions}
                  payeeLineItems={payeeLineItems}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* Mobile: item detail / quick-add slides over */}
      {railContent ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => (quickAdd ? setQuickAdd(false) : setSelected(null))}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[380px] overflow-y-auto bg-background p-2">
            {railContent}
          </div>
        </div>
      ) : null}

      {/* Header "+ Add Item" opens a centered fresh transaction modal. */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10">
          <div className="w-full max-w-[520px]">
            <TransactionModal
              editTx={null}
              monthKey={month.key}
              firstOfMonth={month.firstOfMonth}
              subOptions={subOptions}
              accountOptions={accountOptions}
              bucketsByAccount={bucketsByAccount}
              payeeOptions={payeeOptions}
              payeeLineItems={payeeLineItems}
              onClose={() => setShowAddModal(false)}
            />
          </div>
        </div>
      ) : null}
      </div>
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
  if (actualLeft < 0) return { tone: "bad", badgeText: "Overspent" };
  return { tone: "good", badgeText: "On track" };
}

function CategoryProgressCard({
  label,
  actual,
  planned,
  dotClass,
  fillClass,
  currency,
}: {
  label: string;
  actual: number;
  planned: number;
  dotClass: string;
  fillClass: string;
  currency: string;
}) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  return (
    <div className="rounded-xl bg-background/60 px-3 py-2 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="truncate text-xs text-muted">{label}</span>
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums">
          <span className="font-semibold text-foreground">{formatMoney(actual, currency)}</span>{" "}
          <span className="text-muted">/ {formatMoney(planned, currency)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
        <div
          className={`h-full rounded-full transition-[width] duration-400 ease-out ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Top row above the hero: title + month picker on left, "+ Add Item" +
// "Roll in {prev} planned" on the right. Splits the two rollover actions
// into visually distinct buttons per Victor's ask.
function TopHeader({
  monthKey,
  monthFirstOfMonth,
  prevMonthLabel,
  onAddItem,
}: {
  monthKey: string;
  monthFirstOfMonth: string;
  prevMonthLabel: string;
  onAddItem: () => void;
}) {
  const [copyPending, startCopy] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex shrink-0 items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Budget Overview</h1>
        <MonthPicker monthKey={monthKey} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onAddItem}
          className="flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Item
        </button>
        <form action={(fd) => startCopy(() => copyPlansFromPreviousMonth(fd))}>
          <input type="hidden" name="month" value={monthFirstOfMonth} />
          <button
            type="submit"
            disabled={copyPending}
            title={`Copy every planned amount from ${prevMonthLabel} into this month`}
            className="flex items-center gap-1.5 rounded-xl bg-surface px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm ring-1 ring-black/5 transition hover:bg-brand-soft disabled:opacity-60 dark:ring-white/10"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
            {copyPending ? "Copying…" : `Roll in ${prevMonthLabel} planned`}
          </button>
        </form>
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
  billsExpenses,
  savings,
  debt,
  rolloverCents,
  rollover,
  monthFirstOfMonth,
  currency,
}: {
  actualLeft: number;
  displayLeft: number;
  incomePlanned: number;
  outflowPlanned: number;
  actualIncome: number;
  actualSpent: number;
  billsExpenses: { planned: number; spent: number };
  savings: { planned: number; spent: number };
  debt: { planned: number; spent: number };
  rolloverCents: number;
  rollover: Props["rollover"];
  monthFirstOfMonth: string;
  currency: string;
}) {
  const { tone, badgeText } = getBudgetStatus(actualLeft, displayLeft, actualSpent, outflowPlanned);
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total Planned Budget</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
              {formatMoney(outflowPlanned, currency)}
            </p>
            {rolloverCents > 0 && (
              <p className="mt-0.5 text-xs text-muted">
                incl.{" "}
                <span className="font-medium text-brand">{formatMoney(rolloverCents, currency)}</span>{" "}
                rolled income
              </p>
            )}
          </div>
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Left</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
              {formatMoney(displayLeft, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Actual Spent</p>
            <div className="mt-0.5 flex items-center justify-end gap-2">
              <p className={`text-2xl font-bold tabular-nums ${toneClasses.text}`}>
                {formatMoney(actualSpent, currency)}
              </p>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${toneClasses.badge}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={toneClasses.icon} />
                </svg>
                {badgeText}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <CategoryProgressCard label="Income" actual={actualIncome} planned={incomePlanned} dotClass="bg-positive" fillClass="bg-positive" currency={currency} />
          <CategoryProgressCard label="Bills & Expenses" actual={billsExpenses.spent} planned={billsExpenses.planned} dotClass="bg-[#f59e0b]" fillClass="bg-[#f59e0b]" currency={currency} />
          <CategoryProgressCard label="Savings" actual={savings.spent} planned={savings.planned} dotClass="bg-[#6366f1]" fillClass="bg-[#6366f1]" currency={currency} />
          <CategoryProgressCard label="Debt Repayment" actual={debt.spent} planned={debt.planned} dotClass="bg-[#ef4444]" fillClass="bg-[#ef4444]" currency={currency} />
        </div>
      </div>

      <RolloverFooter rollover={rollover} monthFirstOfMonth={monthFirstOfMonth} currency={currency} />
    </div>
  );
}

// Slim footer inside the hero card. Shows one clear button:
// "Roll in {prev} unspent income" (or Undo). The other action —
// copying planned amounts — lives in the top header, so users don't
// have to guess which does what.
function RolloverFooter({
  rollover,
  monthFirstOfMonth,
  currency,
}: {
  rollover: Props["rollover"];
  monthFirstOfMonth: string;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const { availableCents, enabled, prevMonthLabel } = rollover;
  const hasRollover = availableCents > 0 || enabled;
  const amount = formatMoney(Math.max(0, availableCents), currency);

  return (
    <div
      className={`flex items-center justify-between gap-3 border-t px-6 py-3 text-sm ${
        enabled ? "border-brand/20 bg-brand-soft/40" : "border-line bg-background/40"
      }`}
    >
      <span className={enabled ? "text-brand" : "text-muted"}>
        {hasRollover ? (
          enabled ? (
            <>
              Including <span className="font-semibold tabular-nums">{amount}</span> unspent income
              from {prevMonthLabel}.
            </>
          ) : (
            <>
              Roll over{" "}
              <span className="font-semibold tabular-nums">{amount}</span> unspent income from{" "}
              {prevMonthLabel}?
            </>
          )
        ) : (
          <>Nothing unspent to roll from {prevMonthLabel}.</>
        )}
      </span>
      {hasRollover ? (
        <form action={(fd) => start(() => setRollover(fd))}>
          <input type="hidden" name="month" value={monthFirstOfMonth} />
          <input type="hidden" name="enable" value={enabled ? "" : "on"} />
          <button
            type="submit"
            disabled={pending}
            title={enabled
              ? `Stop including ${prevMonthLabel}'s unspent income`
              : `Add ${prevMonthLabel}'s ${amount} unspent income to this month`}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
              enabled
                ? "text-brand hover:bg-white/40 dark:hover:bg-white/10"
                : "bg-brand text-white hover:bg-brand-strong"
            }`}
          >
            {pending ? "Saving…" : enabled ? "Undo" : `Roll in ${prevMonthLabel} unspent`}
          </button>
        </form>
      ) : null}
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
    <div className="pointer-events-none sticky top-4 grid grid-cols-3 rounded-2xl bg-surface px-6 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="text-center">
        <p className="text-lg font-medium tabular-nums text-foreground">
          {formatMoney(actualIncome, currency)}
        </p>
        <p className="text-xs text-muted">Income Received</p>
      </div>
      <div className="border-l border-line text-center">
        <p className="text-lg font-medium tabular-nums text-foreground">
          {formatMoney(actualSpent, currency)}
        </p>
        <p className="text-xs text-muted">Total Spent</p>
      </div>
      <div className={`border-l border-line text-center ${toneClasses.text}`}>
        <p className="text-lg font-medium tabular-nums">{formatMoney(actualLeft, currency)}</p>
        <p className="text-xs text-muted">Actual Spent</p>
      </div>
    </div>
  );
}

