"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { addToPlan, copyPlansFromPreviousMonth, restorePlansSnapshot, setRollover, setRolloverOverride } from "./actions";
import { advanceSubscriptionRenewal } from "../subscriptions/actions";
import { BudgetGroup } from "./budget-group";
import { MonthPicker } from "./month-picker";
import { ItemPanel } from "./item-panel";
import { TransactionsPanel } from "./transactions-panel";
import { TransactionModal } from "./transaction-modal";
import { SummaryPanel } from "./summary-panel";
import { ModalShell } from "@/components/modal-shell";
import { SubscriptionsSummaryCard, IrregularBillsSummaryCard } from "./subscriptions-summary";
import { BulkAddSubcategories } from "./bulk-add-subcategories";
import { AddCategoryGroupButton } from "./category-group-controls";
import type {
  AccountOption,
  BucketOption,
  BucketsByAccount,
  DueItem,
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
  subscriptionMonthPlanned: number;
  subscriptionMonthSpent: number;
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
  subscriptionMonthPlanned,
  subscriptionMonthSpent,
}: Props) {
  const [railTab, setRailTab] = useState<"summary" | "transactions">("summary");
  const [rowFilter, setRowFilter] = useState<"all" | "overspent">("all");
  // Progress bars start visible on a fresh login. The versioned key also
  // upgrades any earlier saved "off" preference from the two-button control.
  const [rowDetail, setRowDetail] = useSessionCollapse("budget-row-detail-v2", () => ({ expanded: true }));
  const detailsExpanded = rowDetail.expanded === true;
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
  const [txFilterKinds, setTxFilterKinds] = useState<CategoryKind[]>([]);
  const [txFilterSubs, setTxFilterSubs] = useState<{ id: string; label: string }[]>([]);
  const toggleFilterKind = (kind: CategoryKind) => {
    setTxFilterKinds((prev) => prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]);
  };
  const toggleFilterSub = (id: string, label: string) => {
    setTxFilterSubs((prev) => prev.some((s) => s.id === id) ? prev.filter((s) => s.id !== id) : [...prev, { id, label }]);
  };
  // Each group's open/collapsed state, persisted per-session (survives
  // navigating away and back, resets on a fresh login) — same pattern as
  // Net Worth / Accounts. Groups default open.
  // Hero card starts collapsed on a fresh browser session (calmer landing for
  // new users / less numbers overwhelm) but remembers your last state while
  // you're navigating around within the session.
  const [heroState, setHeroState] = useSessionCollapse("budget-hero", () => ({ open: false }));
  const heroExpanded = heroState.open === true;
  const toggleHero = () => setHeroState((s) => ({ ...s, open: !s.open }));

  const [openGroups, setOpenGroups] = useSessionCollapse("budget-sections-open", () =>
    Object.fromEntries([...groups.map((g) => [g.categoryId, false]), ["subscriptions", false], ["irregularBills", false]]),
  );
  const toggleGroup = (categoryId: string) =>
    setOpenGroups((o) => ({ ...o, [categoryId]: !(o[categoryId] ?? false) }));

  const isOverspentRow = (kind: CategoryKind, row: RowData) =>
    (kind === "bills" || kind === "expenses") && row.spentCents > row.plannedCents;
  const overspentCount = groups.reduce(
    (count, group) => count + group.rows.filter((row) => isOverspentRow(group.kind, row)).length,
    0,
  );
  // A server revalidation does not remount this client board. Treat an empty
  // overspent result as the normal list immediately, including for updates
  // made outside the cover-overage flow.
  const showingOverspent = rowFilter === "overspent" && overspentCount > 0;
  const displayedGroups = !showingOverspent
    ? groups
    : groups
        .map((group) => ({
          ...group,
          rows: group.rows.filter((row) => isOverspentRow(group.kind, row)),
        }))
        .filter((group) => group.rows.length > 0);
  const showOverspent = () => {
    setRowFilter("overspent");
    setOpenGroups((current) => ({
      ...current,
      ...Object.fromEntries(
        groups
          .filter((group) => group.rows.some((row) => isOverspentRow(group.kind, row)))
          .map((group) => [group.categoryId, true]),
      ),
    }));
  };
  // Set from the item panel's "+ Add transaction" button so it doesn't
  // require switching to the Log tab first. `true` = new; a TxData = edit
  // (opened by clicking a row in the panel's "This month" list).
  const [quickAdd, setQuickAdd] = useState<boolean | TxData>(false);
  // Fresh transaction modal opened from the top header's "+ Transaction"
  // button — no preselected item/kind, renders as a centered overlay so it
  // works with or without a selected budget row.
  const [showAddModal, setShowAddModal] = useState(false);
  const [duePayment, setDuePayment] = useState<DueItem | null>(null);

  // Precompute account_id → name so the item panel's tx list can render each
  // row's account without re-scanning accountOptions on every entry.
  const accountNameById = new Map(accountOptions.map((a) => [a.id, a.name]));
  const paymentAccountOptions = accountOptions.filter((a) => a.group === "Banking" || a.group === "Credit Cards");

  // The card is deliberately based on the real current week, not a future or
  // historical month that happens to be open in the picker.
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = month.key === currentMonthKey;
  const dueThisWeek = (() => {
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    if (!isCurrentMonth) return [] as DueItem[];
    const startOfMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    // Show items from start of month (not just today) so overdue unpaid items
    // stay visible until Pay/Edit is clicked, not just until the date passes.
    const inWindow = (value: Date) => value >= startOfMonth && value <= end;
    // Build a lookup of spentCents by subcategory id for subscription "paid" check.
    const spentBySubId = new Map<string, number>();
    for (const group of groups) {
      for (const row of group.rows) {
        spentBySubId.set(row.subId, row.spentCents);
      }
    }
    const budgetItems = groups
      .filter((group) => group.kind === "bills")
      .flatMap((group) => group.rows)
      .flatMap((row) => {
        if (!row.dueDay) return [];
        const due = new Date(start.getFullYear(), start.getMonth(), Math.min(row.dueDay, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
        const amountCents = Math.max(0, row.plannedCents - row.spentCents);
        if (!inWindow(due) || amountCents <= 0) return [];
        const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
        return [{
          id: row.subId,
          name: row.name,
          kind: "bills" as const,
          subId: row.subId,
          dueDate,
          amountCents,
          accountId: row.paymentAccountId,
          accountName: row.paymentAccountId ? accountNameById.get(row.paymentAccountId) ?? null : null,
          source: "budget" as const,
        }];
      });
    const subscriptionItems = subscriptions.flatMap((subscription) => {
      if (!subscription.isActive || !subscription.nextRenewalDate || !subscription.subcategoryId) return [];
      const due = new Date(`${subscription.nextRenewalDate}T00:00:00`);
      if (!inWindow(due)) return [];
      // Considered paid this month if spend in the matching budget row covers the amount.
      const spentCents = spentBySubId.get(subscription.subcategoryId) ?? 0;
      if (spentCents >= subscription.amountCents) return [];
      return [{
        id: subscription.id,
        name: subscription.name,
        kind: "bills" as const,
        subId: subscription.subcategoryId,
        dueDate: subscription.nextRenewalDate,
        amountCents: subscription.amountCents,
        accountId: subscription.accountId,
        accountName: subscription.accountId ? accountNameById.get(subscription.accountId) ?? null : null,
        source: "subscription" as const,
      }];
    });
    return [...budgetItems, ...subscriptionItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  })();

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

  // Paid-off debts are hidden from the debt group's row list, so they must
  // also drop out of the summary hero totals — otherwise the "Debt Repayment"
  // card's Planned inflates by every stale/paid-off debt's plan row.
  const isVisibleRow = (kind: string, r: RowData) =>
    !(kind === "debt" && r.debt && r.debt.balanceCents <= 0);
  const kindTotals = (kinds: string[]) => {
    const matching = groups.filter((g) => kinds.includes(g.kind));
    return {
      planned: matching.reduce(
        (s, g) => s + g.rows.filter((r) => isVisibleRow(g.kind, r)).reduce((rs, r) => rs + r.plannedCents, 0),
        0,
      ),
      spent: matching.reduce(
        (s, g) => s + g.rows.filter((r) => isVisibleRow(g.kind, r)).reduce((rs, r) => rs + r.spentCents, 0),
        0,
      ),
    };
  };
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
        subOptions={subOptions}
        groupOptions={groups.map((group) => ({ id: group.categoryId, name: group.name, kind: group.kind }))}
        paymentAccountOptions={paymentAccountOptions}
        debtAccountOptions={debtAccountOptions}
        bucketOptions={bucketOptions}
        snowballExtraCents={snowballExtraCents}
        isSnowballFocus={selected.subId === snowballFocusSubId}
        transactions={transactions}
        accountNameById={accountNameById}
        onClose={() => setSelected(null)}
        onAddTransaction={() => setQuickAdd(true)}
        onEditTransaction={(tx) => setQuickAdd(tx)}
        onOverspentCovered={() => {
          setRowFilter("all");
          setSelected(null);
        }}
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
    <div className="-m-4 min-h-[calc(100vh-4rem)] space-y-4 bg-background p-4 md:-m-8 md:min-h-screen md:p-8">
      <div className="flex items-center justify-between pr-8 md:pr-0">
        <MonthPicker monthKey={month.key} />
      </div>
      <div className="flex w-full gap-6">
      {/* Budget column */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Left-to-budget hero card */}
        <div ref={heroRef}>
        <SummaryHeroCard
          heroSubOptions={subOptions}
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
          expanded={heroExpanded}
          onToggle={toggleHero}
          dueThisWeek={dueThisWeek}
          onPayDue={(item) => {
            if (item.source === "subscription") {
              const fd = new FormData();
              fd.set("id", item.id);
              void advanceSubscriptionRenewal(fd);
            }
            setDuePayment(item);
          }}
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
              actualSpent={actualSpent}
              displayLeft={displayLeft}
              outflowPlanned={outflowPlanned}
              currency={currency}
            />
          )}

          <div className="flex flex-nowrap items-center gap-1.5 rounded-xl px-0.5 py-1 sm:flex-wrap sm:bg-surface/90 sm:px-2.5 sm:py-2 sm:shadow-sm sm:ring-1 sm:ring-black/5 sm:dark:ring-white/10">
            <button
              type="button"
              onClick={() => showingOverspent ? setRowFilter("all") : showOverspent()}
              aria-pressed={showingOverspent}
              disabled={overspentCount === 0}
              className={`${overspentCount === 0 ? "hidden" : "inline-flex"} items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-negative/50 disabled:opacity-50 sm:text-xs ${showingOverspent ? "bg-negative/30 text-foreground ring-1 ring-negative/30" : "bg-negative/8 text-negative hover:bg-negative/15"}`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 3.5 22 20.5H2L12 3.5Zm0 5.25a1 1 0 0 0-1 1v4.5a1 1 0 1 0 2 0v-4.5a1 1 0 0 0-1-1Zm0 8.25a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
              </svg>
              Overspent ({overspentCount})
            </button>
            {/* Mobile only: Cat Group + compact Add grouped and pushed right */}
            <div className="ml-auto flex items-center gap-1.5 sm:hidden">
              <AddCategoryGroupButton />
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="h-7 shrink-0 rounded-lg bg-brand px-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong"
              >
                + Transaction
              </button>
            </div>
            {/* Desktop only: + Transaction */}
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="hidden shrink-0 cursor-pointer items-center rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-brand-strong sm:flex sm:text-xs"
            >
              + Transaction
            </button>
            {/* Desktop only: +Cat Group + +Bulk add items inline after +Transaction */}
            <div className="hidden sm:block">
              <AddCategoryGroupButton />
            </div>
            <div className="hidden sm:block">
              <BulkAddSubcategories groups={groups} />
            </div>
            {/* One switch replaces the old separate on/off buttons. */}
            <button
              type="button"
              role="switch"
              aria-checked={detailsExpanded}
              aria-label="Show progress bars"
              title={detailsExpanded ? "Progress On" : "Progress Off"}
              onClick={() => setRowDetail((current) => ({ ...current, expanded: current.expanded !== true }))}
              className={`ml-auto hidden h-7 items-center rounded-full p-1 transition sm:flex ${
                detailsExpanded
                  ? "bg-brand-soft text-brand ring-1 ring-brand/20"
                  : "bg-[#ebe8e1] text-muted ring-1 ring-black/10 hover:text-foreground dark:bg-white/10 dark:ring-white/10"
              }`}
            >
              <span
                aria-hidden
                className={`relative h-5 w-9 rounded-full transition ${detailsExpanded ? "bg-brand" : "bg-muted/50"}`}
              >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left,right] ${
                    detailsExpanded ? "left-0.5" : "right-0.5"
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Groups */}
          <div className="space-y-3">
            {displayedGroups.map((group) => (
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
                detailsExpanded={detailsExpanded}
                onFilter={(kind) => {
                  toggleFilterKind(kind);
                  setRailTab("transactions");
                }}
              />
            ))}

            {showingOverspent && displayedGroups.length === 0 ? (
              <div className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                Nothing is overspent this month.
              </div>
            ) : null}

            {!showingOverspent ? (
              <>
                <SubscriptionsSummaryCard
                  currency={currency}
                  subscriptions={subscriptions}
                  irregularBills={irregularBills}
                  creditCards={creditCards}
                  open={openGroups["subscriptions"] ?? false}
                  onToggle={() => toggleGroup("subscriptions")}
                  monthPlannedCents={subscriptionMonthPlanned}
                  monthSpentCents={subscriptionMonthSpent}
                  onOpenSpent={() => {
                    const subId = subscriptions.find((s) => s.subcategoryId)?.subcategoryId;
                    if (subId) {
                      toggleFilterSub(subId, "Subscriptions");
                      setRailTab("transactions");
                    }
                  }}
                />

                <IrregularBillsSummaryCard
                  currency={currency}
                  subscriptions={subscriptions}
                  irregularBills={irregularBills}
                  creditCards={creditCards}
                  open={openGroups["irregularBills"] ?? false}
                  onToggle={() => toggleGroup("irregularBills")}
                  onOpenSpent={() => {
                    const subId = irregularBills.find((b) => b.subcategoryId)?.subcategoryId;
                    if (subId) {
                      toggleFilterSub(subId, "Irregular Bills");
                      setRailTab("transactions");
                    }
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right rail: item detail when selected, otherwise Summary / Log */}
      <aside className="hidden w-[380px] shrink-0 lg:block">
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
                <>
                  <SummaryPanel groups={groups} currency={currency} />
                </>
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
                  filterKinds={txFilterKinds}
                  filterSubs={txFilterSubs}
                  onRemoveKind={(k) => setTxFilterKinds((prev) => prev.filter((x) => x !== k))}
                  onRemoveSub={(id) => setTxFilterSubs((prev) => prev.filter((s) => s.id !== id))}
                  onClearFilter={() => { setTxFilterKinds([]); setTxFilterSubs([]); }}
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
          <div className="fixed inset-x-0 top-0 z-[70] max-h-[85vh] overflow-y-auto overscroll-contain rounded-b-2xl bg-background shadow-xl">
            {railContent}
            <div className="mx-auto mb-2 mt-2 h-1 w-10 rounded-full bg-line" />
          </div>
        </div>
      ) : null}

      {/* Centered modal: header "+ Transaction" OR item panel "+ Transaction" */}
      {(showAddModal || (quickAdd && selected) || duePayment) ? (
        <div className="fixed inset-0 z-[70] flex min-h-0 items-stretch justify-center overflow-hidden overscroll-none bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
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
              initialKind={duePayment?.kind ?? (quickAdd && selected ? selected.kind : undefined)}
              initialSubId={duePayment?.subId ?? (quickAdd && selected ? selected.subId : undefined)}
              initialAccountId={duePayment?.accountId ?? undefined}
              initialAmountCents={duePayment?.amountCents}
              initialPayee={duePayment?.name}
              initialDate={duePayment?.dueDate}
              onClose={() => { setShowAddModal(false); setQuickAdd(false); setDuePayment(null); }}
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

// Give unassigned income a job. Adds to an item's Planned rather than moving
// between two, since the money is coming from income that isn't allocated yet.
//
// A modal rather than inline controls: the hero card is a dense grid of
// figures, and dropping a select + input + two buttons into it pushed the
// numbers around. The trigger stays a quiet text link; the form gets room.
function AssignLeftover({
  leftoverCents,
  monthKey,
  currency,
  options,
}: {
  leftoverCents: number;
  monthKey: string;
  currency: string;
  options: SubOption[];
}) {
  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("0");
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();

  // Outflow items only — assigning income to an income line is meaningless.
  const targets = options.filter((o) => o.kind !== "income");
  const KIND_LABEL: Partial<Record<CategoryKind, string>> = {
    savings: "Investments & Savings",
    bills: "Bills",
    expenses: "Expenses",
    debt: "Debt",
  };
  const q = filter.trim().toLowerCase();
  const shown = q ? targets.filter((o) => o.name.toLowerCase().includes(q)) : targets;
  const grouped = (["bills", "expenses", "savings", "debt"] as CategoryKind[])
    .map((k) => ({ kind: k, items: shown.filter((o) => o.kind === k) }))
    .filter((g) => g.items.length > 0);

  const submit = () => {
    const fd = new FormData();
    fd.set("subcategoryId", toId);
    fd.set("month", monthKey);
    fd.set("addAmount", amount);
    start(async () => {
      await addToPlan(fd);
      setOpen(false);
      setToId("");
      setFilter("");
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setAmount("0"); setOpen(true); }}
        className="mt-1 text-[11px] font-semibold text-brand underline-offset-2 hover:underline"
      >
        Give it a job
      </button>

      {open ? (
        <ModalShell title="Assign to a budget item" onClose={() => setOpen(false)} className="sm:max-w-md" mobileAlign="top">
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground tabular-nums">
                {formatMoney(leftoverCents, currency)}
              </span>{" "}
              of planned income has no job yet.
            </p>

            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Amount
              </span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                className="w-full rounded-xl bg-background px-3 py-2.5 text-base font-semibold tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <p className="mt-1.5 text-xs leading-snug text-muted">
                Enter how much of the unassigned income to assign. You can assign the rest later.
              </p>
            </label>

            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Assign to
              </span>
              {/* 70+ items is too many to scan, so the list filters as you type. */}
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search items…"
                aria-label="Filter budget items"
                className="mb-2 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <div className="max-h-56 overflow-y-auto rounded-xl ring-1 ring-line">
                {grouped.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">No items match.</p>
                ) : (
                  grouped.map((g) => (
                    <div key={g.kind}>
                      <p className="sticky top-0 bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {KIND_LABEL[g.kind]}
                      </p>
                      {g.items.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setToId(o.id)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                            toId === o.id
                              ? "bg-brand-soft font-semibold"
                              : "hover:bg-black/5 dark:hover:bg-white/10"
                          }`}
                        >
                          <span className="min-w-0 truncate">{o.name}</span>
                          {o.remainingCents != null ? (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted">
                              {formatMoney(o.remainingCents, currency)} left
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !toId}
                onClick={submit}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {pending ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

function getBudgetStatus(
  actualLeft: number,
): { tone: BudgetTone; badgeText: string } {
  if (actualLeft < 0) return { tone: "bad", badgeText: "Overspent" };
  return { tone: "good", badgeText: "On track" };
}

function CategoryProgressCard({
  label,
  actualLabel,
  actualColorClass,
  actual,
  planned,
  dotClass,
  fillClass,
  currency,
  shareOfIncome,
}: {
  label: string;
  actualLabel: string;
  actualColorClass: string;
  actual: number;
  planned: number;
  dotClass: string;
  fillClass: string;
  currency: string;
  // Planned amount as a share of planned income. Set on the Savings card so
  // the savings rate — the headline number in any personal-finance review —
  // is visible without leaving Budget.
  shareOfIncome?: number | null;
}) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  return (
    <div className="rounded-xl bg-background/60 px-3 py-2 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="truncate text-xs text-muted">{label}</span>
        {shareOfIncome != null ? (
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ backgroundColor: "var(--viz-sel)", color: "var(--viz-savings)" }}
          >
            {shareOfIncome.toFixed(0)}% of income
          </span>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums">
          <span className="font-semibold text-foreground">{formatMoney(planned, currency)}</span>
          <span className="text-muted"> / {actualLabel} </span>
          <span className={`font-semibold ${actualColorClass}`}>{formatMoney(actual, currency)}</span>
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

// Top row above the hero: title + month picker on the left. The + Transaction
// and Roll Planned actions are styled as a matched pair to sit above the
// Summary / Transactions tab strip in the right rail.
function RailActions({
  onAddItem,
}: {
  onAddItem: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <button
        type="button"
        onClick={onAddItem}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Transaction
      </button>
    </div>
  );
}

// Small submit-only Undo button used inline next to the "+$X rollover" line
// in the hero card. Same server action as the pill's Undo in RolloverFooter —
// posts a blank `enable` value to toggle rollover off for this month.
function UndoRolloverButton({ monthFirstOfMonth }: { monthFirstOfMonth: string }) {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(() => setRollover(fd))}>
      <input type="hidden" name="month" value={monthFirstOfMonth} />
      <input type="hidden" name="enable" value="" />
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-negative/40 hover:text-negative disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "…" : "Undo"}
      </button>
    </form>
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
  heroSubOptions,
  currency,
  expanded,
  onToggle,
  dueThisWeek = [],
  onPayDue,
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
  heroSubOptions: SubOption[];
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  dueThisWeek?: DueItem[];
  onPayDue?: (item: DueItem) => void;
}) {
  const { tone, badgeText } = getBudgetStatus(actualLeft);
  const toneClasses = TONE_CLASSES[tone];

  if (!expanded) {
    return (
      <div className="-mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-2xl dark:ring-white/10">
        <div className="relative bg-brand-soft">
          <div
            onClick={onToggle}
            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left transition hover:bg-brand/20"
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              aria-expanded={false}
              aria-label="Expand summary"
              className="shrink-0 cursor-pointer rounded-full p-1.5 text-brand transition hover:bg-brand/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="-rotate-90"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <span>
                  <span className="block text-[11px] font-semibold text-foreground">Planned Budget:</span>
                  <span className="block text-[15px] font-semibold text-foreground">{formatMoney(outflowPlanned, currency)}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[11px] font-semibold text-foreground">Income Planned:</span>
                  <span className="block text-[15px] font-semibold text-positive">{formatMoney(incomePlanned, currency)}</span>
                </span>
                <span>
                  <span className="block text-[11px] font-semibold text-foreground">Actual Spent:</span>
                  <span className="block text-[15px] font-semibold text-negative">{formatMoney(actualSpent, currency)}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[11px] font-semibold text-foreground">Left to Budget:</span>
                  <span className={`block text-[15px] font-semibold ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
                    {formatMoney(displayLeft, currency)}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex justify-end px-4 pb-2.5 sm:absolute sm:left-1/2 sm:top-1/2 sm:z-10 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:justify-center sm:p-0"
          >
            {rolloverCents > 0 ? (
              // Active state: sits in the SAME centered pill slot as the
              // "Rollover July: $1,974.86" opt-in pill, just with the added
              // amount + inline Undo so the user sees at a glance that it's
              // already in for this month. No plus sign; "Added" instead of
              // "rollover" per Victor's copy.
              <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/25 bg-positive/10 px-2.5 py-1 text-positive">
                <span className="size-1.5 rounded-full bg-positive" aria-hidden />
                <span className="text-[11px] font-bold tabular-nums">
                  {formatMoney(rolloverCents, currency)}
                </span>
                <span className="text-[11px] font-semibold opacity-80">Added</span>
                <UndoRolloverButton monthFirstOfMonth={monthFirstOfMonth} />
              </span>
            ) : (
              <RolloverControl rollover={rollover} monthFirstOfMonth={monthFirstOfMonth} currency={currency} centered />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-2xl dark:ring-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={true}
        aria-label="Collapse summary"
        title="Collapse summary"
        className="flex w-full items-center gap-2 bg-brand-soft px-4 py-2 text-left transition hover:bg-brand/20"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-brand"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-brand">
          Summary — click to collapse
        </span>
      </button>
      <div className="px-6 pb-5 pt-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Planned Budget</p>
            <p className="mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums text-foreground">
              {formatMoney(outflowPlanned, currency)}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Planned</p>
            <p className="mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums text-positive">
              {formatMoney(incomePlanned, currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Left to Budget</p>
            <p className={`mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
              {formatMoney(displayLeft, currency)}
            </p>
            {/* Zero-based budgeting says every dollar gets a job. This figure
                used to sit here as a read-only fact; now it's the entry point
                for giving the money one. */}
            {displayLeft > 0 ? (
              <AssignLeftover
                leftoverCents={displayLeft}
                monthKey={monthFirstOfMonth}
                currency={currency}
                options={heroSubOptions}
              />
            ) : null}
            {rolloverCents > 0 && (
              // <div> (not <p>) because UndoRolloverButton renders a <form>,
              // and forms inside paragraphs are invalid HTML.
              <div className="mt-0.5 flex items-baseline gap-1.5 text-xs text-muted">
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-positive">
                    {formatMoney(rolloverCents, currency)}
                  </span>{" "}
                  Added
                </span>
                {/* Inline Undo — same submit RolloverFooter used to render.
                    Keeping it here lets the footer drop the redundant
                    pill+Undo when a rollover is already in. */}
                <UndoRolloverButton monthFirstOfMonth={monthFirstOfMonth} />
              </div>
            )}
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Actual Spent</p>
            <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <p className="whitespace-nowrap text-2xl font-bold tabular-nums text-negative">
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
          <CategoryProgressCard label="Income" actualLabel="Rec'd" actualColorClass="text-positive" actual={actualIncome} planned={incomePlanned} dotClass="bg-[color:var(--cat-income)]" fillClass="bg-[color:var(--cat-income)]" currency={currency} />
          <CategoryProgressCard label="Bills & Expenses" actualLabel="Spent" actualColorClass="text-negative" actual={billsExpenses.spent} planned={billsExpenses.planned} dotClass="bg-[color:var(--cat-bills)]" fillClass="bg-[color:var(--cat-bills)]" currency={currency} />
          <CategoryProgressCard label="Savings" actualLabel="Saved" actualColorClass="text-positive" actual={savings.spent} planned={savings.planned} dotClass="bg-[color:var(--cat-savings)]" fillClass="bg-[color:var(--cat-savings)]" currency={currency} shareOfIncome={incomePlanned > 0 ? (savings.planned / incomePlanned) * 100 : null} />
          <CategoryProgressCard label="Debt Repayment" actualLabel="Paid" actualColorClass="text-negative" actual={debt.spent} planned={debt.planned} dotClass="bg-[color:var(--cat-debt)]" fillClass="bg-[color:var(--cat-debt)]" currency={currency} />
        </div>
      </div>

      <RolloverFooter rollover={rollover} monthFirstOfMonth={monthFirstOfMonth} currency={currency} dueItems={dueThisWeek} onPayDue={onPayDue} />
    </div>
  );
}

function dueItemDateLabel(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function RolloverControl({
  rollover,
  monthFirstOfMonth,
  currency,
  centered = false,
}: {
  rollover: Props["rollover"];
  monthFirstOfMonth: string;
  currency: string;
  centered?: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const { availableCents, liveAvailableCents, enabled, prevMonthLabel } = rollover;
  const hasRollover = availableCents > 0 || enabled || liveAvailableCents > 0;

  if (!hasRollover) return null;
  // Once the rollover has been rolled in, the hero card already displays
  // "+$X rollover · Undo" under Income Left — rendering the pill here too
  // would double it up in the footer. Keep this control only when the user
  // still has to opt in (enabled=false).
  if (enabled) return null;

  const amount = formatMoney(Math.max(0, availableCents), currency);
  const prevMonthName = prevMonthLabel.replace(/\s+\d{4}$/, "");
  const rolloverPillContent = (
    <>
      <span className="size-1.5 rounded-full bg-positive" aria-hidden />
      <span className="text-[11px] font-semibold opacity-80">Rollover {prevMonthName}:</span>
      <span className="text-[11px] font-bold tabular-nums">{amount}</span>
    </>
  );

  return (
    <div className="relative flex min-w-0 items-center gap-1.5 text-xs text-muted">
      {enabled ? (
        <>
          {editing ? (
            <OverrideInput
              monthFirstOfMonth={monthFirstOfMonth}
              currentCents={availableCents}
              liveLabel={formatMoney(liveAvailableCents, currency)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-positive/25 bg-positive/10 px-2.5 py-1 text-positive shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition hover:border-positive/40 hover:bg-positive/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-positive"
              aria-label={`${amount} rolled over from ${prevMonthName}`}
            >
              {rolloverPillContent}
            </button>
          )}
          <form
            action={(fd) => start(() => setRollover(fd))}
            className={centered ? "absolute left-full ml-1.5" : undefined}
          >
            <input type="hidden" name="month" value={monthFirstOfMonth} />
            <input type="hidden" name="enable" value="" />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:border-brand/30 hover:text-brand disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Saving…" : "Undo"}
            </button>
          </form>
        </>
      ) : (
        <form action={(fd) => start(() => setRollover(fd))}>
          <input type="hidden" name="month" value={monthFirstOfMonth} />
          <input type="hidden" name="enable" value="on" />
          <button
            type="submit"
            disabled={pending}
            title={`Add ${prevMonthLabel}'s unspent income to this month`}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-positive/25 bg-positive/10 px-2.5 py-1 text-positive shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition hover:border-positive/40 hover:bg-positive/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-positive disabled:cursor-wait disabled:opacity-60"
            aria-label={`Rollover ${prevMonthName}: ${amount}`}
          >
            {pending ? "Rolling over…" : rolloverPillContent}
          </button>
        </form>
      )}
    </div>
  );
}

// Footer row: [Due this week pill] ... [rollover amount] [Rollover/Remove btn]
// Due pill expands an inline list above the row.
function RolloverFooter({
  rollover,
  monthFirstOfMonth,
  currency,
  dueItems = [],
  onPayDue,
}: {
  rollover: Props["rollover"];
  monthFirstOfMonth: string;
  currency: string;
  dueItems?: DueItem[];
  onPayDue?: (item: DueItem) => void;
}) {
  const [copyPending, startCopy] = useTransition();
  const [undoPending, startUndo] = useTransition();
  const [showDue, setShowDue] = useState(false);
  const [snapshot, setSnapshot] = useState<
    Array<{ subcategory_id: string; planned_cents: number | null }> | null
  >(null);
  const { enabled, prevMonthLabel } = rollover;

  useEffect(() => {
    if (!snapshot) return;
    const t = window.setTimeout(() => setSnapshot(null), 30_000);
    return () => window.clearTimeout(t);
  }, [snapshot]);
  return (
    // Neutral tint on both enabled/disabled states — the hero card already
    // signals when a rollover is active via the "+$X rollover" line, so the
    // extra brand-soft wash here was noise on top of it.
    <div className={`border-t border-line ${enabled ? "bg-black/[0.03] dark:bg-white/[0.05]" : "bg-background/40"}`}>
      {/* Expandable due-this-week list */}
      {showDue && dueItems.length > 0 && (
        <ul className="divide-y divide-line border-b border-line">
          {dueItems.map((item) => {
            const dueTarget = new Date(`${item.dueDate}T00:00:00`);
            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            const isOverdue = dueTarget < todayMidnight;
            return (
              <li key={`${item.source}:${item.id}`} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className={`shrink-0 text-xs font-semibold ${isOverdue ? "text-negative" : "text-brand"}`}>{dueItemDateLabel(item.dueDate)}</span>
                    <span className="truncate text-sm font-semibold">{item.name}</span>
                    {isOverdue && (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-negative">
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {item.accountName ? `Charged to ${item.accountName}` : "No account linked"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(item.amountCents, currency)}</p>
                  {onPayDue && (
                    <button
                      type="button"
                      onClick={() => onPayDue(item)}
                      className={`mt-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${isOverdue ? "bg-negative/15 text-negative hover:bg-negative/25" : "bg-brand-soft text-brand hover:bg-brand/20"}`}
                    >
                      Pay / Edit
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Single row: Due-this-week pill on the left, rollover pill (only
          when the user hasn't opted in yet) and Roll-in / Undo action on
          the right. Merged from two rows so there's no dead space when
          rollover is already in (hero card carries that state). */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        {dueItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDue((v) => !v)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              showDue ? "bg-negative/30 text-foreground" : "bg-negative/20 text-foreground hover:bg-negative/30"
            }`}
          >
            Due this week
            <span className="text-[10px] font-bold text-foreground">{dueItems.length}</span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <RolloverControl rollover={rollover} monthFirstOfMonth={monthFirstOfMonth} currency={currency} />
          {snapshot ? (
            <button
              type="button"
              disabled={undoPending}
              onClick={() => {
                const snap = snapshot;
                startUndo(async () => {
                  await restorePlansSnapshot(monthFirstOfMonth, snap);
                  setSnapshot(null);
                });
              }}
              className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-bold text-foreground transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60"
            >
              {undoPending ? "Undoing…" : `↩ Undo roll-in from ${prevMonthLabel}`}
            </button>
          ) : (
            <form
              action={(fd) =>
                startCopy(async () => {
                  const res = await copyPlansFromPreviousMonth(fd);
                  if (res && res.snapshot.length > 0) setSnapshot(res.snapshot);
                })
              }
            >
              <input type="hidden" name="month" value={monthFirstOfMonth} />
              <button
                type="submit"
                disabled={copyPending}
                className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-foreground transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60"
              >
                {copyPending ? "Copying…" : `↓ Roll in ${prevMonthLabel} planned`}
              </button>
            </form>
          )}
        </div>
      </div>
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
    <span className="inline-flex items-center gap-1.5">
      {/* Editing label — swaps in for the "Rollover July:" pill copy so it's
          obvious what the input is editing (the rolled-over amount, not
          the month's spending or income). Sits before the input, muted so
          the input itself stays the focal point. */}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Amount rollover
      </span>
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
        className="text-[10px] text-muted underline hover:text-foreground"
      >
        reset to {liveLabel}
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
  actualSpent,
  displayLeft,
  outflowPlanned,
  currency,
}: {
  actualLeft: number;
  actualSpent: number;
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
        <p className={`truncate text-sm font-medium tabular-nums sm:text-lg ${displayLeft < 0 ? "text-negative" : "text-positive"}`}>
          {formatMoney(displayLeft, currency)}
        </p>
        <p className="text-[10px] text-muted sm:text-xs">Income Left to Budget</p>
      </div>
      <div className="min-w-0 border-l border-line px-1 text-center">
        <p className="truncate text-sm font-medium tabular-nums text-negative sm:text-lg">{formatMoney(actualSpent, currency)}</p>
        <p className="text-[10px] text-muted sm:text-xs">Actual Spent</p>
      </div>
    </div>
  );
}
