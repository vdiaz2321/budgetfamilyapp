"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { addToPlan, copyPlansFromPreviousMonth, listPayees, restorePlansSnapshot, setRollover, setRolloverOverride, trimFromPlan } from "./actions";
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
  TxPrefill,
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
  payeeLineItems?: PayeeLineItem[];
  snowballExtraCents: number;
  snowballFocusSubId: string | null;
  transactions: TxData[];
  subscriptions: SubscriptionRow[];
  irregularBills: IrregularBillRow[];
  creditCards?: CreditCardOption[];
  /** Items that ended last month spending more than they were planned. */
  prevMonthOverspent: {
    monthKey: string;
    monthLabel: string;
    items: { subId: string; name: string; kind: CategoryKind; plannedCents: number; spentCents: number }[];
  };
  irregularMonthPlanned: number;
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
  payeeLineItems = [],
  snowballExtraCents,
  snowballFocusSubId,
  transactions,
  subscriptions,
  irregularBills,
  creditCards,
  prevMonthOverspent,
  irregularMonthPlanned,
  subscriptionMonthPlanned,
  subscriptionMonthSpent,
}: Props) {
  const router = useRouter();
  const [railTab, setRailTab] = useState<"summary" | "transactions">("summary");
  const [rowFilter, setRowFilter] = useState<"all" | "overspent">("all");
  const [showPrevOverspent, setShowPrevOverspent] = useState(false);
  // An item panel's Save closes the panel straight away and leaves the write
  // running, so the board — not the panel — reports how it went.
  const [saveStatus, setSaveStatus] = useState<"saving" | { error: string } | null>(null);
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
  // The hero card is always expanded — desktop and mobile alike. It used to
  // collapse to a one-line strip; Victor asked for the full summary on every
  // load, so there's no collapse state to persist any more.

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
  // Subscriptions whose own charge beat their own plan this month.
  const overspentSubscriptions = subscriptions.filter(
    (s) => (s.monthSpentCents ?? 0) > (s.monthPlannedCents ?? 0),
  );
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
  // What to seed a quick-add transaction with — set by the item panel's
  // "Prev Mo Spent" chip so last month's figure, account and payee land in the
  // form ready to review. undefined = a normal blank quick-add.
  const [quickAddPrefill, setQuickAddPrefill] = useState<TxPrefill | undefined>(undefined);
  // Fresh transaction modal opened from the top header's "+ Transaction"
  // button — no preselected item/kind, renders as a centered overlay so it
  // works with or without a selected budget row.
  const [showAddModal, setShowAddModal] = useState(false);
  const [duePayment, setDuePayment] = useState<DueItem | null>(null);
  // The payee autocomplete list is ~28KB — a sixth of this page's payload —
  // for a control most visits never open, so it's fetched the first time a
  // surface that needs it appears rather than shipped with the page.
  const [payeeOptions, setPayeeOptions] = useState<{ id: string; name: string }[]>([]);
  const payeesRequested = useRef(false);
  const loadPayees = () => {
    if (payeesRequested.current) return;
    payeesRequested.current = true;
    void listPayees().then(setPayeeOptions);
  };
  // Expanded state for the toolbar's "Due this week" pill (the list renders
  // directly under the toolbar row, above the category groups).
  const [showDue, setShowDue] = useState(false);
  // `amountOverride` comes from the "Prev Mo Spent" chip on a recurring
  // subscription — the modal opens at last month's actual charge instead of
  // the planned amount. Everything else about the payment is identical.
  const handlePayDue = (item: DueItem, amountOverride?: number) => {
    if (item.source === "subscription") {
      const fd = new FormData();
      fd.set("id", item.id);
      void advanceSubscriptionRenewal(fd);
    }
    loadPayees();
    setDuePayment(amountOverride != null ? { ...item, amountCents: amountOverride } : item);
  };

  // Precompute account_id → name so the item panel's tx list can render each
  // row's account without re-scanning accountOptions on every entry.
  const accountNameById = new Map(accountOptions.map((a) => [a.id, a.name]));
  const paymentAccountOptions = accountOptions.filter((a) => a.group === "Banking" || a.group === "Credit Cards");

  // On the current month the window is the real current week (plus anything
  // already overdue this month). On any other month it widens to that whole
  // month — browsing to September to plan ahead used to drop the pill with no
  // explanation, when "what falls due in September" is exactly the question
  // being asked. The label changes with it, so the two never get confused.
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = month.key === currentMonthKey;
  const viewedMonth = new Date(`${month.firstOfMonth}T00:00:00`);
  const dueThisWeek = (() => {
    const start = isCurrentMonth ? new Date(today) : new Date(viewedMonth);
    start.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
    // Show items from start of month (not just today) so overdue unpaid items
    // stay visible until Pay/Edit is clicked, not just until the date passes.
    const end = isCurrentMonth
      ? (() => { const e = new Date(start); e.setDate(e.getDate() + 7); return e; })()
      : new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 0);
    const inWindow = (value: Date) => value >= startOfMonth && value <= end;
    // Every kind that can carry a due day (bills, expenses, debt) contributes
    // to Due this week — not just the Bills group. Debt rows show what's still
    // outstanding this month against the planned payment.
    const budgetItems = groups
      .filter((group) => KINDS_WITH_DUE.includes(group.kind))
      .flatMap((group) => group.rows.map((row) => ({ row, kind: group.kind })))
      .flatMap(({ row, kind }) => {
        const dueDay = kind === "debt" ? (row.debt?.dueDay ?? row.dueDay) : row.dueDay;
        if (!dueDay) return [];
        const y = viewedMonth.getFullYear();
        const m = viewedMonth.getMonth();
        const due = new Date(y, m, Math.min(dueDay, new Date(y, m + 1, 0).getDate()));
        const amountCents = Math.max(0, row.plannedCents - row.spentCents);
        if (!inWindow(due) || amountCents <= 0) return [];
        const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
        return [{
          id: row.subId,
          name: row.name,
          kind,
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
      // Paid when THIS subscription's own charge has been logged. Every
      // subscription shares one "Subscriptions" budget row, so checking that
      // row's total instead meant the first payment of the month covered every
      // other subscription's amount and emptied the list — monthSpentCents is
      // the per-row figure, matched by payee on the Budget page.
      // A subscription whose amount is 0 (price varies, or it isn't known yet)
      // would otherwise satisfy `spent >= amount` with nothing logged at all
      // and never appear — those are precisely the ones needing the prefill.
      const paidCents = subscription.monthSpentCents ?? 0;
      if (paidCents > 0 && paidCents >= subscription.amountCents) return [];
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
        prevSpentCents: subscription.isRecurring ? subscription.prevSpentCents ?? 0 : 0,
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
        onAddTransaction={(prefill) => { loadPayees(); setQuickAddPrefill(prefill); setQuickAdd(true); }}
        onEditTransaction={(tx) => { loadPayees(); setQuickAdd(tx); }}
        onOverspentCovered={() => {
          setRowFilter("all");
          setSelected(null);
        }}
        onSaveStart={() => setSaveStatus("saving")}
        onSaveDone={(error) => setSaveStatus(error ? { error } : null)}
      />
    ) : null;

  const railContent = itemPanel;

  // The rail rides the page scroll rather than sticking, so a selected item's
  // detail panel would otherwise render at the very top of the page — far above
  // a row clicked halfway down the list. Offsetting the rail drops the panel
  // next to that row instead, centred on it so a tall panel doesn't hang off
  // the bottom of the screen with its Save button out of reach.
  //
  // The offset is applied as `position: relative; top`, NOT as a margin: a
  // margin grows the document by the offset, so closing the panel shrank the
  // page again and the browser clamped the scroll position — you'd get yanked
  // back toward the top of the budget every time you dismissed an item.
  const railRef = useRef<HTMLDivElement>(null);
  const [railOffset, setRailOffset] = useState(0);
  // Key the offset off the panel that is actually on screen, not off `selected`
  // alone: a selected row can vanish (deleted, or filtered out of the list) and
  // leave the panel unrendered. Keying on `selected` then stranded the Summary
  // card at the panel's old offset, way down the page with nothing above it.
  const panelSubId = railContent ? selected?.subId ?? null : null;
  useEffect(() => {
    // Below `lg` the panel is a bottom sheet, not the rail — no offset there.
    if (!panelSubId || window.innerWidth < 1024) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRailOffset(0);
      return;
    }
    const rail = railRef.current;
    const row = document.querySelector(`[data-drop-key="subcat:${panelSubId}"]`);
    if (!rail || !row) {
      // No row to centre on (collapsed group, filtered list): sit at the top
      // rather than keeping whatever offset the previous selection left behind.
      setRailOffset(0);
      return;
    }

    const rowRect = row.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const GAP = 16;
    // Centre the panel on the row rather than aligning their top edges.
    let wantTop = rowRect.top + rowRect.height / 2 - railRect.height / 2;
    // Then keep the whole panel on screen where it fits, so nothing below the
    // fold has to be scrolled to — the point of centring in the first place.
    if (railRect.height + GAP * 2 <= window.innerHeight) {
      wantTop = Math.min(
        Math.max(wantTop, GAP),
        window.innerHeight - railRect.height - GAP,
      );
    } else {
      wantTop = Math.min(wantTop, rowRect.top);
    }

    // Both rects are viewport-relative, so the page's scroll position cancels
    // out; the rail's own rect already includes the offset applied last time,
    // which is why this adjusts the previous value rather than replacing it.
    const delta = wantTop - railRect.top;
    const column = rail.parentElement?.previousElementSibling as HTMLElement | null;
    // Never push the panel past the bottom of the budget list, so it can't
    // float off into empty space below the last group.
    const maxOffset = Math.max(0, (column?.offsetHeight ?? 0) - rail.offsetHeight);

    setRailOffset((prev) => Math.max(0, Math.min(prev + delta, maxOffset)));
  }, [panelSubId]);

  // Clicking anywhere off the panel closes it, same as the mobile sheet's
  // backdrop. Clicks on a budget row are left alone — those switch the
  // selection — and the whole thing stands down while a transaction modal is
  // open, since that modal is rendered on top of (and gated by) the selection.
  const modalOpen = Boolean(showAddModal || quickAdd || duePayment);
  useEffect(() => {
    if (!selected || modalOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-item-panel-root]") || target.closest("[data-drop-key]")) return;
      setSelected(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selected, modalOpen]);

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
              actualSpent={actualSpent}
              displayLeft={displayLeft}
              outflowPlanned={outflowPlanned}
              currency={currency}
            />
          )}

          <div className="flex flex-wrap items-center gap-y-1.5 gap-x-1.5 rounded-xl px-0.5 py-1 sm:bg-surface/90 sm:px-2.5 sm:py-2 sm:shadow-sm sm:ring-1 sm:ring-black/5 sm:dark:ring-white/10">
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
            {/* Last month's unfinished business. A transaction entered days
                later can push an item past a plan you've stopped looking at,
                so the month you're on carries the reminder rather than leaving
                it to be found by chance. */}
            {prevMonthOverspent.items.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowPrevOverspent(true)}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-negative ring-1 ring-negative/25 transition hover:bg-negative/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-negative/50 sm:text-xs"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 10a9 9 0 1 1 2.6 6.4" />
                  <path d="M3 5v5h5" />
                </svg>
                {prevMonthOverspent.monthLabel.split(" ")[0]} overspent ({prevMonthOverspent.items.length})
              </button>
            ) : null}
            {/* Same order on both widths: [Due this week] [+ Cat Group]
                [+ Transaction], pushed right on mobile where the toolbar has
                no card chrome, left-aligned on desktop. */}
            <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
              {dueThisWeek.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDue((v) => !v)}
                  aria-pressed={showDue}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition sm:text-xs ${
                    showDue ? "bg-negative/30 text-foreground" : "bg-negative/20 text-foreground hover:bg-negative/30"
                  }`}
                >
                  {isCurrentMonth ? "Due this week" : `Due in ${month.label.split(" ")[0]}`}
                  <span className="font-bold text-foreground">{dueThisWeek.length}</span>
                </button>
              )}
              <AddCategoryGroupButton />
              <button
                type="button"
                onClick={() => { loadPayees(); setShowAddModal(true); }}
                className="h-7 shrink-0 cursor-pointer items-center rounded-lg bg-brand px-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-strong sm:rounded-full sm:px-3 sm:text-[11px]"
              >
                + Transaction
              </button>
            </div>
            {/* Desktop only: + Bulk add items sits next to the progress switch */}
            <div className="ml-auto hidden sm:block">
              <BulkAddSubcategories groups={groups} />
            </div>
            {/* One switch replaces the old separate on/off buttons. */}
            <button
              type="button"
              role="switch"
              aria-checked={detailsExpanded}
              aria-label={`Progress ${detailsExpanded ? "On" : "Off"}`}
              onClick={() => setRowDetail((current) => ({ ...current, expanded: current.expanded !== true }))}
              className={`group relative hidden h-7 items-center rounded-full p-1 transition sm:flex ${
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
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-semibold text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                Progress {detailsExpanded ? "On" : "Off"}
              </span>
            </button>
          </div>

          {showDue && dueThisWeek.length > 0 && (
            <DueItemsList dueItems={dueThisWeek} currency={currency} onPayDue={handlePayDue} />
          )}

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
                  loadPayees();
                  setRailTab("transactions");
                }}
              />
            ))}

            {/* The Bills group can only say "Subscriptions" is over — all
                subscriptions share one subcategory — so the overspent view
                also lists the individual subscriptions that went over. */}
            {showingOverspent && overspentSubscriptions.length > 0 ? (
              <SubscriptionsSummaryCard
                currency={currency}
                subscriptions={subscriptions}
                creditCards={creditCards}
                open
                onToggle={() => {}}
                monthPlannedCents={subscriptionMonthPlanned}
                monthSpentCents={subscriptionMonthSpent}
                overspentOnly
              />
            ) : null}

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
                  creditCards={creditCards}
                  open={openGroups["subscriptions"] ?? false}
                  onToggle={() => toggleGroup("subscriptions")}
                  monthPlannedCents={subscriptionMonthPlanned}
                  monthSpentCents={subscriptionMonthSpent}
                  onOpenSpent={() => {
                    const subId = subscriptions.find((s) => s.subcategoryId)?.subcategoryId;
                    if (subId) {
                      toggleFilterSub(subId, "Subscriptions");
                      loadPayees();
                      setRailTab("transactions");
                    }
                  }}
                />

                <IrregularBillsSummaryCard
                  currency={currency}
                  monthFirstOfMonth={month.firstOfMonth}
                  plannedTotalCents={irregularMonthPlanned}
                  subscriptions={subscriptions}
                  irregularBills={irregularBills}
                  creditCards={creditCards}
                  open={openGroups["irregularBills"] ?? false}
                  onToggle={() => toggleGroup("irregularBills")}
                  onOpenSpent={() => {
                    const subId = irregularBills.find((b) => b.subcategoryId)?.subcategoryId;
                    if (subId) {
                      toggleFilterSub(subId, "Irregular Bills");
                      loadPayees();
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
        {/* Deliberately not sticky and not its own scroll container: the rail
            rides the page scroll with the budget list beside it, so there is
            one scrollbar for the whole page. Pinning it either hid the rail's
            own overflow until the page had scrolled past, or forced a second
            scrollbar that moved out of step with the list. */}
        <div
          ref={railRef}
          data-item-panel-root
          className="relative space-y-3"
          style={railOffset ? { top: railOffset } : undefined}
        >
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
                  onClick={() => { loadPayees(); setRailTab("transactions"); }}
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
          {/* The sheet's surface reaches the very top of the screen, but its
              CONTENT is pushed clear of it: flush against top:0 the panel's
              title and close button land under the iPhone's status bar / notch
              and get clipped. The padding sits on this outer, non-scrolling box
              so it stays put instead of scrolling away with the content. */}
          <div data-item-panel-root className="fixed inset-x-0 top-0 z-[70] flex max-h-[85vh] flex-col rounded-b-2xl bg-background pt-[max(env(safe-area-inset-top),1.75rem)] shadow-xl">
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              {railContent}
              <div className="mx-auto mb-2 mt-2 h-1 w-10 rounded-full bg-line" />
            </div>
          </div>
        </div>
      ) : null}

      {/* Centered modal: header "+ Transaction" OR item panel "+ Transaction" */}
      {saveStatus ? (
        <div
          // Clear of the mobile tab bar and the home indicator — pinned at
          // bottom-4 the pill landed on top of "Transactions".
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 sm:bottom-6"
        >
          {saveStatus === "saving" ? (
            <p className="rounded-full bg-foreground/90 px-4 py-2 text-xs font-semibold text-background shadow-lg">
              Saving…
            </p>
          ) : (
            <p className="pointer-events-auto flex items-center gap-3 rounded-xl bg-negative px-4 py-2.5 text-xs font-semibold text-white shadow-lg">
              {saveStatus.error}
              <button type="button" onClick={() => setSaveStatus(null)} className="rounded px-1 text-white/80 hover:text-white">
                Dismiss
              </button>
            </p>
          )}
        </div>
      ) : null}

      {showPrevOverspent ? (
        <ModalShell
          title={`Overspent in ${prevMonthOverspent.monthLabel}`}
          onClose={() => setShowPrevOverspent(false)}
          mobileAlign="top"
          className="sm:max-w-lg"
        >
          <div className="space-y-3 p-5">
            {/* Rows stack on a phone: side by side, the amounts squeeze the
                name down to "Johana's ..." and the row stops being readable,
                which is the whole point of the list. */}
            <ul className="divide-y divide-line/60 rounded-xl ring-1 ring-black/5 dark:ring-white/10">
              {prevMonthOverspent.items.map((item) => (
                <li key={item.subId} className="grid grid-cols-1 items-center gap-x-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">{item.name}</span>
                  {/* Both figures are labelled: "$1,596.79 of $1,571.77" reads
                      either way round, and the two numbers are close enough
                      that the bigger one isn't obviously the spend. Planned
                      first, then Spent — the same order as the columns on the
                      board. Each half is nowrap so a phone breaks between
                      them, not mid-phrase. */}
                  <span className="flex items-baseline justify-between gap-2 text-xs tabular-nums sm:justify-end">
                    <span className="whitespace-nowrap text-muted">
                      Planned {formatMoney(item.plannedCents, currency)} · Spent {formatMoney(item.spentCents, currency)}
                    </span>
                    <span className="whitespace-nowrap font-bold text-negative">
                      +{formatMoney(item.spentCents - item.plannedCents, currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setShowPrevOverspent(false);
                // Same cookie the month picker writes, so the board keeps
                // showing that month until it's navigated away from.
                document.cookie = `budget-month=${prevMonthOverspent.monthKey}; path=/; SameSite=Lax`;
                router.push(`/budget?month=${prevMonthOverspent.monthKey}`);
              }}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
            >
              Go to {prevMonthOverspent.monthLabel}
            </button>
          </div>
        </ModalShell>
      ) : null}

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
              initialAccountId={duePayment?.accountId ?? quickAddPrefill?.accountId ?? undefined}
              initialAmountCents={duePayment?.amountCents ?? quickAddPrefill?.cents}
              initialPayee={duePayment?.name ?? quickAddPrefill?.payee ?? undefined}
              initialDate={duePayment?.dueDate}
              onClose={() => { setShowAddModal(false); setQuickAdd(false); setQuickAddPrefill(undefined); setDuePayment(null); }}
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

// Reconcile planned outflow with income, in whichever direction the month is
// out of balance. "assign" gives unassigned income a job (one-sided increase);
// "trim" un-budgets money when planned outflow exceeds income (one-sided
// decrease). Neither moves money between two items — that's `coverOverspend`,
// which lives on the item panel.
//
// A modal rather than inline controls: the hero card is a dense grid of
// figures, and dropping a select + input + two buttons into it pushed the
// numbers around. The trigger stays a small pill; the form gets room.
function AssignLeftover({
  mode = "assign",
  leftoverCents,
  monthKey,
  currency,
  options,
}: {
  mode?: "assign" | "trim";
  leftoverCents: number;
  monthKey: string;
  currency: string;
  options: SubOption[];
}) {
  const trimming = mode === "trim";
  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();

  // Outflow items only — assigning income to an income line is meaningless.
  // Trimming additionally needs a real stored plan to cut into: auto-calculated
  // rows (Subscriptions, Irregular Bills) show a remaining balance derived from
  // their own totals with no budget_plans row behind it, so offering them here
  // would be a dead end — the server has nothing to decrement.
  const targets = options.filter(
    (o) => o.kind !== "income" && (!trimming || (o.trimmableCents ?? 0) > 0),
  );
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

  const amountValue = Number(amount.replace(/[^0-9.-]/g, ""));
  const amountValid = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const fd = new FormData();
    fd.set("subcategoryId", toId);
    fd.set("month", monthKey);
    fd.set(trimming ? "trimAmount" : "addAmount", amount);
    start(async () => {
      const res = trimming ? await trimFromPlan(fd) : await addToPlan(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setToId("");
      setFilter("");
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setAmount(""); setError(null); setOpen(true); }}
        className={`mt-1.5 inline-flex w-fit cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
          trimming
            ? "bg-negative/10 text-negative ring-negative/20 hover:bg-negative/20"
            : "bg-brand-soft text-brand ring-brand/20 hover:bg-brand/20"
        }`}
      >
        <span aria-hidden>{trimming ? "−" : "+"}</span>
        {trimming ? "Trim an item" : "Assign to an item"}
      </button>

      {open ? (
        <ModalShell title={trimming ? "Trim a budget item" : "Assign to a budget item"} onClose={() => setOpen(false)} className="sm:max-w-md" mobileAlign="top">
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-muted">
              <span className={`font-semibold tabular-nums ${trimming ? "text-negative" : "text-foreground"}`}>
                {formatMoney(Math.abs(leftoverCents), currency)}
              </span>{" "}
              {trimming ? "more is planned than there is income to cover." : "of planned income has no job yet."}
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
            </label>

            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                {trimming ? "Take from" : "Assign to"}
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
                  <p className="px-3 py-4 text-center text-xs leading-relaxed text-muted">
                    {trimming && filter.trim() === ""
                      ? "Nothing here can be trimmed — this month's plan comes from auto-calculated Subscriptions and Irregular Bills. Edit those items to change it."
                      : "No items match."}
                  </p>
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
                              ? trimming ? "bg-negative/10 font-semibold" : "bg-brand-soft font-semibold"
                              : "hover:bg-black/5 dark:hover:bg-white/10"
                          }`}
                        >
                          <span className="min-w-0 truncate">{o.name}</span>
                          {(trimming ? o.trimmableCents : o.remainingCents) != null ? (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted">
                              {formatMoney((trimming ? o.trimmableCents : o.remainingCents) ?? 0, currency)} left
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
                disabled={pending || !toId || !amountValid}
                onClick={submit}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${trimming ? "bg-negative" : "bg-brand"}`}
              >
                {pending ? (trimming ? "Trimming…" : "Assigning…") : trimming ? "Trim" : "Assign"}
              </button>
            </div>
            {error ? <p className="text-xs text-negative">{error}</p> : null}
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

// Overspent means the month's spending has passed the income PLANNED for it,
// not the income received so far. Measured against what has landed, the badge
// fired on the 1st of every month — before a single paycheque was in, any
// spending at all read as overspending.
function getBudgetStatus(
  actualSpent: number,
  incomePlanned: number,
): { tone: BudgetTone; badgeText: string } {
  if (actualSpent > incomePlanned) return { tone: "bad", badgeText: "Overspent" };
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
}: {
  label: string;
  actualLabel: string;
  actualColorClass: string;
  actual: number;
  planned: number;
  dotClass: string;
  fillClass: string;
  currency: string;
}) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  return (
    <div className="rounded-xl bg-background/60 px-3 py-2 ring-1 ring-line">
      {/* Wraps rather than truncates: when the card is full-width on mobile the
          amounts are long enough to squeeze a truncating label down to an
          ellipsis, so they drop to their own line instead. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="whitespace-nowrap text-[11px] text-muted">{label}</span>
        <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums sm:text-xs">
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
}: {
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
}) {
  const { tone, badgeText } = getBudgetStatus(actualSpent, incomePlanned);
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div className="-mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-2xl dark:ring-white/10">
      <div className="px-6 pb-5 pt-5">
        {/* Desktop packs the four figures into a tight 2x2 on the left and
            stacks the progress cards down the right, so the old dead gutter
            between the left and right money columns disappears. Below md it
            falls back to the previous stacked layout. */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] md:gap-x-8">
        <div className="flex min-w-0 flex-col">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:gap-x-8">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Planned</p>
            <p className="mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums text-positive">
              {formatMoney(incomePlanned, currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Actual Spent</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
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
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Planned Budget</p>
            <p className="mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums text-foreground">
              {formatMoney(outflowPlanned, currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Income Left to Budget</p>
            <p className={`mt-0.5 whitespace-nowrap text-2xl font-bold tabular-nums ${displayLeft < 0 ? "text-negative" : "text-foreground"}`}>
              {formatMoney(displayLeft, currency)}
            </p>
            {/* Zero-based budgeting says every dollar gets a job. This figure
                used to sit here as a read-only fact; now it's the entry point
                for giving the money one — or, when the month is over-budgeted,
                for taking a job away so the two sides balance again. */}
            {displayLeft !== 0 ? (
              <AssignLeftover
                mode={displayLeft < 0 ? "trim" : "assign"}
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
        </div>

        {/* Rollover + Roll-in used to sit in a full-width strip under the
            card; pulled up under the figures so they fill the space the left
            column was leaving empty. Spans the whole 2-col stat block rather
            than living in one cell, so the pills don't wrap on mobile. */}
        <RolloverFooter rollover={rollover} monthFirstOfMonth={monthFirstOfMonth} currency={currency} />
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:mt-0 md:grid-cols-1 md:content-start">
          <CategoryProgressCard label="Income" actualLabel="Rec'd" actualColorClass="text-positive" actual={actualIncome} planned={incomePlanned} dotClass="bg-[color:var(--positive)]" fillClass="bg-[color:var(--positive)]" currency={currency} />
          <CategoryProgressCard label="Savings" actualLabel="Saved" actualColorClass="text-positive" actual={savings.spent} planned={savings.planned} dotClass="bg-[color:var(--viz-savings)]" fillClass="bg-[color:var(--viz-savings)]" currency={currency} />
          <CategoryProgressCard label="Bills & Expenses" actualLabel="Spent" actualColorClass="text-negative" actual={billsExpenses.spent} planned={billsExpenses.planned} dotClass="bg-[color:var(--viz-bills)]" fillClass="bg-[color:var(--viz-bills)]" currency={currency} />
          <CategoryProgressCard label="Debt Repayment" actualLabel="Paid" actualColorClass="text-negative" actual={debt.spent} planned={debt.planned} dotClass="bg-[color:var(--viz-debt)]" fillClass="bg-[color:var(--viz-debt)]" currency={currency} />
        </div>
        </div>
      </div>
    </div>
  );
}

// The Due-this-week list, expanded by the toolbar pill above the group list.
function DueItemsList({
  dueItems,
  currency,
  onPayDue,
}: {
  dueItems: DueItem[];
  currency: string;
  onPayDue?: (item: DueItem, amountOverride?: number) => void;
}) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
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
              {/* A zero here is a subscription whose price isn't on file (it
                  varies, or was never entered) — those are kept in the list on
                  purpose. "$0.00" read as "nothing owed", which is the opposite
                  of what it means. Budget items never reach zero here: they're
                  dropped from the list once nothing is left to pay. */}
              {item.amountCents > 0 ? (
                <p className="text-sm font-semibold tabular-nums">{formatMoney(item.amountCents, currency)}</p>
              ) : (
                <p className="text-[11px] font-semibold text-muted">Amount not set</p>
              )}
              {onPayDue && (
                <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                  {/* Only when last month actually had a charge to copy, and
                      only when it differs from the planned amount — otherwise
                      the chip is a second button that does exactly what
                      Pay / Edit already does. */}
                  {item.prevSpentCents && item.prevSpentCents > 0 && item.prevSpentCents !== item.amountCents ? (
                    <button
                      type="button"
                      onClick={() => onPayDue(item, item.prevSpentCents)}
                      className="rounded-md bg-black/[0.04] px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-black/10 dark:bg-white/[0.08] dark:hover:bg-white/15"
                    >
                      <span aria-hidden="true">↺</span> Prev Mo {formatMoney(item.prevSpentCents, currency)}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onPayDue(item)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${isOverdue ? "bg-negative/15 text-negative hover:bg-negative/25" : "bg-brand-soft text-brand hover:bg-brand/20"}`}
                  >
                    Pay / Edit
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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

// Footer row: [rollover amount] [Rollover/Remove btn]. The Due-this-week pill
// lives in the board toolbar instead, next to + Cat Group.
function RolloverFooter({
  rollover,
  monthFirstOfMonth,
  currency,
}: {
  rollover: Props["rollover"];
  monthFirstOfMonth: string;
  currency: string;
}) {
  const [copyPending, startCopy] = useTransition();
  const [undoPending, startUndo] = useTransition();
  const [snapshot, setSnapshot] = useState<
    Array<{ subcategory_id: string; planned_cents: number | null }> | null
  >(null);
  const { prevMonthLabel } = rollover;

  useEffect(() => {
    if (!snapshot) return;
    const t = window.setTimeout(() => setSnapshot(null), 30_000);
    return () => window.clearTimeout(t);
  }, [snapshot]);
  return (
    // Renders inline inside the hero's left column, so no strip chrome — just
    // the rollover pill and the Roll-in / Undo action on one wrapping row.
    <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-auto md:pt-4">
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
  actualSpent,
  displayLeft,
  outflowPlanned,
  currency,
}: {
  actualSpent: number;
  displayLeft: number;
  outflowPlanned: number;
  currency: string;
}) {
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
