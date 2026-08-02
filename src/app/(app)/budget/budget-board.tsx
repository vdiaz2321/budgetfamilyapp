"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { copyPlansFromPreviousMonth, setRollover, setRolloverOverride } from "./actions";
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
    availableCents: number; // last month's leftover (live or override)
    liveAvailableCents: number; // always the live-calculated amount
    overrideCents: number | null; // null = no override
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

  const railContent = itemPanel;

  const heroRef = useRef<HTMLDivElement>(null);
  const [heroHidden, setHeroHidden] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = heroRef.current;
      if (el) setHeroHidden(el.getBoundingClientRect().bottom < 0);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  return (
    // `items-start` would leave the right rail (aside) exactly as tall as its
    // own content — shorter than the budget column next to it — which caps
    // how far its `sticky` child can travel before running out of room in
    // its own container and getting dragged back up off-screen. Default
    // (stretch) cross-axis sizing makes the aside match the row height so
    // the sticky panel has the whole scroll range to stay pinned in.
    // See feedback: item detail panel required scrolling up to reach.
    <div className="mx-auto max-w-6xl space-y-4">
      <TopHeader monthKey={month.key} />
      <div className="flex justify-center gap-6">
      {/* Budget column */}
      <div className="w-full min-w-0 max-w-[620px] space-y-4">
        {/* Left-to-budget hero card */}
        <div ref={heroRef}>
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
        </div>

        {/* Wrapping this in `relative` gives the sticky footer bar below a
            containing block that spans the whole rollover+groups list, so it
            stays pinned to the top of the viewport for as long as that list
            is in view, instead of unsticking the instant its own row scrolls
            past — see feedback: "freeze on top when I scroll down". */}
        <div className="relative space-y-4">
          {heroHidden && (
            <StickyFooterBar
              actualLeft={actualLeft}
              displayLeft={displayLeft}
              outflowPlanned={outflowPlanned}
              currency={currency}
            />
          )}

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
                compact={true}
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
              <RailActions
                monthFirstOfMonth={month.firstOfMonth}
                prevMonthLabel={rollover.prevMonthLabel}
                onAddItem={() => setShowAddModal(true)}
              />
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

      {/* Mobile: item detail slides up as bottom sheet */}
      {railContent ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-2 shadow-xl">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
            {railContent}
          </div>
        </div>
      ) : null}

      {/* Centered modal: header "+ Add Item" OR item panel "+ Transaction" */}
      {(showAddModal || (quickAdd && selected)) ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full sm:max-w-[520px]">
            <TransactionModal
              editTx={quickAdd && quickAdd !== true ? quickAdd : null}
              monthKey={month.key}
              firstOfMonth={month.firstOfMonth}
              subOptions={subOptions}
              accountOptions={accountOptions}
              bucketsByAccount={bucketsByAccount}
              payeeOptions={payeeOptions}
              payeeLineItems={payeeLineItems}
              initialKind={quickAdd && selected ? selected.kind : undefined}
              initialSubId={quickAdd && selected ? selected.subId : undefined}
              onClose={() => { setShowAddModal(false); setQuickAdd(false); }}
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
): { tone: BudgetTone; badgeText: string } {
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

// Top row above the hero: title + month picker on the left. The Add Item and
// Roll-Planned buttons live in the right rail (aside), above the Summary /
// Transactions tabs, so they align with that column's width.
function TopHeader({ monthKey }: { monthKey: string }) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-bold tracking-tight text-foreground">Budget Overview</h1>
      <MonthPicker monthKey={monthKey} />
    </div>
  );
}

// Add Item + Roll Planned, styled as a matched pair to sit above the
// Summary / Transactions tab strip in the right rail.
function RailActions({
  monthFirstOfMonth,
  prevMonthLabel,
  onAddItem,
}: {
  monthFirstOfMonth: string;
  prevMonthLabel: string;
  onAddItem: () => void;
}) {
  const [copyPending, startCopy] = useTransition();
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onAddItem}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong"
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
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-surface px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm ring-1 ring-black/5 transition hover:bg-brand-soft disabled:opacity-60 dark:ring-white/10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
          </svg>
          {copyPending ? "Copying…" : `Roll in ${prevMonthLabel} planned`}
        </button>
      </form>
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
  const { tone, badgeText } = getBudgetStatus(actualLeft);
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-6 pb-5 pt-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total Planned Budget</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
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
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total Income Planned</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-positive">
              {formatMoney(incomePlanned, currency)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Left</p>
            <p className={`mt-0.5 text-xl font-bold tabular-nums ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
              {formatMoney(displayLeft, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Actual Spent</p>
            <div className="mt-0.5 flex items-center justify-end gap-2">
              <p className={`text-xl font-bold tabular-nums ${toneClasses.text}`}>
                {formatMoney(actualSpent, currency)}
              </p>
              {tone !== "good" && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${toneClasses.badge}`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={toneClasses.icon} />
                  </svg>
                  {badgeText}
                </span>
              )}
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
  const [editing, setEditing] = useState(false);
  const { availableCents, liveAvailableCents, enabled, prevMonthLabel } = rollover;
  const hasRollover = availableCents > 0 || enabled || liveAvailableCents > 0;
  const amount = formatMoney(Math.max(0, availableCents), currency);

  return (
    <div
      className={`flex items-center justify-between gap-3 border-t px-6 py-3 text-sm ${
        enabled ? "border-brand/20 bg-brand-soft/40" : "border-line bg-background/40"
      }`}
    >
      <span className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs ${enabled ? "text-brand" : "text-muted"}`}>
        {hasRollover ? (
          enabled ? (
            <>
              Using{" "}
              {editing ? (
                <OverrideInput
                  monthFirstOfMonth={monthFirstOfMonth}
                  currentCents={availableCents}
                  liveLabel={formatMoney(liveAvailableCents, currency)}
                  onDone={() => setEditing(false)}
                />
              ) : (
                <>
                  <span className="font-semibold tabular-nums">{amount}</span>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    title="Manually adjust the rollover amount"
                    className="rounded p-0.5 opacity-40 hover:opacity-100 hover:text-foreground"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
                    </svg>
                  </button>
                </>
              )}{" "}
              unspent income from {prevMonthLabel}.
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums">{amount}</span> unspent income from {prevMonthLabel} available.
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
            className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-60 ${
              enabled
                ? "text-brand hover:bg-white/40 dark:hover:bg-white/10"
                : "bg-brand text-white hover:bg-brand-strong"
            }`}
          >
            {pending ? "Saving…" : enabled ? "Remove" : "Rollover"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function OverrideInput({
  monthFirstOfMonth,
  currentCents,
  liveLabel,
  onDone,
}: {
  monthFirstOfMonth: string;
  currentCents: number;
  liveLabel: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const initial = (currentCents / 100).toFixed(2);

  const save = (value: string) => {
    const fd = new FormData();
    fd.set("month", monthFirstOfMonth);
    fd.set("override", value.trim() === "" || value.trim() === liveLabel ? "" : value.trim());
    start(async () => {
      await setRolloverOverride(fd);
      onDone();
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => save(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          if (e.key === "Escape") { onDone(); }
        }}
        className="w-24 rounded border border-brand/40 bg-surface px-1.5 py-0.5 text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
        disabled={pending}
      />
      <button
        type="button"
        onClick={() => save("")}
        title={`Reset to live calc (${liveLabel})`}
        className="text-[10px] text-muted underline hover:text-foreground"
      >
        reset
      </button>
    </span>
  );
}

// Split out from SummaryHeroCard so it can be rendered as its own sticky
// element — its containing block is the `relative` wrapper in BudgetBoard
// that spans the rollover bar + group list, so it stays pinned to the top of
// the viewport across that whole scroll region instead of unsticking after
// only its own row height.
function StickyFooterBar({
  actualLeft,
  displayLeft,
  outflowPlanned,
  currency,
}: {
  actualLeft: number;
  displayLeft: number;
  outflowPlanned: number;
  currency: string;
}) {
  const { tone } = getBudgetStatus(actualLeft);
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
    <div className="pointer-events-none relative z-10 sticky top-4 grid grid-cols-3 rounded-2xl bg-surface px-2 py-2 shadow-sm ring-1 ring-black/5 sm:px-6 sm:py-3 dark:ring-white/10">
      <div className="min-w-0 px-1 text-center">
        <p className="truncate text-sm font-medium tabular-nums text-foreground sm:text-lg">
          {formatMoney(outflowPlanned, currency)}
        </p>
        <p className="text-[10px] text-muted sm:text-xs">Planned</p>
      </div>
      <div className="min-w-0 border-l border-line px-1 text-center">
        <p className={`truncate text-sm font-medium tabular-nums sm:text-lg ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
          {formatMoney(displayLeft, currency)}
        </p>
        <p className="text-[10px] text-muted sm:text-xs">Income Left</p>
      </div>
      <div className={`min-w-0 border-l border-line px-1 text-center ${toneClasses.text}`}>
        <p className="truncate text-sm font-medium tabular-nums sm:text-lg">{formatMoney(actualLeft, currency)}</p>
        <p className="text-[10px] text-muted sm:text-xs">Actual Spent</p>
      </div>
    </div>
  );
}
