"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, centsToGroupedDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import {
  addAccount,
  addCreditCardWithDetails,
  addBucket,
  closeCard,
  deleteAccount,
  deleteBucket,
  logCreditCardRewardActivity,
  setCreditCardRewardActivityArchived,
  payCard,
  transferBetweenAccounts,
  reorderAccounts,
  reorderBuckets,
  reopenCard,
  updateAccount,
  updateBalance,
  updateBucket,
  updateBucketBalance,
  upsertCardDetails,
} from "./actions";
import { setAccountSnapshot, setBucketSnapshot } from "../networth/actions";
import { DEBT_KINDS } from "../budget/types";
import { isDebtExcludedFromNetWorth } from "@/lib/net-worth";
import { PeriodPicker } from "../insights/insights-period-picker";
import { currentPeriodKey, periodLabel, priorKey, type Granularity } from "../insights/period";

// Resolve a period key to the "YYYY-MM-01" account_snapshots.month whose
// balance represents that period's end. Returns null when the period IS
// the current month/quarter/year — we prefer the live current balance in
// that case since a snapshot may lag intra-period activity.
function periodSnapshotMonthFor(
  granularity: Granularity,
  periodKey: string,
): string | null {
  const now = new Date();
  const cur = currentPeriodKey(granularity, now);
  if (periodKey === cur) return null;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (granularity === "monthly") return `${periodKey}-01`;
  if (granularity === "quarterly") {
    const y = Number(periodKey.slice(0, 4));
    const q = Number(periodKey.slice(6));
    const endMonth = q * 3; // 3, 6, 9, 12
    return `${y}-${pad2(endMonth)}-01`;
  }
  if (granularity === "yearly") return `${periodKey}-12-01`;
  return null; // weekly (not offered on Accounts) or unknown
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-07-01" -> "Jul"
function monthAbbr(firstOfMonth: string): string {
  return MONTH_ABBR[parseInt(firstOfMonth.slice(5, 7), 10) - 1] ?? "";
}

function maskAccountNumber(accountNumber: string | null): string | null {
  const lastFour = accountNumber?.replace(/\s/g, "").slice(-4);
  return lastFour ? `•••• ${lastFour}` : null;
}

function externalCardUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export type BucketData = {
  id: string;
  accountId: string;
  name: string;
  balanceCents: number;
  // Its own Checking/Savings tag — accounts with a mix of both (e.g. a
  // "Checking" bucket and a "Savings" bucket under one bank account) no
  // longer have to force the whole account into one type.
  bankGroup: "savings" | "spending" | null;
  // Every recorded month of bucket_snapshots, keyed "YYYY-MM-01" (a missing
  // month = never recorded). Lets a bucket row follow the header's period
  // picker instead of being pinned to the last three months.
  balancesByMonth: Record<string, number>;
};

export type CardDetails = {
  rewardsCategory: "travel" | "hotel" | null;
  rewardsProgram: string | null;
  pointsValueMicros: number | null;
  five24Countable: boolean;
  bank: string | null;
  authUser: string | null;
  charging: string | null;
  bonusInfo: string | null;
  bonusSpendCents: number | null;
  bonusSpendDeadline: string | null;
  bonusEarned: boolean;
  currentPoints: number;
  feesPaidCents: number;
  freeNightCreditCents: number | null;
  freeNightExpiresOn: string | null;
  freeNightPointsLimit: number | null;
  benefitUsedOn: string | null;
  spendingLimitCents: number | null;
  remarks: string | null;
  isRevolvingDebt: boolean;
  debtSubcategoryId: string | null;
  cardUrl: string | null;
  benefitCadence: string | null;
  payoffBalanceCents: number;
  payoffMinimumCents: number;
  payoffPlannedCents: number;
  payoffApr: number;
  payoffDueDay: number | null;
  promoAprEndsOn: string | null;
};

export type RewardActivity = {
  id: string;
  type: "points_redemption" | "hotel_credit_redemption" | "free_night_booking";
  occurredOn: string;
  pointsDelta: number;
  hotelCreditDeltaCents: number;
  bookedOn: string | null;
  note: string | null;
  archivedAt: string | null;
};

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  subtype: string | null; // free-text label, e.g. "Roth IRA", "Trump Account", "UTMA"
  holder: string | null;
  institution: string | null;
  accountNumber: string | null;
  ownership: "sole" | "joint";
  debtTrackingMode: "budget" | "account";
  active: boolean;
  isKidsAccount: boolean;
  bankGroup: "savings" | "spending" | null;
  balanceCents: number;
  annualFeeCents: number | null;
  feeWaived: boolean;
  dateOpened: string | null;
  dateClosed: string | null;
  // Credit-card only. Auto-computed on the server for CCs.
  cardDetails?: CardDetails | null;
  rewardActivities: RewardActivity[];
  owedCents?: number;
  monthSpendCents?: number;
  // Prior-month account_snapshots (null = never recorded yet for that month).
  // For bucketed accounts these are derived server-side from bucket_snapshots.
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
  // Every snapshot the server has for this account, keyed by "YYYY-MM-01".
  // Lets the header's period picker resolve the section total to a chosen
  // historical month/quarter/year without another round trip.
  balancesByMonth?: Record<string, number>;
  buckets: BucketData[];
};

// Non-CC accounts, passed in for the Pay Card modal's "From" dropdown.
export type NonCardAccount = {
  id: string;
  name: string;
  kind: string;
  hasBuckets: boolean;
};


// A debt from the Budget Debt group — shown here read-only (Budget is the
// single source of truth for debts).
export type BudgetDebt = {
  subcategoryId: string;
  name: string;
  balanceCents: number;
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
  // Every snapshot recorded for this debt subcategory, keyed by "YYYY-MM-01".
  // Powers the header period picker's Debts / Net Worth totals + deltas.
  balancesByMonth?: Record<string, number>;
  debtKind: string | null;
  accountId: string | null;
};

// The plan's account types, mapped onto the account_kind enum. debt_loan is
// legacy/managed from Budget → shown only if rows exist. Kids Funding is its
// own group by the is_kids_account flag, not by kind — it can hold checking,
// savings, or investment accounts (Fidelity, Capital One, a Trump Account…).
type Section = {
  key: string;
  label: string;
  dot: string;
  liability: boolean;
  // Which accounts belong here.
  match: (a: AccountData) => boolean;
  // Sub-kind choices offered by the add form (label per kind).
  kindLabels: Record<string, string>;
  fixedKind?: string;
  // Free-text "Type" field (e.g. Retirement, Roth IRA, 529, Trump Account).
  offerSubtype?: boolean;
  kidsGroup?: boolean;
  creditCard?: boolean;
};

const SECTIONS: Section[] = [
  {
    key: "banking",
    label: "Banking",
    dot: "bg-[color:var(--viz-savings)]",
    liability: false,
    match: (a) => !a.isKidsAccount && (a.kind === "checking" || a.kind === "savings_bucket" || a.kind === "cash"),
    kindLabels: { checking: "Checking", savings_bucket: "Savings", cash: "Cash" },
  },
  {
    key: "investments",
    label: "Investments",
    dot: "bg-sky-500",
    liability: false,
    match: (a) => !a.isKidsAccount && a.kind === "investment",
    kindLabels: { investment: "Investment" },
    offerSubtype: true,
  },
  {
    key: "credit",
    label: "Credit Cards",
    dot: "bg-negative",
    liability: false,
    match: (a) => a.kind === "credit_card" && !a.dateClosed,
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
  {
    key: "credit_closed",
    label: `Closed cards · ${new Date().getFullYear()}`,
    dot: "bg-negative",
    liability: false,
    match: (a) => {
      if (a.kind !== "credit_card" || !a.dateClosed) return false;
      const closedYear = new Date(a.dateClosed).getFullYear();
      return closedYear === new Date().getFullYear();
    },
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
  {
    key: "credit_archived",
    label: "Closed cards archive",
    dot: "bg-muted",
    liability: false,
    match: (a) => {
      if (a.kind !== "credit_card" || !a.dateClosed) return false;
      const closedYear = new Date(a.dateClosed).getFullYear();
      return closedYear < new Date().getFullYear();
    },
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
  {
    key: "loans",
    label: "Debts",
    dot: "bg-[color:var(--viz-debt)]",
    liability: true,
    match: (a) => a.kind === "debt_loan",
    kindLabels: { debt_loan: "Loan" },
    offerSubtype: true,
  },
  // Kids Funding sits last — it's the kids' money, excluded from Assets / Net
  // Worth, so it reads as a footnote beneath the household's own accounts.
  {
    key: "kids",
    label: "Kids Funding",
    dot: "bg-[color:var(--viz-bills)]",
    liability: false,
    match: (a) => a.isKidsAccount,
    kindLabels: { checking: "Checking", savings_bucket: "Savings", investment: "Investment" },
    offerSubtype: true,
    kidsGroup: true,
  },
];

type Props = {
  accounts: AccountData[];
  budgetDebts: BudgetDebt[];
  currency: string;
  nonCardAccounts?: NonCardAccount[];
  // [current, prev, prev2] as YYYY-MM-01 — powers the three balance columns.
  historyMonths: [string, string, string];
};

export function AccountsBoard({
  accounts,
  budgetDebts,
  currency,
  nonCardAccounts = [],
  historyMonths,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  // Period picker on the Accounts header — same control as Insights. Local
  // state (no URL sync) since the state is UI-only here. The picker's
  // filtering DOES NOT extend to the Credit Card Rewards section below —
  // rewards points and travel benefits are cumulative/lifetime data that
  // doesn't slice cleanly by period. It's read purely for header/summary
  // context that a future revision can wire into historical balances.
  const [periodGranularity, setPeriodGranularity] = useState<Granularity>("monthly");
  const [periodKey, setPeriodKey] = useState<string>(() => currentPeriodKey("monthly"));
  // The month whose snapshot represents the selected period's end. Used to
  // resolve section totals + hero stats (Assets / Debts / Net Worth) back
  // to a historical balance. Current month → null so we keep showing the
  // live current balance instead of a snapshot that may be stale.
  const periodSnapshotMonth = periodSnapshotMonthFor(periodGranularity, periodKey);
  // Prior period's snapshot month, for the "% vs last period" deltas on the
  // Assets / Debts / Net Worth cards. Even for the default "This month" we
  // want a comparison, so use the previous month's snapshot as the baseline.
  const priorPeriodKey = priorKey(periodGranularity, periodKey);
  const priorSnapshotMonth = periodSnapshotMonthFor(periodGranularity, priorPeriodKey)
    // priorKey for a monthly picker at This-month returns Last-month, but
    // periodSnapshotMonthFor returns null when the resolved key equals
    // "current" — which it won't here, so this is defensive only.
    ?? `${priorPeriodKey}-01`;
  const priorPeriodLabel = periodLabel(periodGranularity, priorPeriodKey);
  // The three month columns shown when a section is expanded. These used to be
  // fixed to [this month, last, the one before] from the server, so selecting
  // "Last month" moved the section totals but left the columns still headed
  // AUG — the totals and the rows underneath them disagreed.
  //
  // Anchored on the selected period's end month instead, so picking July shows
  // JUL / JUN / MAY.
  const shiftMonth = (monthKey: string, back: number): string => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 - back, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  const anchorMonth = periodSnapshotMonth ?? historyMonths[0];
  const displayMonths: [string, string, string] = [
    anchorMonth,
    shiftMonth(anchorMonth, 1),
    shiftMonth(anchorMonth, 2),
  ];
  // Resolve an account's balance for the currently-selected period: the
  // historical snapshot if one exists for that month, otherwise the live
  // current balance so pre-history months don't blank the total.
  const balanceOf = (a: AccountData): number => {
    if (!periodSnapshotMonth) return a.balanceCents;
    return a.balancesByMonth?.[periodSnapshotMonth] ?? a.balanceCents;
  };
  const priorBalanceOf = (a: AccountData): number | null => {
    return a.balancesByMonth?.[priorSnapshotMonth] ?? null;
  };
  const active = accounts.filter((a) => a.active);
  const isLiability = (kind: string) => kind === "credit_card" || kind === "debt_loan";

  const assets = active
    .filter((a) => !isLiability(a.kind) && !a.isKidsAccount)
    .reduce((sum, a) => sum + balanceOf(a), 0);
  // Prior assets for the % change subtitle. Only counts accounts that HAVE
  // a prior snapshot so a newly-opened account doesn't dilute the comparison.
  const assetAccounts = active.filter((a) => !isLiability(a.kind) && !a.isKidsAccount);
  const priorAssets = (() => {
    let sum = 0;
    let covered = 0;
    for (const a of assetAccounts) {
      const p = priorBalanceOf(a);
      if (p == null) continue;
      sum += p;
      covered += 1;
    }
    return covered === 0 ? null : sum;
  })();
  // Build a map so we can tell which debts are already shown as debt_loan account rows.
  const accountKindById = new Map(active.map((a) => [a.id, a.kind]));
  const isDebtLoanLinked = (d: BudgetDebt) =>
    !!d.accountId && accountKindById.get(d.accountId) === "debt_loan";

  // Debt totals resolve to the selected period's snapshot when we have one,
  // falling back to the live current balance otherwise (same rule as assets).
  const debtBalanceOf = (d: BudgetDebt): number => {
    if (!periodSnapshotMonth) return d.balanceCents;
    return d.balancesByMonth?.[periodSnapshotMonth] ?? d.balanceCents;
  };
  const priorDebtBalanceOf = (d: BudgetDebt): number | null =>
    d.balancesByMonth?.[priorSnapshotMonth] ?? null;

  // debt_loan accounts are counted directly from the accounts array.
  const directDebtTotal = active
    .filter((a) => a.kind === "debt_loan")
    .reduce((sum, a) => sum + Math.abs(balanceOf(a)), 0);
  const countedDirectDebtTotal = active
    .filter((a) => a.kind === "debt_loan" && !isDebtExcludedFromNetWorth(a.subtype))
    .reduce((sum, a) => sum + Math.abs(balanceOf(a)), 0);

  // Budget debts only count rows NOT already represented as a debt_loan account
  // (e.g. credit cards flagged as revolving/payoff debt).
  const budgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) ? sum : sum + debtBalanceOf(d)),
    0,
  );
  const countedBudgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) || isDebtExcludedFromNetWorth(d.debtKind) ? sum : sum + debtBalanceOf(d)),
    0,
  );
  // Rewards cards are tracked separately from the Debt section. Their
  // transaction activity must not be converted into a household debt row.
  const debtsTotal = budgetDebtTotal + directDebtTotal;
  const mortgageExcluded = countedBudgetDebtTotal !== budgetDebtTotal || countedDirectDebtTotal !== directDebtTotal;
  const net = assets - countedBudgetDebtTotal - countedDirectDebtTotal;

  // Prior debt totals for the "% vs last period" subtitle. Both direct (debt_loan
  // accounts) and budget-debt subcategories have their own snapshot tables now,
  // so both contribute to the prior baseline when snapshots exist. Anything
  // without a prior snapshot falls back to its current balance so
  // newly-tracked debts don't fabricate a swing.
  const debtLoanAccounts = active.filter((a) => a.kind === "debt_loan");
  const priorDirectDebt = (() => {
    let sum = 0;
    let covered = 0;
    for (const a of debtLoanAccounts) {
      const p = priorBalanceOf(a);
      if (p == null) {
        sum += Math.abs(balanceOf(a));
        continue;
      }
      sum += Math.abs(p);
      covered += 1;
    }
    return { sum, covered };
  })();
  const priorCountedDirectDebt = (() => {
    let sum = 0;
    let covered = 0;
    for (const a of debtLoanAccounts) {
      if (isDebtExcludedFromNetWorth(a.subtype)) continue;
      const p = priorBalanceOf(a);
      if (p == null) {
        sum += Math.abs(balanceOf(a));
        continue;
      }
      sum += Math.abs(p);
      covered += 1;
    }
    return { sum, covered };
  })();
  const priorBudgetDebt = (() => {
    let sum = 0;
    let covered = 0;
    for (const d of budgetDebts) {
      if (isDebtLoanLinked(d)) continue;
      const p = priorDebtBalanceOf(d);
      if (p == null) {
        sum += debtBalanceOf(d);
        continue;
      }
      sum += p;
      covered += 1;
    }
    return { sum, covered };
  })();
  const priorCountedBudgetDebt = (() => {
    let sum = 0;
    let covered = 0;
    for (const d of budgetDebts) {
      if (isDebtLoanLinked(d) || isDebtExcludedFromNetWorth(d.debtKind)) continue;
      const p = priorDebtBalanceOf(d);
      if (p == null) {
        sum += debtBalanceOf(d);
        continue;
      }
      sum += p;
      covered += 1;
    }
    return { sum, covered };
  })();
  // Show a delta if EITHER source (accounts or budget debts) has real prior
  // coverage — otherwise it's flat by construction and misleading.
  const priorDebts = priorDirectDebt.covered + priorBudgetDebt.covered === 0
    ? null
    : priorDirectDebt.sum + priorBudgetDebt.sum;
  const priorCountedDebt = priorCountedDirectDebt.covered + priorCountedBudgetDebt.covered === 0
    ? null
    : priorCountedDirectDebt.sum + priorCountedBudgetDebt.sum;
  const priorNet = priorAssets == null || priorCountedDebt == null
    ? null
    : priorAssets - priorCountedDebt;

  const assetSections = SECTIONS.filter((s) => !s.liability && !s.creditCard && !s.kidsGroup);
  const kidsSections = SECTIONS.filter((s) => s.kidsGroup);
  const creditSections = SECTIONS.filter((s) => s.creditCard);
  const excludedSections = [...kidsSections, ...creditSections];

  // Hide only debts linked to a debt_loan account (those show as their own account row).
  // Payoff-tracked credit-card debts still list here so the Debts section stays the single view of what's owed.
  const visibleBudgetDebts = budgetDebts.filter(
    (d) => d.balanceCents !== 0 && !isDebtLoanLinked(d),
  );
  const debtSectionsToRender = SECTIONS.filter(
    (s) =>
      s.liability &&
      (accounts.some((a) => s.match(a)) || (s.key === "loans" && visibleBudgetDebts.length > 0)),
  );
  const sectionKeys = [
    ...assetSections.map((s) => s.key),
    ...excludedSections.map((s) => s.key),
    ...debtSectionsToRender.map((s) => s.key),
    ...(visibleBudgetDebts.length > 0 ? ["budget_debts"] : []),
  ];
  const [collapsed, setCollapsed] = useSessionCollapse("accounts-sections-open", () =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.key !== "credit"])),
  );
  const allOpen = sectionKeys.every((k) => !collapsed[k]);
  const toggleSection = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Each account's bucket-drawer open/closed state, keyed by account id —
  // survives navigating to another page and back within the same browser
  // session instead of resetting to its default every time this board
  // remounts. See feedback: "Amex Savings keeps staying expanded... when I
  // collapse it when moving to a different page."
  // Overview section (net-worth tiles + the four group cards) collapses on its
  // own key so it survives a page change like every other section here.
  const [overviewCollapsed, setOverviewCollapsed] = useSessionCollapse("accounts-overview-open", () => ({
    overview: false,
  }));
  const overviewOpen = !overviewCollapsed.overview;

  const [bucketsOpen, setBucketsOpen] = useSessionCollapse("accounts-buckets-open", () =>
    Object.fromEntries(accounts.filter((a) => a.buckets.length > 0).map((a) => [a.id, false])),
  );
  const isBucketsOpen = (id: string) => bucketsOpen[id] ?? false;
  const toggleBuckets = (id: string) =>
    setBucketsOpen((c) => ({ ...c, [id]: !isBucketsOpen(id) }));

  // Expand/collapse all — sections and every account's bucket drawer together.
  const toggleAll = () => {
    setCollapsed(Object.fromEntries(sectionKeys.map((k) => [k, allOpen])));
    setBucketsOpen(
      Object.fromEntries(accounts.filter((a) => a.buckets.length > 0).map((a) => [a.id, !allOpen])),
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* Title + period picker in one row, right-aligned like Insights.
          Subtitle removed at Victor's request. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Accounts</h1>
        {/* Actions sit immediately left of the period picker so the header
            carries every page-level control in one row. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="shrink-0 whitespace-nowrap rounded-lg bg-[color:var(--viz-income)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            Transfer Funds
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="shrink-0 whitespace-nowrap rounded-lg bg-[color:var(--viz-income)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            Add account
          </button>
          <button
            type="button"
            onClick={toggleAll}
            className="shrink-0 whitespace-nowrap rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-black/10 transition hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <PeriodPicker
            granularity={periodGranularity}
            periodKey={periodKey}
            label={periodLabel(periodGranularity, periodKey)}
            minYear={new Date().getFullYear() - 5}
            // Weekly account balances don't exist as snapshots — drop it.
            granularities={["monthly", "quarterly", "yearly"]}
            onSelect={(g, k) => {
              setPeriodGranularity(g);
              setPeriodKey(k);
            }}
          />
        </div>
      </div>

      {/* Net worth + account groups live in one card. Collapsing hides the
          group cards and keeps the Assets / Debts / Net worth tiles, the same
          way Travel & Credit Card Rewards keeps its stat row when closed. */}
      <section className="space-y-3 rounded-xl bg-surface py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:p-4">
      <div className="flex items-center gap-2 px-3 sm:px-0">
        <button
          type="button"
          onClick={() => setOverviewCollapsed((c) => ({ ...c, overview: !c.overview }))}
          className="min-w-0 flex-1 text-left"
          aria-expanded={overviewOpen}
        >
          <span className="text-base font-bold sm:text-lg">Net Worth & Accounts</span>
        </button>
        <button
          type="button"
          onClick={() => setOverviewCollapsed((c) => ({ ...c, overview: !c.overview }))}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={overviewOpen ? "Collapse account groups" : "Expand account groups"}
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${overviewOpen ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 sm:gap-3 sm:px-0">
        <SummaryStat
          label="Assets"
          value={assets}
          currency={currency}
          tone="text-positive"
          delta={deltaPct(assets, priorAssets)}
          deltaAmount={priorAssets == null ? null : assets - priorAssets}
          deltaGoodWhen="up"
          priorLabel={priorPeriodLabel}
        />
        <SummaryStat
          label="Debts"
          value={debtsTotal}
          currency={currency}
          tone="text-negative"
          delta={deltaPct(debtsTotal, priorDebts)}
          deltaAmount={priorDebts == null ? null : debtsTotal - priorDebts}
          deltaGoodWhen="down"
          priorLabel={priorPeriodLabel}
        />
        <SummaryStat
          label="Net worth"
          value={net}
          currency={currency}
          tone={net >= 0 ? "text-foreground" : "text-negative"}
          hint={mortgageExcluded ? "Mortgage excluded" : undefined}
          delta={deltaPct(net, priorNet)}
          deltaAmount={priorNet == null ? null : net - priorNet}
          deltaGoodWhen="up"
          priorLabel={priorPeriodLabel}
        />
      </div>

      {/* 2×2: Banking + Debts on the left, Investments + Kids Funding on the right.
          Two independent flex columns so opening one card doesn't leave dead space next to it.
          Collapsing the section hides these; the summary tiles above stay. */}
      {overviewOpen ? (() => {
        const items = [
          ...assetSections.map((s) => ({ section: s, extras: [] as BudgetDebt[] })),
          ...debtSectionsToRender.map((s) => ({
            section: s,
            extras: s.key === "loans" ? visibleBudgetDebts : ([] as BudgetDebt[]),
          })),
          ...kidsSections
            .filter((s) => accounts.some((a) => s.match(a)) || s.key === "kids")
            .map((s) => ({ section: s, extras: [] as BudgetDebt[] })),
        ];
        const leftKeys = new Set(["banking", "loans"]);
        const left = items.filter((i) => leftKeys.has(i.section.key));
        const right = items.filter((i) => !leftKeys.has(i.section.key));
        const renderCard = ({ section, extras }: (typeof items)[number]) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.match(a))}
            extraDebts={extras}
            currency={currency}
            historyMonths={displayMonths}
            periodSnapshotMonth={periodSnapshotMonth}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
            isBucketsOpen={isBucketsOpen}
            onToggleBuckets={toggleBuckets}
            headerBadge={section.kidsGroup ? "Not in net worth" : undefined}
          />
        );
        return (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex flex-1 flex-col gap-3">{left.map(renderCard)}</div>
            <div className="flex flex-1 flex-col gap-3">{right.map(renderCard)}</div>
          </div>
        );
      })() : null}
      </section>

      <div className="space-y-3 pt-2">
        {creditSections.map((section) => {
          const sectionAccounts = accounts.filter((a) => section.match(a));
          if (sectionAccounts.length === 0 && section.key !== "credit") return null;
          return (
            <CreditCardSection
              key={section.key}
              section={section}
              accounts={sectionAccounts}
              allCreditCards={accounts.filter((a) => a.kind === "credit_card")}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={accounts.flatMap((a) => a.buckets)}
              open={!collapsed[section.key]}
              onToggle={() => toggleSection(section.key)}
            />
          );
        })}
      </div>
      {addOpen ? <AddAccountModal onClose={() => setAddOpen(false)} /> : null}
      {transferOpen ? (
        <TransferModal
          accounts={accounts}
          allBuckets={accounts.flatMap((a) => a.buckets)}
          onClose={() => setTransferOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---- Credit Card section: expandable panels, holder grouping, Pay Card modal ----

function CreditCardSection({
  section,
  accounts,
  allCreditCards,
  currency,
  nonCardAccounts,
  allBuckets,
  open,
  onToggle,
}: {
  section: Section;
  accounts: AccountData[];
  allCreditCards: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  open: boolean;
  onToggle: () => void;
}) {
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();
  const [localAccounts, setLocalAccounts] = useState(accounts);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalAccounts(accounts);
  }, [accounts]);
  const [collapsedBanks, setCollapsedBanks] = useState<Set<string>>(new Set());
  const [showOnlyFeeCards, setShowOnlyFeeCards] = useState(false);
  const [showOnlyOwedCards, setShowOnlyOwedCards] = useState(false);
  const [showOnlyPtsCards, setShowOnlyPtsCards] = useState(false);
  const [showOnlyTravelRedeem, setShowOnlyTravelRedeem] = useState(false);
  const [showOnlyHotelRedeem, setShowOnlyHotelRedeem] = useState(false);
  // Holder filter — clicking a name (Vic / Johana / …) limits the visible
  // cards to that holder. Null = all holders.
  const [holderFilter, setHolderFilter] = useState<string | null>(null);
  const hasActiveFee = (a: AccountData) => !a.feeWaived && (a.annualFeeCents ?? 0) > 0;
  const hasOwed = (a: AccountData) => (a.owedCents ?? 0) > 0;
  const hasPts = (a: AccountData) => (a.cardDetails?.currentPoints ?? 0) > 0;
  // A card "contributes" to the Redeemable tile when it's in that rewards
  // category and has redeemable value (points × micro-value + free-night credit).
  const hasRedeemableIn = (a: AccountData, cat: "travel" | "hotel") => {
    const d = a.cardDetails;
    if (!d || d.rewardsCategory !== cat) return false;
    const pts = d.pointsValueMicros ? Math.round((d.currentPoints * d.pointsValueMicros) / 10_000) : 0;
    return pts + (d.freeNightCreditCents ?? 0) > 0;
  };
  const toggleBank = (bank: string) => setCollapsedBanks((prev) => {
    const next = new Set(prev);
    if (next.has(bank)) next.delete(bank);
    else next.add(bank);
    return next;
  });

  const reorder = (fromId: string, toId: string) => {
    const fromIdx = localAccounts.findIndex((a) => a.id === fromId);
    const toIdx = localAccounts.findIndex((a) => a.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...localAccounts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId, startDrag } = usePointerReorder("credit-card", reorder);

  // Bank-group order: dragging a bank header moves its whole card block. The
  // underlying store is still per-account sort_order — we just splice the
  // block, then persist the flattened order.
  const bankLabel = (a: AccountData) => {
    const raw = (a.cardDetails?.bank ?? a.institution ?? a.subtype ?? "Other").trim();
    if (!raw) return "Other";
    // Keep institution sections together even when entries use different
    // capitalization or spacing, while preserving the first card's display.
    const normalized = raw.replace(/\s+/g, " ").toLowerCase();
    const existing = localAccounts.find((candidate) => {
      const candidateRaw = (candidate.cardDetails?.bank ?? candidate.institution ?? candidate.subtype ?? "Other").trim();
      return candidateRaw.replace(/\s+/g, " ").toLowerCase() === normalized;
    });
    return existing
      ? (existing.cardDetails?.bank ?? existing.institution ?? existing.subtype ?? "Other").trim().replace(/\s+/g, " ")
      : raw.replace(/\s+/g, " ");
  };
  const reorderBank = (fromBank: string, toBank: string) => {
    if (fromBank === toBank) return;
    const fromCards = localAccounts.filter((a) => bankLabel(a) === fromBank);
    const otherCards = localAccounts.filter((a) => bankLabel(a) !== fromBank);
    const toIdx = otherCards.findIndex((a) => bankLabel(a) === toBank);
    if (fromCards.length === 0 || toIdx === -1) return;
    const next = [...otherCards.slice(0, toIdx), ...fromCards, ...otherCards.slice(toIdx)];
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId: dragOverBank, startDrag: startBankDrag } = usePointerReorder("credit-bank", reorderBank);
  const isArchived = section.key === "credit_archived";
  const isMain = section.key === "credit";
  const feeFilter = (a: AccountData) => !showOnlyFeeCards || hasActiveFee(a);
  const owedFilter = (a: AccountData) => !showOnlyOwedCards || hasOwed(a);
  const ptsFilter = (a: AccountData) => !showOnlyPtsCards || hasPts(a);
  const holderFilterFn = (a: AccountData) => !holderFilter || (a.holder ?? "") === holderFilter;
  const passesFilters = (a: AccountData) =>
    feeFilter(a) && owedFilter(a) && ptsFilter(a) && holderFilterFn(a);
  // Per-category "contributes to Redeemable" filters — scoped to their own
  // section so clicking Travel Redeemable doesn't empty the Hotel list.
  const travelCards = localAccounts.filter((a) =>
    a.cardDetails?.rewardsCategory === "travel"
    && passesFilters(a)
    && (!showOnlyTravelRedeem || hasRedeemableIn(a, "travel")),
  );
  const hotelCards = localAccounts.filter((a) =>
    a.cardDetails?.rewardsCategory === "hotel"
    && passesFilters(a)
    && (!showOnlyHotelRedeem || hasRedeemableIn(a, "hotel")),
  );
  const otherCards = localAccounts.filter((a) => !a.cardDetails?.rewardsCategory && passesFilters(a));
  const travelOwed = travelCards.reduce((sum, a) => sum + (a.owedCents ?? 0), 0);
  const hotelOwed = hotelCards.reduce((sum, a) => sum + (a.owedCents ?? 0), 0);
  const renderCards = (cards: AccountData[]) => (
    <ul className="divide-y divide-line">
      {cards.map((a) => (
        <CreditCardPanel
          key={a.id}
          card={a}
          currency={currency}
          nonCardAccounts={nonCardAccounts}
          allBuckets={allBuckets}
          isArchived={isArchived}
          onDragStart={() => startDrag(a.id)}
          isDragOver={dragOverId === a.id}
        />
      ))}
    </ul>
  );

  // Every headline stat honors the active holder filter so the numbers and
  // the visible card lists always agree. When no holder is picked this reduces
  // back to the full-household totals.
  const holderScoped = <T extends AccountData>(list: T[]) => list.filter(holderFilterFn);
  const openCards = holderScoped(allCreditCards.filter((a) => !a.dateClosed));
  const feesPaid = openCards
    .filter((a) => !a.feeWaived && (a.annualFeeCents ?? 0) > 0)
    .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
  const feesWaived = openCards
    .filter((a) => a.feeWaived && (a.annualFeeCents ?? 0) > 0)
    .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
  const feesAll = feesPaid + feesWaived;
  const totalOwed = holderScoped(accounts).reduce((s, a) => s + (a.owedCents ?? 0), 0);
  const rewardCards = holderScoped(allCreditCards.filter((a) => a.cardDetails));
  const totalPoints = rewardCards.reduce((sum, a) => sum + (a.cardDetails?.currentPoints ?? 0), 0);
  const pointsForCategory = (cat: "travel" | "hotel") =>
    rewardCards
      .filter((a) => a.cardDetails?.rewardsCategory === cat)
      .reduce((sum, a) => sum + (a.cardDetails?.currentPoints ?? 0), 0);
  const travelPoints = pointsForCategory("travel");
  const hotelPoints = pointsForCategory("hotel");
  // ---- Credit utilisation: balances owed as a share of total credit limit.
  // The single biggest lever on a credit score, and computable from limits
  // already stored per card. Only cards with a recorded limit are counted, so
  // the figure isn't skewed by cards whose limit hasn't been entered — the
  // covered-card count is shown alongside so the basis is clear.
  const cardsWithLimit = holderScoped(openCards).filter(
    (a) => (a.cardDetails?.spendingLimitCents ?? 0) > 0,
  );
  const totalLimitCents = cardsWithLimit.reduce(
    (s, a) => s + (a.cardDetails?.spendingLimitCents ?? 0),
    0,
  );
  const owedOnLimitedCards = cardsWithLimit.reduce((s, a) => s + Math.max(0, a.owedCents ?? 0), 0);
  const utilisationPct = totalLimitCents > 0 ? (owedOnLimitedCards / totalLimitCents) * 100 : null;
  // Compact number formatter tuned so the sub-line's pieces still visibly add
  // up to the headline value. E.g. 1,025,563 → "1.03M" (not "1.0M"), so
  // Travel 395k + Hotel 1.03M reads consistent with total 1,420,563.
  const compactNum = (n: number) => {
    if (n >= 100_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 100_000) return `${(n / 1_000).toFixed(0)}k`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };
  const redeemableForCategory = (cat: "travel" | "hotel") =>
    rewardCards
      .filter((a) => a.cardDetails?.rewardsCategory === cat)
      .reduce((sum, a) => {
        const d = a.cardDetails!;
        const pts = d.pointsValueMicros ? Math.round((d.currentPoints * d.pointsValueMicros) / 10_000) : 0;
        return sum + pts + (d.freeNightCreditCents ?? 0);
      }, 0);
  const travelRedeemable = redeemableForCategory("travel");
  const hotelRedeemable = redeemableForCategory("hotel");
  const rewardActivityEntries = allCreditCards
    .flatMap((card) => card.rewardActivities.map((activity) => ({ ...activity, cardName: card.name })))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  return (
    <section id={section.key === "credit" ? "credit-cards" : undefined} className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {isMain ? (
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              className="min-w-0 flex-1 text-left"
              aria-expanded={open}
            >
              <span className="text-base font-bold sm:text-lg">Travel & Credit Card Rewards</span>
            </button>
            <a
              href="https://www.dailydrop.com/calculator"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/30 bg-background px-2 py-1 text-[11px] font-semibold text-brand transition hover:border-brand/60 hover:bg-brand-soft/30 dark:bg-slate-950"
              title="Open the Daily Drop cents-per-point calculator"
            >
              <span className="sm:hidden">Calculator</span>
              <span className="hidden sm:inline">Points value calculator</span>
              <span aria-hidden>↗</span>
            </a>
            <button
              type="button"
              onClick={onToggle}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={open ? "Collapse credit card rewards" : "Expand credit card rewards"}
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${open ? "" : "-rotate-90"}`}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          {(totalPoints > 0 || travelRedeemable > 0 || hotelRedeemable > 0 || feesPaid > 0 || totalOwed > 0) ? (
            <>
            <div className="mt-4 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4">
              {totalPoints > 0 ? (
                <StatTile
                  label="Current Pts"
                  value={totalPoints.toLocaleString()}
                  sub={(() => {
                    const other = Math.max(0, totalPoints - travelPoints - hotelPoints);
                    const parts: string[] = [];
                    if (travelPoints > 0) parts.push(`Travel ${compactNum(travelPoints)}`);
                    if (hotelPoints > 0) parts.push(`Hotel ${compactNum(hotelPoints)}`);
                    if (other > 0) parts.push(`Other ${compactNum(other)}`);
                    return parts.length ? parts.join(" · ") : undefined;
                  })()}
                  tone="emerald"
                  onClick={() => setShowOnlyPtsCards((v) => !v)}
                  active={showOnlyPtsCards}
                />
              ) : null}
              {travelRedeemable > 0 ? (
                <StatTile
                  label="Travel Value Redeemable"
                  value={formatMoney(travelRedeemable, currency)}
                  tone="sky"
                  onClick={() => setShowOnlyTravelRedeem((v) => !v)}
                  active={showOnlyTravelRedeem}
                />
              ) : null}
              {hotelRedeemable > 0 ? (
                <StatTile
                  label="Hotel Value Redeemable"
                  value={formatMoney(hotelRedeemable, currency)}
                  tone="teal"
                  onClick={() => setShowOnlyHotelRedeem((v) => !v)}
                  active={showOnlyHotelRedeem}
                />
              ) : null}
              {totalOwed > 0 ? (
                <StatTile
                  label="Total CC Owed"
                  value={formatMoney(totalOwed, currency)}
                  sub={
                    utilisationPct != null
                      ? `${utilisationPct.toFixed(0)}% of ${formatMoney(totalLimitCents, currency).replace(/\.00$/, "")} limit`
                      : undefined
                  }
                  // Under 30% is the conventional healthy threshold.
                  subColor={
                    utilisationPct == null
                      ? undefined
                      : utilisationPct < 30
                        ? "var(--positive)"
                        : "var(--negative)"
                  }
                  tone="rose"
                  onClick={() => setShowOnlyOwedCards((v) => !v)}
                  active={showOnlyOwedCards}
                />
              ) : null}
            </div>
            {/* Fees, holder filter and card counts belong to the open section —
                collapsing leaves only the headline stat tiles. */}
            {open ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
              {feesPaid > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowOnlyFeeCards((v) => !v)}
                  className={`rounded-md px-2 py-1 font-semibold transition ${showOnlyFeeCards ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  title={showOnlyFeeCards ? "Show all cards" : "Show only cards with active annual fees"}
                >
                  Active fees <span className="tabular-nums text-amber-700 dark:text-amber-300">{formatMoney(feesPaid, currency)}/yr</span>
                </button>
              ) : null}
              {feesAll > 0 ? (
                <span>
                  Total fees w/out waiver <span className="font-semibold tabular-nums text-foreground">{formatMoney(feesAll, currency)}/yr</span>
                </span>
              ) : null}
              {/* Holder filter — chip per unique cardholder plus an "All" reset.
                  Clicking narrows every card list (Travel / Hotel / Other) to
                  that person's cards. */}
              {(() => {
                const holders = Array.from(
                  new Set(
                    allCreditCards
                      .map((a) => (a.holder ?? "").trim())
                      .filter(Boolean),
                  ),
                ).sort();
                if (holders.length < 2) return null;
                const chip = (active: boolean) =>
                  `rounded-md px-2 py-1 font-semibold transition ${
                    active
                      ? "text-white"
                      : "text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`;
                return (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setHolderFilter(null)}
                      className={chip(holderFilter == null)}
                      style={holderFilter == null ? { backgroundColor: "var(--viz-savings)" } : undefined}
                    >
                      All
                    </button>
                    {holders.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() =>
                          setHolderFilter((prev) => (prev === h ? null : h))
                        }
                        className={chip(holderFilter === h)}
                        style={holderFilter === h ? { backgroundColor: "var(--viz-savings)" } : undefined}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const scoped = holderScoped(accounts);
                return (
                  <span className="sm:ml-auto">
                    <span className="font-semibold tabular-nums text-foreground">{scoped.filter((a) => a.cardDetails?.rewardsCategory === "travel").length}</span> travel
                    <span className="mx-1.5 text-slate-400">·</span>
                    <span className="font-semibold tabular-nums text-foreground">{scoped.filter((a) => a.cardDetails?.rewardsCategory === "hotel").length}</span> hotel
                    <span className="mx-1.5 text-slate-400">·</span>
                    <span className="font-semibold tabular-nums text-foreground">{scoped.length}</span> total
                  </span>
                );
              })()}
            </div>
            ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2.5 text-left"
            aria-expanded={open}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${section.dot}`} />
            <span className="font-semibold">{section.label}</span>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
              {accounts.length} card{accounts.length !== 1 ? "s" : ""}
            </span>
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {totalOwed > 0 ? (
            <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-negative sm:text-sm">
              {formatMoney(totalOwed, currency)} owed
            </span>
          ) : null}
        </div>
      )}

      {open ? (
        <div className="border-t-2 border-foreground/25">
          {reorderError ? (
            <p className="border-b border-line px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
          ) : null}
          {localAccounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">
              {isArchived ? "No archived cards." : "No credit cards yet — add one below."}
            </p>
          ) : isMain ? (
            <div>
              <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                {showOnlyHotelRedeem ? <section aria-hidden /> : (
                <section>
                  <div className="flex items-center gap-2.5 border-b border-line bg-background/60 px-4 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                      </svg>
                    </span>
                    <span className="text-sm font-bold text-foreground sm:text-base">Travel Rewards</span>
                    <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {travelCards.length} card{travelCards.length !== 1 ? "s" : ""}
                    </span>
                    <span className={`ml-auto whitespace-nowrap text-sm font-bold tabular-nums ${travelOwed > 0 ? "text-negative" : "text-muted"}`}>
                      {formatMoney(travelOwed, currency)} owed
                    </span>
                  </div>
                  {travelCards.length > 0 ? renderCards(travelCards) : <p className="px-4 py-4 text-sm text-muted">No travel cards yet.</p>}
                </section>
                )}
                {showOnlyTravelRedeem ? <section aria-hidden /> : (
                <section>
                  <div className="flex items-center gap-2.5 border-b border-line bg-background/60 px-4 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 21V7l7-4v4h11v14" />
                        <path d="M7 10h.01M11 10h.01M15 14h.01M11 14h.01M7 14h.01M15 18h.01M11 18h.01M7 18h.01" />
                      </svg>
                    </span>
                    <span className="text-sm font-bold text-foreground sm:text-base">Hotel Rewards</span>
                    <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {hotelCards.length} card{hotelCards.length !== 1 ? "s" : ""}
                    </span>
                    <span className={`ml-auto whitespace-nowrap text-sm font-bold tabular-nums ${hotelOwed > 0 ? "text-negative" : "text-muted"}`}>
                      {formatMoney(hotelOwed, currency)} owed
                    </span>
                  </div>
                  {hotelCards.length > 0 ? renderCards(hotelCards) : <p className="px-4 py-4 text-sm text-muted">No hotel cards yet.</p>}
                </section>
                )}
              </div>
              {otherCards.length > 0 && !showOnlyTravelRedeem && !showOnlyHotelRedeem ? (
                <section className="border-t border-line">
                  <div className="flex items-center gap-2.5 border-b-2 border-foreground/25 bg-slate-500/[0.06] px-4 py-3 dark:bg-slate-500/10">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-500/15 text-slate-600 dark:text-slate-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="2" y="5" width="20" height="14" rx="2" />
                        <path d="M2 10h20" />
                      </svg>
                    </span>
                    <span className="text-sm font-bold text-foreground sm:text-base">Other Cards</span>
                    <span className="rounded-md bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {otherCards.length} card{otherCards.length !== 1 ? "s" : ""}
                    </span>
                    <span className="ml-auto text-xs text-muted">Choose Travel or Hotel when editing a card.</span>
                  </div>
                  {renderCards(otherCards)}
                </section>
              ) : null}
              <RewardsActivityLedger entries={rewardActivityEntries} currency={currency} />
            </div>
          ) : (() => {
            const groups = localAccounts.reduce<{ bank: string; cards: AccountData[] }[]>((acc, a) => {
              const b = bankLabel(a);
              const existing = acc.find((g) => g.bank === b);
              if (existing) { existing.cards.push(a); } else { acc.push({ bank: b, cards: [a] }); }
              return acc;
            }, []);
            return (
              <div className="divide-y divide-line">
                {groups.map((group) => {
                  const collapsed = collapsedBanks.has(group.bank);
                  const isBankDragOver = dragOverBank === group.bank;
                  return (
                    <div
                      key={group.bank}
                      data-drop-key={`credit-bank:${group.bank}`}
                      className={isBankDragOver ? "ring-2 ring-inset ring-brand/50" : ""}
                    >
                      <div
                        className={`flex items-center gap-1 pl-2 pr-4 py-1.5 bg-black/[0.04] dark:bg-white/[0.05] ${
                          isBankDragOver ? "bg-brand-soft/40" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        }`}
                      >
                        <GripHandle size="sm" onMouseDown={() => startBankDrag(group.bank)} />
                        <button
                          type="button"
                          onClick={() => toggleBank(group.bank)}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
                            aria-hidden
                          >
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                          <span className="text-xs font-bold uppercase tracking-wide text-foreground">
                            {group.bank}
                          </span>
                          <span className="text-xs font-medium text-muted">
                            {group.cards.length} card{group.cards.length !== 1 ? "s" : ""}
                          </span>
                        </button>
                      </div>
                      {!collapsed && (
                        <ul className="divide-y divide-line">
                          {group.cards.map((a) => (
                            <CreditCardPanel
                              key={a.id}
                              card={a}
                              currency={currency}
                              nonCardAccounts={nonCardAccounts}
                              allBuckets={allBuckets}
                              isArchived={isArchived}
                              onDragStart={() => startDrag(a.id)}
                              isDragOver={dragOverId === a.id}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : null}
    </section>
  );
}

function RewardsActivityLedger({
  entries,
  currency,
}: {
  entries: Array<RewardActivity & { cardName: string }>;
  currency: string;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const labels: Record<RewardActivity["type"], string> = {
    points_redemption: "Points used",
    hotel_credit_redemption: "Hotel credit used",
    free_night_booking: "Free night booked",
  };
  const activeEntries = entries.filter((entry) => !entry.archivedAt);
  const archivedEntries = entries.filter((entry) => entry.archivedAt);
  const visibleEntries = showArchived ? archivedEntries : activeEntries;

  return (
    <section className="border-t-2 border-foreground/25 bg-brand-soft/[0.06]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h3 className="text-sm font-bold">Rewards activity</h3>
          <p className="text-xs text-muted">Every points redemption, hotel-credit use, and booked free night.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {archivedEntries.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${showArchived ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-background text-muted hover:text-foreground dark:bg-slate-950"}`}
            >
              {showArchived ? "Back to activity" : `Archived ${archivedEntries.length}`}
            </button>
          ) : null}
          <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{activeEntries.length} active</span>
        </div>
      </div>
      {visibleEntries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{showArchived ? "No archived rewards activity." : "No rewards activity yet. Open a card and choose “Log rewards activity” to create the first entry."}</p>
      ) : (
        <ul className="divide-y divide-line bg-background/70">
          {visibleEntries.map((entry) => (
            <li key={entry.id} className={`grid grid-cols-[4.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-4 py-2.5 text-xs sm:grid-cols-[5.5rem_11rem_minmax(0,1fr)_auto_auto] ${entry.archivedAt ? "opacity-65" : ""}`}>
              <span className="text-muted tabular-nums">{entry.occurredOn}</span>
              <span className="min-w-0 truncate font-semibold">{entry.cardName}</span>
              <span className="min-w-0 text-muted">{labels[entry.type]}{entry.bookedOn ? ` · Booked ${entry.bookedOn}` : ""}{entry.note ? ` · ${entry.note}` : ""}</span>
              <span className="whitespace-nowrap font-semibold text-negative tabular-nums">
                {entry.pointsDelta ? `${entry.pointsDelta.toLocaleString()} pts` : entry.hotelCreditDeltaCents ? formatMoney(entry.hotelCreditDeltaCents, currency) : "Booked"}
              </span>
              <RewardActivityArchiveButton entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RewardActivityArchiveButton({ entry }: { entry: RewardActivity }) {
  const [pending, startTransition] = useTransition();
  const archive = !entry.archivedAt;
  return (
    <form action={(formData) => startTransition(async () => { await setCreditCardRewardActivityArchived(formData); })}>
      <input type="hidden" name="activityId" value={entry.id} />
      <input type="hidden" name="archived" value={String(archive)} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line bg-background px-2 py-1 text-[11px] font-semibold text-muted transition hover:border-brand/40 hover:text-foreground disabled:opacity-50 dark:bg-slate-950"
        title={archive ? "Archive this activity" : "Restore this activity"}
      >
        {pending ? "…" : archive ? "Archive" : "Restore"}
      </button>
    </form>
  );
}

// The card row opens a compact action tray first. Editing is an explicit choice,
// which keeps routine browsing from unexpectedly dropping a long form into view.
function CreditCardPanel({
  card,
  currency,
  nonCardAccounts,
  allBuckets,
  isArchived,
  onDragStart,
  isDragOver,
}: {
  card: AccountData;
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  isArchived: boolean;
  onDragStart?: () => void;
  isDragOver?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [loggingRewards, setLoggingRewards] = useState(false);
  const [closePending, startClose] = useTransition();
  const [reopenPending, startReopen] = useTransition();

  const d = card.cardDetails;
  const owed = card.owedCents ?? 0;

  // Free-night expiry state for highlighting
  const today = new Date().toISOString().slice(0, 10);
  const fnExpires = d?.freeNightExpiresOn ?? null;
  const fnExpired = fnExpires ? fnExpires < today : false;
  const fnExpiresColor = fnExpired ? "text-negative font-semibold" : "text-foreground font-semibold";
  const bank = d?.bank ?? card.institution ?? card.subtype ?? null;

  return (
    <li
      data-drop-key={`credit-card:${card.id}`}
      className={`${expanded ? "bg-background/60" : "hover:bg-background/40"} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
    >
      {/* Collapsed row */}
      <div className="flex items-center">
        {!isArchived && onDragStart ? (
          <span className="flex-none pl-2 py-2">
            <GripHandle onMouseDown={onDragStart} size="sm" />
          </span>
        ) : null}
      <button
        type="button"
        onClick={() => setExpanded((v) => {
          const next = !v;
          if (!next) {
            setEditing(false);
            setPaying(false);
            setLoggingRewards(false);
          }
          return next;
        })}
        className={`flex min-w-0 flex-1 items-start gap-2 ${!isArchived && onDragStart ? "pl-1" : "pl-4"} pr-3 py-2 text-left`}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="w-full min-w-0 whitespace-normal break-words text-sm font-semibold leading-tight sm:w-auto sm:truncate">{card.name}</span>
            {card.holder ? (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {card.holder}
              </span>
            ) : null}
            {bank ? (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                {bank}
              </span>
            ) : null}
            {card.dateClosed ? (
              <span className="shrink-0 rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
                Closed {card.dateClosed}
              </span>
            ) : null}
            {d?.isRevolvingDebt ? (
              <span className="shrink-0 rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
                Debt
              </span>
            ) : null}
            {card.annualFeeCents && !card.feeWaived ? (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                ${Math.round(card.annualFeeCents / 100)}/yr
              </span>
            ) : null}
          </span>
          {(d?.freeNightCreditCents || d?.freeNightPointsLimit || d?.freeNightExpiresOn || d?.benefitUsedOn || d?.charging || (d && d.currentPoints > 0)) ? (
            <span className="mt-1 block space-y-1">
            <span className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
              {d && d.currentPoints > 0 ? (
                <>
                  <span className="inline-flex items-center whitespace-nowrap rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300">
                    Current Pts: <span className="ml-1 tabular-nums">{d.currentPoints.toLocaleString()}</span>
                  </span>
                  {d.pointsValueMicros ? (
                    <span className="inline-flex items-center whitespace-nowrap rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300">
                      Total Value: <span className="ml-1 tabular-nums">${Math.round((d.currentPoints * d.pointsValueMicros) / 10_000 / 100).toLocaleString()}</span>
                    </span>
                  ) : null}
                </>
              ) : null}
              {(d?.freeNightCreditCents || d?.freeNightPointsLimit) ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-500/30 dark:text-indigo-300">
                  <span className="tabular-nums">
                    {d?.freeNightCreditCents
                      ? `$${Math.round(d.freeNightCreditCents / 100).toLocaleString()}`
                      : `${d.freeNightPointsLimit!.toLocaleString()} pts`}
                  </span>
                  <span>Night Credit</span>
                </span>
              ) : null}
            </span>
              {(d?.freeNightExpiresOn || d?.benefitUsedOn || d?.charging) ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {d?.charging ? (
                    <span className="whitespace-nowrap text-[11px] text-muted">
                      <span className="font-semibold text-foreground">Charging:</span> {d.charging}
                    </span>
                  ) : null}
                  {d?.freeNightExpiresOn ? (
                    <span
                      className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] ${fnExpiresColor}`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                      {fnExpired ? "Expired" : "Expires"} {d.freeNightExpiresOn.replace(/-/g, "‑")}
                    </span>
                  ) : null}
                  {d?.benefitUsedOn ? (
                    <span
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${
                        d.benefitUsedOn < today
                          ? "bg-rose-500/10 text-negative ring-rose-500/30"
                          : "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300"
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="4" width="18" height="17" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" />
                        <path d="m9 15 2 2 4-4" />
                      </svg>
                      Booked: {d.benefitUsedOn.replace(/-/g, "‑")}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className={`ml-2 shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums ${owed > 0 ? "text-negative" : owed < 0 ? "text-positive" : "text-muted"}`}>
          {owed !== 0 ? formatMoney(owed, currency) : "—"}
        </span>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`mt-1 shrink-0 text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      </div>

      {expanded ? (
        <div className="border-t border-line bg-background">
          {editing ? (
            <EditCreditCardForm
              key={JSON.stringify(card.cardDetails) + card.annualFeeCents + card.dateOpened + card.dateClosed + card.holder + card.name}
              card={card}
              onDone={() => setEditing(false)}
            />
          ) : (
          <div className="grid grid-cols-3 items-center gap-1.5 px-3 py-2.5 min-[380px]:grid-cols-5 sm:flex sm:flex-nowrap">
            {!editing && !paying && !loggingRewards ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-black/[0.04] px-1.5 py-1.5 text-[11px] font-medium text-primary hover:bg-black/[0.08] sm:w-auto sm:shrink-0 sm:px-2 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Edit
                </button>
                {d?.cardUrl ? (
                  <a
                    href={externalCardUrl(d.cardUrl)}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${d.cardUrl}`}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-line bg-background px-1.5 py-1.5 text-[11px] font-semibold text-brand hover:border-brand/40 hover:bg-brand-soft/20 sm:w-auto sm:shrink-0 sm:px-2 dark:bg-slate-950"
                  >
                    <span className="sm:hidden">Site</span><span className="hidden sm:inline">Visit site</span> <span aria-hidden>↗</span>
                  </a>
                ) : null}
                {!isArchived && !card.dateClosed ? (
                  <button
                    type="button"
                    onClick={() => setLoggingRewards(true)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-brand/35 bg-background px-1.5 py-1.5 text-[11px] font-semibold text-brand hover:bg-brand-soft/20 sm:w-auto sm:shrink-0 sm:px-2 dark:bg-slate-950"
                  >
                    <span className="sm:hidden">Rewards</span><span className="hidden sm:inline">Rewards log</span>
                  </button>
                ) : null}
                {!isArchived && !card.dateClosed ? (
                  <button
                    type="button"
                    onClick={() => setPaying(true)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-brand px-1.5 py-1.5 text-[11px] font-medium text-white hover:bg-brand-strong sm:w-auto sm:shrink-0 sm:px-2"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                    <span className="sm:hidden">Pay</span><span className="hidden sm:inline">{owed > 0 ? "Pay balance" : "Pay card"}</span>
                  </button>
                ) : null}
                {!isArchived && !card.dateClosed ? (
                  <form action={(fd) => startClose(() => closeCard(fd))} className="col-span-2 min-[380px]:col-span-1 sm:ml-auto sm:shrink-0">
                    <input type="hidden" name="id" value={card.id} />
                    <button
                      type="submit"
                      disabled={closePending}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-negative/10 px-1.5 py-1.5 text-[11px] font-medium text-negative hover:bg-negative/15 disabled:opacity-60 sm:w-auto sm:px-2"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                      {closePending ? "Closing…" : <><span className="sm:hidden">Close</span><span className="hidden sm:inline">Close card</span></>}
                    </button>
                  </form>
                ) : null}
                {(isArchived || card.dateClosed) ? (
                  <form action={(fd) => startReopen(() => reopenCard(fd))}>
                    <input type="hidden" name="id" value={card.id} />
                    <button
                      type="submit"
                      disabled={reopenPending}
                      className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:brightness-95 dark:hover:brightness-110 disabled:opacity-60"
                    >
                      {reopenPending ? "Reopening…" : "Reopen"}
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}
          </div>
          )}

          {paying ? (
            <PayCardModal
              card={card}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={allBuckets}
              onClose={() => setPaying(false)}
            />
          ) : null}
          {loggingRewards ? (
            <RewardActivityForm
              card={card}
              currency={currency}
              onDone={() => setLoggingRewards(false)}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RewardActivityForm({
  card,
  currency,
  onDone,
}: {
  card: AccountData;
  currency: string;
  onDone: () => void;
}) {
  const [activityType, setActivityType] = useState<RewardActivity["type"]>("points_redemption");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const d = card.cardDetails;
  const today = new Date().toISOString().slice(0, 10);
  const labels: Record<RewardActivity["type"], string> = {
    points_redemption: "Points used",
    hotel_credit_redemption: "Hotel credit used",
    free_night_booking: "Free night booked",
  };

  return (
    <section className="rounded-lg border-2 border-brand/25 bg-brand-soft/10 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Log rewards activity</h4>
          <p className="text-xs text-muted">The ledger keeps this card&apos;s balances and Booked date up to date automatically.</p>
        </div>
        <button type="button" onClick={onDone} className="text-xs font-medium text-muted hover:text-foreground">Cancel</button>
      </div>
      <form
        action={(formData) => start(async () => {
          setError(null);
          const result = await logCreditCardRewardActivity(formData);
          if (result?.error) setError(result.error);
          else onDone();
        })}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <input type="hidden" name="accountId" value={card.id} />
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Activity</span>
          <select name="activityType" value={activityType} onChange={(e) => setActivityType(e.target.value as RewardActivity["type"])} className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="points_redemption">Points redemption</option>
            <option value="hotel_credit_redemption">Hotel credit used</option>
            <option value="free_night_booking">Free night booked</option>
          </select>
        </label>
        <LabeledInput label="Activity date" name="occurredOn" type="date" defaultValue={today} />
        {activityType === "points_redemption" ? (
          <LabeledInput label={`Points used · ${d?.currentPoints.toLocaleString() ?? "0"} available`} name="pointsUsed" type="number" min="1" step="1" placeholder="0" />
        ) : null}
        {activityType === "hotel_credit_redemption" ? (
          <LabeledInput label={`Hotel credit used · ${d?.freeNightCreditCents ? formatMoney(d.freeNightCreditCents, currency) : formatMoney(0, currency)} available`} name="hotelCreditUsed" type="number" min="0.01" step="0.01" prefix={currencySymbol(currency)} placeholder="0" />
        ) : null}
        <LabeledInput label={activityType === "free_night_booking" ? "Booked / check-in date" : "Booked / check-in date (optional)"} name="bookedOn" type="date" defaultValue={activityType === "free_night_booking" ? today : ""} />
        <div className="sm:col-span-2">
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Note (optional)</label>
          <input name="note" placeholder="Hotel, trip, confirmation, or redemption details" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted">{labels[activityType]} will be added to this card&apos;s activity log.</p>
          <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60">{pending ? "Saving…" : "Add activity"}</button>
        </div>
        {error ? <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p> : null}
      </form>
      {card.rewardActivities.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Recent rewards activity</p>
          <ul className="space-y-1 text-xs">
            {card.rewardActivities.slice(0, 5).map((activity) => (
              <li key={activity.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{labels[activity.type]} · {activity.bookedOn ? `Booked ${activity.bookedOn}` : activity.occurredOn}{activity.note ? ` · ${activity.note}` : ""}</span>
                <span className="shrink-0 font-semibold text-negative">{activity.pointsDelta ? `${activity.pointsDelta.toLocaleString()} pts` : activity.hotelCreditDeltaCents ? formatMoney(activity.hotelCreditDeltaCents, currency) : "Booked"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type StatTone = "emerald" | "sky" | "teal" | "amber" | "orange" | "rose" | "slate";
const STAT_TONES: Record<StatTone, { bg: string; ring: string; label: string; value: string; activeBg: string }> = {
  slate: {
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/30",
    label: "text-slate-700 dark:text-slate-400",
    value: "text-slate-700 dark:text-slate-300",
    activeBg: "bg-slate-500/25",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30",
    label: "text-emerald-700 dark:text-emerald-400",
    value: "text-emerald-700 dark:text-emerald-300",
    activeBg: "bg-emerald-500/25",
  },
  sky: {
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/30",
    label: "text-sky-700 dark:text-sky-400",
    value: "text-sky-700 dark:text-sky-300",
    activeBg: "bg-sky-500/25",
  },
  teal: {
    bg: "bg-teal-500/10",
    ring: "ring-teal-500/30",
    label: "text-teal-700 dark:text-teal-400",
    value: "text-teal-700 dark:text-teal-300",
    activeBg: "bg-teal-500/25",
  },
  amber: {
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
    label: "text-amber-700 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-300",
    activeBg: "bg-amber-500/25",
  },
  orange: {
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/30",
    label: "text-orange-700 dark:text-orange-400",
    value: "text-orange-700 dark:text-orange-300",
    activeBg: "bg-orange-500/25",
  },
  rose: {
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/30",
    label: "text-rose-700 dark:text-rose-400",
    value: "text-rose-700 dark:text-rose-300",
    activeBg: "bg-rose-500/25",
  },
};

function StatTile({
  label,
  value,
  sub,
  subColor,
  tone,
  onClick,
  active,
  title,
}: {
  label: string;
  value: string;
  // Optional smaller breakdown line under the value (e.g. "T 300k · H 1.1M").
  sub?: string;
  // Overrides the sub-line colour — used where the sub-line carries its own
  // good/bad meaning (credit utilisation) rather than echoing the tile's tone.
  subColor?: string;
  tone: StatTone;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const t = STAT_TONES[tone];
  const base = `rounded-lg px-2 py-2 text-center ring-1 ${active ? `${t.activeBg} ${t.ring}` : "bg-background ring-line"}`;
  const inner = (
    <>
      <div className={`text-[9px] sm:text-[9px] font-semibold uppercase tracking-wide ${t.label}`}>{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums sm:text-sm ${t.value}`}>{value}</div>
      {sub ? (
        <div
          className={`mt-0.5 text-[9px] font-medium tabular-nums ${subColor ? "" : t.label}`}
          style={subColor ? { color: subColor } : undefined}
        >
          {sub}
        </div>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${base} transition hover:brightness-105`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

function EditCreditCardForm({
  card,
  onDone,
}: {
  card: AccountData;
  onDone: () => void;
}) {
  const [savePending, startSave] = useTransition();
  const [delPending, startDel] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [migrationWarning, setMigrationWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<"key" | "basics" | "debt">("key");
  const d = card.cardDetails;

  const tabBtn = (id: "key" | "basics" | "debt", label: string, mobileLabel: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`h-8 min-w-0 whitespace-nowrap px-1 text-[11px] font-semibold transition sm:px-2.5 sm:text-sm ${
        activeTab === id
          ? "text-brand shadow-[inset_0_-2px_0_var(--brand)]"
          : "text-muted hover:bg-slate-50 hover:text-foreground dark:hover:bg-slate-900"
      }`}
      aria-pressed={activeTab === id}
    >
      <span className="sm:hidden">{mobileLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="bg-background p-3">
      {/* One form: saves both account-level basics AND rewards details together.
          All tabs stay mounted (hidden via CSS) so a single Save submits every field. */}
      <form
        action={(fd) =>
          startSave(async () => {
            setDetailsError(null);
            setMigrationWarning(false);
            const [, detailsResult] = await Promise.all([
              updateAccount(fd),
              upsertCardDetails(fd),
            ]);
            if (detailsResult?.error) { setDetailsError(detailsResult.error); return; }
            if (detailsResult?.missingMigration) { setMigrationWarning(true); }
            onDone();
          })
        }
        className="flex flex-col gap-3 [&_input]:!bg-white [&_select]:!bg-white dark:[&_input]:!bg-slate-950 dark:[&_select]:!bg-slate-950"
      >
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="accountId" value={card.id} />
        <input type="hidden" name="isCreditCard" value="on" />
        <input type="hidden" name="subtype" value={card.subtype ?? ""} />
        <input type="hidden" name="active" value={card.active ? "on" : ""} />

        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2rem] items-center border-b border-line">
          {tabBtn("key", "Points & Dates", "Points")}
          {tabBtn("basics", "Basics & Rewards", "Basics")}
          {tabBtn("debt", "Debt tracking", "Debt")}
          <button
            type="button"
            onClick={onDone}
            title="Close editor"
            aria-label="Close editor"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab 1: Key fields (default) */}
        <div className={activeTab === "key" ? "" : "hidden"}>
          <div className="rounded-lg border border-line bg-background/60 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_input]:bg-white [&_input]:ring-slate-300 [&_select]:bg-white [&_select]:ring-slate-300 dark:[&_input]:bg-slate-950 dark:[&_input]:ring-slate-700 dark:[&_select]:bg-slate-950 dark:[&_select]:ring-slate-700">
              <LabeledInput label="Current points" name="currentPoints" type="text" defaultValue={d?.currentPoints ? d.currentPoints.toLocaleString() : ""} placeholder="0" />
              <LabeledInput label="Annual hotel credit" name="freeNightCredit" type="number" step="0.01" prefix="$" defaultValue={d?.freeNightCreditCents ? centsToDisplay(d.freeNightCreditCents) : ""} />
              <LabeledInput label="Benefit expiration" name="freeNightExpires" type="date" defaultValue={d?.freeNightExpiresOn ?? ""} />
              <LabeledInput label="Free-night point value" name="freeNightPointsLimit" type="number" step="1" defaultValue={d?.freeNightPointsLimit ?? ""} />
              <LabeledInput label="Booked / check-in" name="benefitUsedOn" type="date" defaultValue={d?.benefitUsedOn ?? ""} />
              <LabeledInput label="Spending limit" name="spendingLimit" type="number" step="1" prefix="$" defaultValue={d?.spendingLimitCents ? centsToDisplay(d.spendingLimitCents) : ""} />
              <LabeledInput label="Card website" name="cardUrl" type="url" defaultValue={d?.cardUrl ?? ""} placeholder="https://issuer.com/card" />
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Benefits reset</span>
                <select name="benefitCadence" defaultValue={d?.benefitCadence ?? "annual"} className="w-full rounded-md px-2 py-1.5 text-sm ring-1 focus:outline-none focus:ring-2 focus:ring-brand">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="anniversary">Card anniversary</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* Tab 2: Basics & Rewards */}
        <div className={activeTab === "basics" ? "" : "hidden"}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LabeledInput label="Card name" name="name" defaultValue={card.name} required />
            <LabeledInput label="Holder" name="holder" defaultValue={card.holder ?? ""} placeholder="Vic / Johana" />
            <LabeledInput label="Annual fee" name="annualFee" type="number" step="0.01" prefix="$" defaultValue={card.annualFeeCents ? centsToDisplay(card.annualFeeCents) : ""} />
            <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
              <input type="checkbox" name="feeWaived" defaultChecked={card.feeWaived} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
              Fee waived (e.g. military benefit)
            </label>
            <LabeledInput label="Date opened" name="dateOpened" type="date" defaultValue={card.dateOpened ?? ""} />
            <LabeledInput label="Date closed" name="dateClosed" type="date" defaultValue={card.dateClosed ?? ""} />
            <LabeledInput label="Bank" name="bank" defaultValue={d?.bank ?? card.institution ?? card.subtype ?? ""} placeholder="AMEX / Chase / Cap 1" />
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Rewards category</span>
              <select name="rewardsCategory" defaultValue={d?.rewardsCategory ?? ""} className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Not set</option><option value="travel">Travel</option><option value="hotel">Hotel</option>
              </select>
            </label>
            <LabeledInput label="Rewards program" name="rewardsProgram" defaultValue={d?.rewardsProgram ?? ""} placeholder="Hilton, Hyatt, Chase UR…" />
            <LabeledInput label="Value per point ($)" name="pointsValue" type="number" step="0.0001" defaultValue={d?.pointsValueMicros ? (d.pointsValueMicros / 1_000_000).toFixed(4) : ""} placeholder="0.0020" />
            <LabeledInput label="Auth user" name="authUser" defaultValue={d?.authUser ?? ""} placeholder="" />
            <LabeledInput label="Charging" name="charging" defaultValue={d?.charging ?? ""} placeholder="Netflix, Google Drive" />
            <LabeledInput label="Bonus info" name="bonusInfo" defaultValue={d?.bonusInfo ?? ""} placeholder="60,000 pts" />
            <LabeledInput label="Bonus spend req." name="bonusSpend" type="number" step="0.01" prefix="$" defaultValue={d?.bonusSpendCents ? centsToDisplay(d.bonusSpendCents) : ""} placeholder="3000" />
            <LabeledInput label="Bonus deadline" name="bonusDeadline" type="date" defaultValue={d?.bonusSpendDeadline ?? ""} />
            <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
              <input type="checkbox" name="bonusEarned" defaultChecked={d?.bonusEarned ?? false} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
              Bonus earned
            </label>
            <div className="sm:col-span-2">
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Remarks</label>
              <input name="remarks" defaultValue={d?.remarks ?? ""} placeholder="" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
        </div>

        {/* Tab 3: Debt tracking */}
        <div className={activeTab === "debt" ? "" : "hidden"}>
          <div className="space-y-3 rounded-lg border-2 border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
            <label className="flex items-start gap-2 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                name="trackAsPayoffDebt"
                defaultChecked={d?.isRevolvingDebt ?? false}
                className="mt-0.5 h-4 w-4 rounded accent-[var(--brand)]"
              />
              <span>
                Track this card as payoff debt
                <span className="mt-0.5 block text-xs font-normal text-muted">
                  Off by default. Syncs balance, rate, and payment plan with Budget → Debt/Loans.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,1.55fr)]">
              <LabeledInput label="Balance owed" name="payoffBalance" type="number" min="0" step="0.01" defaultValue={d?.payoffBalanceCents ? centsToDisplay(d.payoffBalanceCents) : card.owedCents ? centsToDisplay(Math.max(0, card.owedCents)) : ""} />
              <LabeledInput label="APR %" name="payoffApr" type="number" min="0" step="0.001" defaultValue={d?.payoffApr ?? ""} />
              <LabeledInput label="0% promo ends" name="promoAprEndsOn" type="date" defaultValue={d?.promoAprEndsOn ?? ""} />
              <LabeledInput label="Minimum / mo" name="payoffMinimum" type="number" min="0" step="0.01" defaultValue={d?.payoffMinimumCents ? centsToDisplay(d.payoffMinimumCents) : ""} />
              <LabeledInput label="Due day" name="payoffDueDay" type="number" min="1" max="31" step="1" defaultValue={d?.payoffDueDay ?? ""} />
              <LabeledInput label="Planned / mo" name="payoffPlanned" type="number" min="0" step="0.01" defaultValue={d?.payoffPlannedCents ? centsToDisplay(d.payoffPlannedCents) : ""} />
            </div>
            <p className="text-[11px] text-muted">
              APR % should be <span className="font-semibold">0</span> during a 0% promo period; update to the regular rate when the promo ends. Balance and payment plan sync to Budget → Debt/Loans.
            </p>
          </div>
        </div>

        {detailsError ? (
          <p className="text-sm font-medium text-negative">{detailsError}</p>
        ) : null}
        {migrationWarning ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Saved (most fields). To also save Booked dates and free-night point values, run migration 0026 in Supabase SQL Editor.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savePending}
              className="h-8 rounded-md bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {savePending ? "Saving…" : "Save"}
            </button>
          </div>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">Delete &quot;{card.name}&quot;?</span>
              <button
                type="button"
                disabled={delPending}
                onClick={() =>
                  startDel(async () => {
                    const fd = new FormData();
                    fd.set("id", card.id);
                    await deleteAccount(fd);
                  })
                }
                className="text-xs font-bold text-negative hover:underline disabled:opacity-60"
              >
                {delPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="h-8 rounded-md px-2.5 text-xs font-medium text-negative hover:bg-negative/10"
            >
              Delete card
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function LabeledInput({
  label,
  prefix,
  hint,
  ...inputProps
}: { label: string; prefix?: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const isDate = inputProps.type === "date";
  const { defaultValue: initialDefaultValue, ...dateInputProps } = inputProps;
  const [dateVal, setDateVal] = useState(isDate ? (typeof initialDefaultValue === "string" ? initialDefaultValue : "") : "");
  const dateRef = useRef<HTMLInputElement | null>(null);

  if (isDate) {
    return (
      <label className="block" onClick={(e) => e.preventDefault()}>
        <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <input
            {...dateInputProps}
            ref={dateRef}
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {dateVal ? (
            <button
              type="button"
              onClick={() => { setDateVal(""); if (dateRef.current) { dateRef.current.value = ""; dateRef.current.dispatchEvent(new Event("change", { bubbles: true })); } }}
              className="shrink-0 rounded p-1 text-muted hover:text-foreground"
              aria-label="Clear date"
            >
              ✕
            </button>
          ) : null}
        </div>
        {hint ? <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">{hint}</span> : null}
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {prefix ? (
        <div className="flex items-center rounded-md ring-1 ring-line focus-within:ring-2 focus-within:ring-brand bg-background">
          <span className="pl-2 text-sm text-muted select-none">{prefix}</span>
          <input
            {...inputProps}
            className="min-w-0 flex-1 rounded-md bg-background px-1.5 py-1.5 text-sm focus:outline-none"
          />
        </div>
      ) : (
        <input
          {...inputProps}
          className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      )}
      {hint ? <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">{hint}</span> : null}
    </label>
  );
}

// Move money between two of your own accounts. Budget-neutral by design —
// see `transferBetweenAccounts` for why funding a savings goal stays on the
// Budget page instead of being folded in here.
function TransferModal({
  accounts,
  allBuckets,
  onClose,
}: {
  accounts: AccountData[];
  allBuckets: BucketData[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cards and investments each have a dedicated flow that does more than move
  // a balance, so they're not offered here at all rather than being offered
  // and then refused on submit.
  const movable = accounts.filter((a) => a.kind !== "credit_card" && a.kind !== "investment");
  const [fromId, setFromId] = useState<string>(movable[0]?.id ?? "");
  const [toId, setToId] = useState<string>(movable[1]?.id ?? "");
  const [fromBucketId, setFromBucketId] = useState("");
  const [toBucketId, setToBucketId] = useState("");

  const fromBuckets = allBuckets.filter((b) => b.accountId === fromId);
  const toBuckets = allBuckets.filter((b) => b.accountId === toId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-4 shadow-lg ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Transfer between accounts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form
          action={(fd) =>
            start(async () => {
              setErrorMsg(null);
              const r = await transferBetweenAccounts(fd);
              if (r?.error) setErrorMsg(r.error);
              else onClose();
            })
          }
          className="space-y-2"
        >
          <LabeledInput label="Amount" name="amount" type="number" step="0.01" min="0" required autoFocus />
          <LabeledInput
            label="Date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />

          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              From
            </span>
            <select
              name="fromAccountId"
              value={fromId}
              onChange={(e) => { setFromId(e.target.value); setFromBucketId(""); }}
              required
              className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {movable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {fromBuckets.length > 0 ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                From bucket
              </span>
              <select
                name="fromBucketId"
                value={fromBucketId}
                onChange={(e) => setFromBucketId(e.target.value)}
                required
                className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {fromBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              To
            </span>
            <select
              name="toAccountId"
              value={toId}
              onChange={(e) => { setToId(e.target.value); setToBucketId(""); }}
              required
              className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {movable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {toBuckets.length > 0 ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                To bucket
              </span>
              <select
                name="toBucketId"
                value={toBucketId}
                onChange={(e) => setToBucketId(e.target.value)}
                required
                className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {toBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <LabeledInput label="Note" name="memo" />
          {errorMsg ? <p className="text-xs text-negative">{errorMsg}</p> : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Transferring…" : "Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayCardModal({
  card,
  currency,
  nonCardAccounts,
  allBuckets,
  onClose,
}: {
  card: AccountData;
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string>(nonCardAccounts[0]?.id ?? "");
  const source = nonCardAccounts.find((a) => a.id === sourceId) ?? null;
  const sourceBuckets = allBuckets.filter((b) => b.accountId === sourceId);
  // Try to pre-pick a bucket whose name references this card (fuzzy match on
  // card name words, case-insensitive).
  const cardWords = card.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const defaultBucket =
    source?.hasBuckets
      ? sourceBuckets.find((b) => cardWords.some((w) => b.name.toLowerCase().includes(w)))?.id ?? ""
      : "";
  const [bucketId, setBucketId] = useState(defaultBucket);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-4 shadow-lg ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Pay {card.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {(card.owedCents ?? 0) > 0 ? (
          <p className="text-xs text-muted">
            Currently owed: <span className="font-semibold text-negative">{formatMoney(card.owedCents ?? 0, currency)}</span>
          </p>
        ) : null}

        <form
          action={(fd) =>
            start(async () => {
              setErrorMsg(null);
              const r = await payCard(fd);
              if (r?.error) setErrorMsg(r.error);
              else onClose();
            })
          }
          className="space-y-2"
        >
          <input type="hidden" name="cardId" value={card.id} />
          <LabeledInput
            label="Payment amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={card.owedCents && card.owedCents > 0 ? centsToDisplay(card.owedCents) : ""}
            required
            autoFocus
          />
          {card.owedCents && card.owedCents > 0 ? (
            <p className="text-[10px] text-muted">
              The full balance is prefilled. Recording this payment will bring the card to {formatMoney(0, currency)} while keeping the imported charges.
            </p>
          ) : null}
          <LabeledInput label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              From account
            </span>
            <select
              name="sourceAccountId"
              value={sourceId}
              onChange={(e) => { setSourceId(e.target.value); setBucketId(""); }}
              required
              className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {nonCardAccounts.length === 0 ? (
                <option value="">No accounts available</option>
              ) : null}
              {nonCardAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {source?.hasBuckets && sourceBuckets.length > 0 ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                From bucket
              </span>
              <select
                name="bucketId"
                value={bucketId}
                onChange={(e) => setBucketId(e.target.value)}
                required
                className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {sourceBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] text-muted">
                Required because {source.name} has buckets — the bucket total drives the account total.
              </p>
            </label>
          ) : null}
          <LabeledInput label="Notes" name="notes" defaultValue={`Payment to ${card.name}`} />
          {errorMsg ? <p className="text-xs text-negative">{errorMsg}</p> : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Paying…" : "Pay Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Signed % change; null when we can't compute a meaningful comparison —
// missing prior data, near-zero base, or an absurd swing (>500%) that
// would just be visual noise. Same guardrails as the Insights hero.
function deltaPct(current: number, prior: number | null): number | null {
  if (prior == null || Math.abs(prior) < 10_00) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  return Math.abs(pct) > 500 ? null : pct;
}

function SummaryStat({
  label,
  value,
  currency,
  tone,
  hint,
  delta,
  deltaAmount,
  deltaGoodWhen,
  priorLabel,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
  hint?: string;
  delta?: number | null;
  // Absolute dollar change vs the same prior period the % is computed against.
  // Rendered alongside the % so the user sees both "how much" and "how much of".
  deltaAmount?: number | null;
  deltaGoodWhen?: "up" | "down";
  priorLabel?: string;
}) {
  const flat = delta != null && Math.abs(delta) < 0.5;
  const good =
    delta == null || flat || !deltaGoodWhen
      ? null
      : deltaGoodWhen === "up"
      ? delta > 0
      : delta < 0;
  // Hero cards on Accounts show whole-dollar totals — cents on six-figure
  // balances add noise, not signal. Round to nearest dollar for both the
  // headline and the delta amount.
  const wholeDollar = (cents: number) => formatMoney(Math.round(cents / 100) * 100, currency).replace(/\.00$/, "");
  const amountStr = deltaAmount != null ? wholeDollar(Math.abs(deltaAmount)) : null;
  return (
    <div className="flex min-w-0 flex-col items-center rounded-2xl bg-surface px-2 py-2.5 text-center shadow-sm ring-1 ring-black/5 sm:px-4 sm:py-3 dark:ring-white/10">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted sm:text-[11px]">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-bold tabular-nums sm:text-lg ${tone}`}>
        {wholeDollar(value)}
      </p>
      {delta != null && priorLabel ? (
        flat ? (
          <p className="mt-0.5 text-[10px] text-muted">about the same as {priorLabel}</p>
        ) : (
          <p className="mt-0.5 text-[10px] leading-tight">
            <span className={good ? "font-semibold text-positive" : "font-semibold text-negative"}>
              {amountStr ? `${amountStr} · ` : ""}
              {Math.abs(delta).toFixed(0)}% {delta > 0 ? "more" : "less"}
            </span>{" "}
            <span className="text-muted">than {priorLabel}</span>
          </p>
        )
      ) : null}
      {hint ? <p className="text-[10px] text-muted">{hint}</p> : null}
    </div>
  );
}

function AccountSection({
  section,
  accounts,
  currency,
  historyMonths,
  periodSnapshotMonth,
  open,
  onToggle,
  isBucketsOpen,
  onToggleBuckets,
  legacy = false,
  extraDebts = [],
  headerBadge,
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
  historyMonths: [string, string, string];
  // "YYYY-MM-01" of the snapshot the header's period picker points at.
  // null = current period → use live balances (default). See `balanceOf`.
  periodSnapshotMonth: string | null;
  open: boolean;
  onToggle: () => void;
  isBucketsOpen: (id: string) => boolean;
  onToggleBuckets: (id: string) => void;
  legacy?: boolean;
  extraDebts?: BudgetDebt[];
  headerBadge?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();

  // Reorder optimistically — reflect the new order the instant you click,
  // instead of waiting on a full round trip to the server. `accounts` still
  // wins once the server responds (revalidated data replaces this local copy).
  const [localAccounts, setLocalAccounts] = useState(accounts);
  useEffect(() => {
    // Sync the optimistic local ordering after server revalidation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalAccounts(accounts);
  }, [accounts]);

  // Prefer the snapshot for the picker's chosen month; fall back to live
  // balance when there's no snapshot (rare, but happens for months before
  // the account existed). Budget-debt extras always use their live balance
  // — historical debt snapshots aren't in scope for the picker filter.
  const balanceOf = (a: AccountData): number => {
    if (!periodSnapshotMonth) return a.balanceCents;
    return a.balancesByMonth?.[periodSnapshotMonth] ?? a.balanceCents;
  };
  const accountsTotal = localAccounts
    .filter((a) => a.active)
    .reduce((sum, a) => sum + balanceOf(a), 0);
  const extraDebtsTotal = extraDebts.reduce((sum, d) => sum + d.balanceCents, 0);
  const total = accountsTotal + extraDebtsTotal;

  // Move the dragged account to sit where another account in this section was
  // dropped, then persist the new order.
  const reorder = (fromId: string, toId: string) => {
    const fromIdx = localAccounts.findIndex((a) => a.id === fromId);
    const toIdx = localAccounts.findIndex((a) => a.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...localAccounts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId, startDrag } = usePointerReorder("account", reorder);

  return (
    <section className="@container overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header */}
      {/* Full-row click target — tapping anywhere on the header (label OR
          amount) expands/collapses the section. The Debt/Loan Page link
          stops propagation so it navigates instead of also toggling. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => {
          if (open) setEditingId(null);
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (open) setEditingId(null);
          onToggle();
        }}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 transition hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${section.dot}`} />
          <span className="truncate font-semibold leading-tight">{section.label}</span>
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          {section.key === "loans" ? (
            <Link
              href="/snowball"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand-soft"
            >
              Debt/Loan Page →
            </Link>
          ) : null}
        </div>
        <span
          className={`text-right text-sm font-bold tabular-nums ${
            section.liability && total > 0 ? "text-negative" : ""
          }`}
        >
          {formatMoney(total, currency)}
        </span>
      </div>

      {reorderError ? (
        <p className="border-t border-line px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
      ) : null}

      {open ? (
        <div className="border-t border-line">
          {localAccounts.length > 0 || extraDebts.length > 0 ? (
            localAccounts.length === 0 && extraDebts.length > 0 ? (
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] @[560px]:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <span />
                <span className="text-center">{monthAbbr(historyMonths[0])}</span>
                <span className="hidden text-center @[560px]:block">{monthAbbr(historyMonths[1])}</span>
                <span className="hidden text-center @[560px]:block">{monthAbbr(historyMonths[2])}</span>
              </div>
            ) : (
              <div className="grid grid-cols-[1.5rem_1rem_minmax(0,1fr)_6rem] @[560px]:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7rem_7rem_7rem_1.25rem] items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {headerBadge ? (
                  <span className="col-span-3 truncate text-[10px] font-medium uppercase tracking-wide text-muted">{headerBadge}</span>
                ) : (
                  <>
                    <span />
                    <span />
                    <span />
                  </>
                )}
                <span className="justify-self-stretch text-center">{monthAbbr(historyMonths[0])}</span>
                <span className="hidden justify-self-stretch text-center @[560px]:block">{monthAbbr(historyMonths[1])}</span>
                <span className="hidden justify-self-stretch text-center @[560px]:block">{monthAbbr(historyMonths[2])}</span>
                <span className="hidden @[560px]:block" />
              </div>
            )
          ) : null}
          {localAccounts.length === 0 && extraDebts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">No accounts yet — use Add account above.</p>
          ) : (
            <ul className="divide-y divide-line">
              {localAccounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  section={section}
                  currency={currency}
                  historyMonths={historyMonths}
                  isPastPeriod={periodSnapshotMonth != null}
                  editing={editingId === a.id}
                  onToggleEdit={() =>
                    setEditingId((id) => (id === a.id ? null : a.id))
                  }
                  onDragStart={() => startDrag(a.id)}
                  isDragOver={dragOverId === a.id}
                  bucketsOpen={isBucketsOpen(a.id)}
                  onToggleBuckets={() => onToggleBuckets(a.id)}
                />
              ))}
            </ul>
          )}
          {extraDebts.length > 0 ? (
            <ul className="divide-y divide-line">
              {extraDebts.map((d) => (
                <li
                  key={`debt:${d.subcategoryId}`}
                  className="grid grid-cols-[minmax(0,1fr)_6rem] @[560px]:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] items-center gap-1.5 px-4 py-1.5"
                >
                  <span className="w-full min-w-0 truncate text-sm text-foreground">{d.name}</span>
                  {/* Same as account rows: each column reads the snapshot for
                      whichever month the header is currently showing. */}
                  <span className="w-full text-right text-sm font-semibold tabular-nums text-negative">
                    {formatMoney(d.balancesByMonth?.[historyMonths[0]] ?? d.balanceCents, currency)}
                  </span>
                  <div className="hidden @[560px]:contents">
                    {[1, 2].map((col) => {
                      const v = d.balancesByMonth?.[historyMonths[col]] ?? null;
                      return (
                        <span key={col} className="flex w-full justify-end">
                          {v != null ? (
                            <span className="inline-flex items-center gap-0 font-semibold tabular-nums text-negative">
                              <span className="text-xs text-muted">{currencySymbol(currency)}</span>
                              <span className="text-sm">{centsToGroupedDisplay(v)}</span>
                            </span>
                          ) : <span className="text-sm text-muted">—</span>}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {legacy ? (
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              Debts are managed in{" "}
              <Link href="/budget" className="font-medium text-brand hover:text-brand-strong">
                Budget → Debt
              </Link>{" "}
              now. Open a row above and delete it here so it isn&apos;t counted twice.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AccountRow({
  account,
  section,
  currency,
  historyMonths,
  isPastPeriod,
  editing,
  onToggleEdit,
  onDragStart,
  isDragOver,
  bucketsOpen,
  onToggleBuckets,
}: {
  account: AccountData;
  section: Section;
  currency: string;
  historyMonths: [string, string, string];
  /** True when the header is showing a month other than the current one. */
  isPastPeriod: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onDragStart: () => void;
  isDragOver: boolean;
  bucketsOpen: boolean;
  onToggleBuckets: () => void;
}) {
  // Buckets make sense for asset accounts (savings/investments/cash), not for
  // credit cards or loans.
  const allowBuckets = !section.liability;
  const bucketCount = account.buckets.length;
  // Column values follow whichever three months the header is showing, rather
  // than the fixed prevMonth/prev2Month the server computed for "today".
  // Null means no snapshot was recorded for that month — rendered muted.
  const balanceFor = (a: AccountData, columnIndex: number): number | null =>
    a.balancesByMonth?.[historyMonths[columnIndex]] ?? null;

  const rowBg = editing ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]";

  return (
    <li
      data-drop-key={`account:${account.id}`}
      className={`group/row ${rowBg} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
    >
      <div className="grid grid-cols-[1.5rem_1rem_minmax(0,1fr)_6rem] @[560px]:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7rem_7rem_7rem_1.25rem] items-center gap-1.5 px-4 py-1.5">
        <GripHandle onMouseDown={onDragStart} />
        {allowBuckets ? (
          <button
            type="button"
            onClick={onToggleBuckets}
            title={bucketsOpen ? "Hide buckets" : "Show buckets"}
            aria-expanded={bucketsOpen}
            className="self-stretch flex w-full items-center justify-center rounded text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${bucketsOpen ? "" : "-rotate-90"}`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span />
        )}
        <div
          role={allowBuckets ? "button" : undefined}
          onClick={allowBuckets ? onToggleBuckets : undefined}
          className="flex min-w-0 w-full cursor-default items-center gap-1.5 overflow-hidden text-left"
        >
          <span className={`min-w-0 truncate text-sm ${account.active ? "text-foreground" : "text-negative"}`}>
            {account.name}
          </span>
          {account.holder ? (
            <EditPill onClick={onToggleEdit} className="hidden bg-black/5 text-muted hover:ring-muted @[560px]:inline-flex dark:bg-white/10">
              {account.holder}
            </EditPill>
          ) : null}
          {account.ownership === "joint" ? (
            <EditPill onClick={onToggleEdit} className="hidden bg-black/5 text-muted hover:ring-muted @[560px]:inline-flex dark:bg-white/10">
              Joint
            </EditPill>
          ) : null}
          {section.key === "banking" && account.bankGroup ? (
            <EditPill
              onClick={onToggleEdit}
              className={`uppercase ${account.bankGroup === "savings" ? "bg-positive/15 text-positive hover:ring-positive" : "bg-black/5 text-muted hover:ring-muted dark:bg-white/10"}`}
            >
              {account.bankGroup === "savings" ? "Savings" : "Checking"}
            </EditPill>
          ) : null}
          {account.subtype ? (
            <EditPill onClick={onToggleEdit} className="bg-sky-500/10 text-sky-600 hover:ring-sky-500 dark:text-sky-400">
              {account.subtype}
            </EditPill>
          ) : null}
          {bucketCount > 0 ? (
            <span className="hidden shrink-0 text-[11px] text-muted @[560px]:inline">
              {bucketCount} {bucketCount === 1 ? "bucket" : "buckets"}
            </span>
          ) : null}
          {maskAccountNumber(account.accountNumber) ? <span className="hidden shrink-0 text-[11px] text-muted @[560px]:inline">{maskAccountNumber(account.accountNumber)}</span> : null}
          {!account.active ? <span className="shrink-0 text-[11px] text-muted">archived</span> : null}
        </div>

        {allowBuckets && bucketCount > 0 ? (
          <>
            <DerivedBalance balanceCents={balanceFor(account, 0) ?? account.balanceCents} currency={currency} />
            <div className="hidden @[560px]:contents">
              <DerivedBalance
                balanceCents={balanceFor(account, 1) ?? 0}
                currency={currency}
                muted={balanceFor(account, 1) == null}
              />
              <DerivedBalance
                balanceCents={balanceFor(account, 2) ?? 0}
                currency={currency}
                muted={balanceFor(account, 2) == null}
              />
            </div>
          </>
        ) : (
          <>
            {isPastPeriod ? (
              // The column is headed with a past month, so writing here has to
              // land on that month's snapshot. Using the live BalanceInput
              // would show today's figure under a JUL heading and overwrite
              // today's balance when edited.
              <HistoricBalanceInput
                accountId={account.id}
                month={historyMonths[0]}
                balanceCents={balanceFor(account, 0)}
                currency={currency}
                liability={section.liability}
              />
            ) : (
              <BalanceInput
                id={account.id}
                balanceCents={account.balanceCents}
                currency={currency}
                liability={section.liability}
              />
            )}
            <div className="hidden @[560px]:contents">
              <HistoricBalanceInput
                accountId={account.id}
                month={historyMonths[1]}
                balanceCents={balanceFor(account, 1)}
                currency={currency}
                liability={section.liability}
              />
              <HistoricBalanceInput
                accountId={account.id}
                month={historyMonths[2]}
                balanceCents={balanceFor(account, 2)}
                currency={currency}
                liability={section.liability}
              />
            </div>
          </>
        )}
        <span className="hidden @[560px]:block" aria-hidden />
      </div>

      {allowBuckets && bucketsOpen ? (
              <BucketDrawer
                account={account}
                currency={currency}
                historyMonths={historyMonths}
                isPastPeriod={isPastPeriod}
              />
      ) : null}

      {editing ? <EditAccountForm account={account} section={section} onDone={onToggleEdit} /> : null}
    </li>
  );
}

// The bucket breakdown for one account: named sinking funds. The account's
// top-level balance is always the sum of these — there's no separate
// "Unallocated" remainder to keep in sync; floating cash is just its own
// bucket (e.g. "Extra Cash").
function BucketDrawer({
  account,
  currency,
  historyMonths,
  isPastPeriod,
}: {
  account: AccountData;
  currency: string;
  historyMonths: [string, string, string];
  isPastPeriod: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();

  // Reorder optimistically, same reasoning as accounts above.
  const [localBuckets, setLocalBuckets] = useState(account.buckets);
  useEffect(() => {
    // Sync the optimistic local ordering after server revalidation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBuckets(account.buckets);
  }, [account.buckets]);

  const reorder = (fromId: string, toId: string) => {
    const fromIdx = localBuckets.findIndex((b) => b.id === fromId);
    const toIdx = localBuckets.findIndex((b) => b.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...localBuckets];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalBuckets(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((b) => b.id)));
    startReorder(async () => {
      const res = await reorderBuckets(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId, startDrag } = usePointerReorder("bucket", reorder);

  return (
    <div className="border-t border-line bg-background/40 px-4 py-1 sm:pl-11 sm:pr-4">
      {reorderError ? <p className="pb-1.5 text-xs font-medium text-negative">{reorderError}</p> : null}
      {localBuckets.length === 0 ? (
        <p className="py-1 text-xs text-muted">
          No buckets yet — optional. Split this account into sinking funds (e.g. Emergency Fund,
          Vehicle, Real Estate). Leave empty for accounts you don&apos;t need to break down.
        </p>
      ) : (
        <ul className="divide-y divide-line/40">
          {localBuckets.map((b) => (
            <BucketRow
              key={b.id}
              bucket={b}
              currency={currency}
              historyMonths={historyMonths}
              isPastPeriod={isPastPeriod}
              onDragStart={() => startDrag(b.id)}
              isDragOver={dragOverId === b.id}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <AddBucketForm accountId={account.id} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 text-xs font-medium text-brand hover:text-brand-strong"
        >
          + Add bucket
        </button>
      )}
    </div>
  );
}

function BucketRow({
  bucket,
  currency,
  historyMonths,
  isPastPeriod,
  onDragStart,
  isDragOver,
}: {
  bucket: BucketData;
  currency: string;
  historyMonths: [string, string, string];
  isPastPeriod: boolean;
  onDragStart: () => void;
  isDragOver: boolean;
}) {
  const [delPending, startDel] = useTransition();
  // All three columns read the month they're actually headed with. They used
  // to use prevMonthCents/prev2MonthCents, which are fixed to the month before
  // *today* — so selecting an earlier period moved the column headings but
  // left the old months' figures underneath them.
  const cellFor = (month: string): number | null => bucket.balancesByMonth[month] ?? null;

  return (
    <li
      data-drop-key={`bucket:${bucket.id}`}
      className={`group relative grid h-7 items-center gap-1.5 ${
        isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""
      } grid-cols-[1.5rem_minmax(0,1fr)_6rem] @[560px]:grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_1.25rem]`}
    >
      <GripHandle onMouseDown={onDragStart} size="sm" />
      <BucketNameInput id={bucket.id} name={bucket.name} />
      {isPastPeriod ? (
        // Same rule as the account row above: the column is headed with a past
        // month, so the edit has to land on that month's bucket_snapshot. The
        // live input would show today's figure under an AUG heading and write
        // today's balance when edited.
        <HistoricBucketBalanceInput
          bucketId={bucket.id}
          month={historyMonths[0]}
          balanceCents={cellFor(historyMonths[0])}
          currency={currency}
        />
      ) : (
        <BucketBalanceInput id={bucket.id} balanceCents={bucket.balanceCents} currency={currency} />
      )}
      <div className="hidden @[560px]:contents">
        <HistoricBucketBalanceInput
          bucketId={bucket.id}
          month={historyMonths[1]}
          balanceCents={cellFor(historyMonths[1])}
          currency={currency}
        />
        <HistoricBucketBalanceInput
          bucketId={bucket.id}
          month={historyMonths[2]}
          balanceCents={cellFor(historyMonths[2])}
          currency={currency}
        />
      </div>
      <form
        action={(fd) => startDel(() => deleteBucket(fd))}
        className="absolute right-1 top-1/2 -translate-y-1/2 sm:static sm:justify-self-end sm:translate-y-0"
      >
        <input type="hidden" name="id" value={bucket.id} />
        <button
          type="submit"
          disabled={delPending}
          title="Delete bucket"
          aria-label="Delete bucket"
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-negative/10 hover:text-negative group-hover:opacity-100 disabled:opacity-40"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </form>
    </li>
  );
}

function BucketNameInput({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={(fd) => start(() => void updateBucket(fd))}>
      <input type="hidden" name="id" value={id} />
      <input
        key={name}
        name="name"
        defaultValue={name}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() && e.currentTarget.value !== name) {
            formRef.current?.requestSubmit();
          }
        }}
        className={`w-full min-w-0 rounded-md bg-transparent px-1 py-0 text-sm transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

function BucketBalanceInput({
  id,
  balanceCents,
  currency,
}: {
  id: string;
  balanceCents: number;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToGroupedDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => updateBucketBalance(fd))}
      className="justify-self-end inline-flex items-center gap-0"
    >
      <input type="hidden" name="id" value={id} />
      <span className="pointer-events-none text-sm text-muted">{currencySymbol(currency)}</span>
      <input
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        style={{ width: `calc(${Math.max(initial.length, 1)}ch + 0.2rem)` }}
        onInput={(e) => {
          e.currentTarget.style.width = `calc(${Math.max(e.currentTarget.value.length, 1)}ch + 0.2rem)`;
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-auto min-w-0 max-w-full flex-none rounded-md bg-transparent py-0 px-0 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Editable prior-month bucket balance. Writes to bucket_snapshots for the
// specified month; setBucketSnapshot server-side re-derives that month's parent
// account snapshot from all this account's bucket snapshots.
function HistoricBucketBalanceInput({
  bucketId,
  month,
  balanceCents,
  currency,
}: {
  bucketId: string;
  month: string;
  balanceCents: number | null;
  currency: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = balanceCents == null ? "" : centsToGroupedDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setBucketSnapshot(fd))}
      className="justify-self-end inline-flex items-center gap-0"
    >
      <input type="hidden" name="bucketId" value={bucketId} />
      <input type="hidden" name="month" value={month} />
      <span className={`pointer-events-none text-sm ${balanceCents == null ? "text-muted/50" : "text-muted"}`}>
        {currencySymbol(currency)}
      </span>
      <input
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="—"
        style={{ width: `calc(${Math.max(initial.length, 1)}ch + 0.2rem)` }}
        onInput={(e) => {
          e.currentTarget.style.width = `calc(${Math.max(e.currentTarget.value.length, 1)}ch + 0.2rem)`;
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-auto min-w-0 max-w-full flex-none rounded-md bg-transparent py-0.5 px-0 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

function AddBucketForm({
  accountId,
  onDone,
}: {
  accountId: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1.5">
      <form
        action={(fd) =>
          start(async () => {
            const result = await addBucket(fd);
            if (result?.error) setError(result.error);
            else onDone();
          })
        }
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="accountId" value={accountId} />
        <input
          name="name"
          placeholder="Bucket name…"
          required
          autoFocus
          onChange={() => setError(null)}
          className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          name="balance"
          type="text"
          inputMode="decimal"
          placeholder="Balance"
          className="w-24 rounded-md bg-surface px-2 py-1 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2 py-1 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </form>
      {error ? <p className="mt-1 text-xs font-medium text-negative">{error}</p> : null}
    </div>
  );
}

// Read-only total for accounts with buckets — always the sum of the buckets
// below, so edit the buckets, not this.
function DerivedBalance({
  balanceCents,
  currency,
  muted = false,
}: {
  balanceCents: number;
  currency: string;
  muted?: boolean;
}) {
  const negative = balanceCents < 0;
  if (muted) {
    return (
      <div
        title="No snapshot for this month yet — edit a bucket below to fill it in"
        className="justify-self-end inline-flex items-center gap-0 py-1"
      >
        <span className="text-sm">—</span>
      </div>
    );
  }
  return (
    <div
      title="Sum of this account's buckets — edit the buckets below to change it"
      className="justify-self-end inline-flex items-center gap-0 py-1"
    >
      <span className={`text-sm ${negative ? "text-negative" : "text-muted"}`}>{currencySymbol(currency)}</span>
      <span className={`text-[0.9375rem] tabular-nums ${negative ? "text-negative font-semibold" : ""}`}>
        {centsToGroupedDisplay(balanceCents)}
      </span>
    </div>
  );
}

// Editable prior-month input for a plain (non-bucketed) account. Writes to
// account_snapshots for the specified month. Empty initial value ("—") is a
// no-op on blur; typing a number and blurring persists it.
function HistoricBalanceInput({
  accountId,
  month,
  balanceCents,
  currency,
  liability,
}: {
  accountId: string;
  month: string;
  balanceCents: number | null;
  currency: string;
  liability: boolean;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = balanceCents == null ? "" : centsToGroupedDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setAccountSnapshot(fd))}
      className="justify-self-end inline-flex items-center gap-0"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="month" value={month} />
      <span className={`pointer-events-none text-sm ${balanceCents == null ? "text-muted/50" : "text-muted"}`}>
        {currencySymbol(currency)}
      </span>
      <input
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="—"
        style={{ width: `calc(${Math.max(initial.length, 1)}ch + 0.2rem)` }}
        onInput={(e) => {
          e.currentTarget.style.width = `calc(${Math.max(e.currentTarget.value.length, 1)}ch + 0.2rem)`;
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          // Empty stays empty — don't create a $0.00 snapshot from nothing.
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-auto min-w-0 max-w-full flex-none rounded-md bg-transparent py-1 px-0 text-right text-[0.9375rem] tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          balanceCents != null && ((liability && balanceCents > 0) || (!liability && balanceCents < 0))
            ? "text-negative font-semibold"
            : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
  );
}

function BalanceInput({
  id,
  balanceCents,
  currency,
  liability,
}: {
  id: string;
  balanceCents: number;
  currency: string;
  liability: boolean;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToGroupedDisplay(balanceCents);

  return (
    <div className="flex w-full items-center justify-end">
      <form
        ref={formRef}
        action={(fd) => start(() => updateBalance(fd))}
        className="inline-flex items-center gap-0"
      >
        <input type="hidden" name="id" value={id} />
        <span className="pointer-events-none text-sm text-muted">
          {currencySymbol(currency)}
        </span>
        <input
          // Remount (reset to the server value) whenever the saved amount changes.
          key={initial}
          name="balance"
          // Keep the field exactly as wide as its value so the currency symbol
          // stays attached instead of sitting at the far side of empty space.
          type="text"
          inputMode="decimal"
          defaultValue={initial}
          style={{ width: `calc(${Math.max(initial.length, 1)}ch + 0.2rem)` }}
          onInput={(e) => {
            e.currentTarget.style.width = `calc(${Math.max(e.currentTarget.value.length, 1)}ch + 0.2rem)`;
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
          }}
        className={`w-auto min-w-0 max-w-full flex-none rounded-md bg-transparent py-1 px-0 text-right text-[0.9375rem] tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
            (liability && balanceCents > 0) || (!liability && balanceCents < 0) ? "text-negative font-semibold" : ""
          } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
        />
      </form>
    </div>
  );
}

function AddAccountForm({ section, onDone }: { section: Section; onDone: (newId?: string | null) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [debtSubtype, setDebtSubtype] = useState("");
  const [cardTab, setCardTab] = useState<"key" | "basics" | "debt">("key");
  const kindKeys = Object.keys(section.kindLabels);
  const multiKind = kindKeys.length > 1;

  // Credit cards are created with their basics and rewards/benefits together,
  // avoiding a second save and a trip back to find the new card in the list.
  if (section.creditCard) {
    return (
      <div className="border-t border-line px-4 py-3">
        <form
          action={(fd) =>
            start(async () => {
              const result = await addCreditCardWithDetails(fd);
              if (result?.error) setError(result.error);
              else onDone(result?.id ?? null);
            })
          }
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="kind" value={section.fixedKind ?? kindKeys[0]} />
          <div className="flex items-center gap-1 border-b border-line pb-2">
            {([
              ["key", "Points & Dates"],
              ["basics", "Basics & Rewards"],
              ["debt", "Debt tracking"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCardTab(id)}
                aria-pressed={cardTab === id}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${cardTab === id ? "bg-brand text-white" : "text-muted hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/5"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={cardTab === "key" ? "" : "hidden"}>
            <div className="rounded-lg border-2 border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-800/50 dark:bg-amber-950/20">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Key fields · monitor &amp; update points &amp; dates</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <LabeledInput label="Current points" name="currentPoints" type="text" placeholder="0" />
                <LabeledInput label="Total Hotel Credits Anv" name="freeNightCredit" type="number" step="0.01" prefix="$" />
                <LabeledInput label="Free Night / Credits Exp" name="freeNightExpires" type="date" />
                <LabeledInput label="Up to Anv Pts / Free Night" name="freeNightPointsLimit" type="number" step="1" />
                <LabeledInput label="Booked" name="benefitUsedOn" type="date" />
                <LabeledInput label="Spending limit" name="spendingLimit" type="number" step="1" prefix="$" />
                <LabeledInput label="Card URL" name="cardUrl" type="url" placeholder="https://issuer.com/card" />
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Benefits reset</span>
                  <select name="benefitCadence" defaultValue="annual" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                    <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="anniversary">Card anniversary</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className={cardTab === "basics" ? "" : "hidden"}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <LabeledInput label="Card name" name="name" placeholder="e.g. 1175 Sapphire V" autoComplete="off" required={cardTab === "basics"} autoFocus onChange={() => setError(null)} />
              <LabeledInput label="Card issuer (bank)" name="institution" placeholder="e.g. Chase" autoComplete="off" />
              <LabeledInput label="Account holder(s)" name="holder" />
              <LabeledInput label="Account reference" name="accountNumber" placeholder="Full number or last four" />
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Ownership</span>
                <select name="ownership" defaultValue="sole" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"><option value="sole">Sole</option><option value="joint">Joint</option></select>
              </label>
              <div className="space-y-2"><LabeledInput label="Annual fee" name="annualFee" type="number" step="0.01" placeholder="0.00" /><label className="flex items-center gap-1.5 px-0.5 text-xs text-muted"><input type="checkbox" name="feeWaived" className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />Fee waived (e.g. military benefit)</label></div>
              <LabeledInput label="Date opened" name="dateOpened" type="date" />
              <LabeledInput label="Date closed" name="dateClosed" type="date" />
              <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Rewards category</span><select name="rewardsCategory" defaultValue="" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"><option value="">Not set</option><option value="travel">Travel</option><option value="hotel">Hotel</option></select></label>
              <LabeledInput label="Rewards program" name="rewardsProgram" placeholder="Hilton, Hyatt, Chase UR" />
              <LabeledInput label="Value per point ($)" name="pointsValue" type="number" step="0.0001" placeholder="0.0020" />
              <LabeledInput label="Auth user" name="authUser" />
              <LabeledInput label="Charging" name="charging" placeholder="Netflix, Google Drive" />
              <LabeledInput label="Bonus info" name="bonusInfo" placeholder="60,000 pts" />
              <LabeledInput label="Bonus spend req." name="bonusSpend" type="number" step="0.01" prefix="$" placeholder="3000" />
              <LabeledInput label="Bonus deadline" name="bonusDeadline" type="date" />
              <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted"><input type="checkbox" name="bonusEarned" className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />Bonus earned</label>
              <div className="sm:col-span-2"><label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Remarks</label><input name="remarks" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" /></div>
            </div>
          </div>

          <div className={cardTab === "debt" ? "" : "hidden"}>
            <div className="space-y-3 rounded-lg border-2 border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
              <label className="flex items-start gap-2 text-sm font-semibold text-foreground"><input type="checkbox" name="trackAsPayoffDebt" className="mt-0.5 h-4 w-4 rounded accent-[var(--brand)]" /><span>Track this card as payoff debt<span className="mt-0.5 block text-xs font-normal text-muted">Off by default. Syncs balance, rate, and payment plan with Budget → Debt/Loans.</span></span></label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,1.55fr)]">
                <LabeledInput label="Balance owed" name="payoffBalance" type="number" min="0" step="0.01" />
                <LabeledInput label="APR %" name="payoffApr" type="number" min="0" step="0.001" />
                <LabeledInput label="0% promo ends" name="promoAprEndsOn" type="date" />
                <LabeledInput label="Minimum / mo" name="payoffMinimum" type="number" min="0" step="0.01" />
                <LabeledInput label="Due day" name="payoffDueDay" type="number" min="1" max="31" step="1" />
                <LabeledInput label="Planned / mo" name="payoffPlanned" type="number" min="0" step="0.01" />
              </div>
              <p className="text-[11px] text-muted">APR % should be 0 during a 0% promo period; update to the regular rate when the promo ends. Balance and payment plan sync to Budget → Debt/Loans.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add card"}
            </button>
            <button
              type="button"
              onClick={() => onDone()}
              className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p className="text-sm font-medium text-negative">{error}</p>
          ) : null}
        </form>
      </div>
    );
  }

  return (
    <div className="border-t border-line px-5 py-4">
      <form
        action={(fd) =>
          start(async () => {
            const result = await addAccount(fd);
            if (result?.error) setError(result.error);
            else onDone(result?.id ?? null);
          })
        }
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {multiKind ? (
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Account type
            <select
              name="kind"
              className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {kindKeys.map((k) => (
                <option key={k} value={k}>{section.kindLabels[k]}</option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="kind" value={section.fixedKind ?? kindKeys[0]} />
        )}
        {section.kidsGroup ? <input type="hidden" name="kidsAccount" value="on" /> : null}
        {section.offerSubtype ? section.key === "loans" ? (
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Debt type
            <select name="subtype" defaultValue="" required onChange={(e) => setDebtSubtype(e.target.value)} className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Choose a debt type</option>
              {DEBT_KINDS.map((debtKind) => <option key={debtKind.value} value={debtKind.value}>{debtKind.label}</option>)}
            </select>
            <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">Used to label and filter this debt in Budget and Debt/Loans.</span>
          </label>
        ) : (
          <LabeledInput label="Investment type" name="subtype" placeholder="e.g. Roth IRA, brokerage, 529" />
        ) : null}
        <LabeledInput label="Account name" name="name" placeholder={section.key === "loans" ? "e.g. Home Mortgage" : "e.g. Fidelity Roth IRA"} required autoFocus onChange={() => setError(null)} />
        <LabeledInput label="Account holder(s)" name="holder" placeholder="e.g. Victor, Johana, or Joint" />
        <LabeledInput label="Account reference" name="accountNumber" placeholder="Full number or last four" />
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
          Ownership
          <select name="ownership" defaultValue="sole" className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="sole">Sole</option>
            <option value="joint">Joint</option>
          </select>
        </label>
        <LabeledInput
          label={section.key === "loans" ? "Current balance owed" : "Current balance"}
          name="balance"
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
        />
        {section.key === "loans" ? (
          <>
            <LabeledInput label="Original loan amount" name="originalBalance" type="number" step="0.01" placeholder="Optional" />
            <LabeledInput label="Interest rate (APR %)" name="apr" type="number" step="0.001" placeholder="0.000" hint="Enter 0 if the balance is currently on a 0% promotional offer." />
            <LabeledInput label="0% promotional APR ends" name="promoAprEndsOn" type="date" hint="Optional. This reminder appears with the debt details so you know when regular interest may begin." />
            <LabeledInput label="Required minimum / month" name="minPayment" type="number" step="0.01" placeholder="0.00" />
            <LabeledInput label="Budget payment planned / month" name="plannedPayment" type="number" step="0.01" placeholder="Defaults to the minimum payment" hint="How much you intend to pay in Budget. Leave blank to use the required minimum automatically." />
            <LabeledInput label="Payment due day" name="dueDay" type="number" min="1" max="31" step="1" placeholder="1–31" />
            {debtSubtype !== "credit_card" && (
              <LabeledInput label="Loan start date" name="loanStartDate" type="date" />
            )}
            {debtSubtype === "real_estate_loan" && (
              <>
                <LabeledInput label="Original term (months)" name="termMonths" type="number" min="1" step="1" placeholder="360 for a 30-year mortgage" />
                <LabeledInput label="Escrow / month" name="escrow" type="number" min="0" step="0.01" placeholder="Taxes + insurance, not payoff debt" />
              </>
            )}
            <p className="rounded-md bg-brand-soft/45 px-3 py-2 text-xs text-muted sm:col-span-2">
              This creates one linked item in Budget and Debt/Loans automatically.{debtSubtype === "real_estate_loan" ? " Escrow stays separate from principal and interest." : ""}
            </p>
          </>
        ) : null}
        <div className="flex items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Adding…" : section.key === "loans" ? "Add debt" : "Add account"}
          </button>
          <button
            type="button"
            onClick={() => onDone()}
            className="rounded-md px-2 py-2 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <span className="ml-auto text-[11px] text-muted">Account references are masked after saving.</span>
        </div>
      </form>
      {error ? (
        <p className="pt-3 text-sm font-medium text-negative">{error}</p>
      ) : null}
    </div>
  );
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const choices = SECTIONS.filter((section) =>
    ["banking", "investments", "credit", "loans", "kids"].includes(section.key),
  );
  const section = choices.find((choice) => choice.key === sectionKey) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-0 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 id="add-account-title" className="text-lg font-bold">
              {section ? `Add ${{ banking: "banking account", investments: "investment", credit: "credit card details", loans: "debt", kids: "Kids Funding account" }[section.key] ?? "account"}` : "Add account"}
            </h2>
            <p className="text-xs text-muted">
              {section ? "Enter the details you want your family to be able to find later." : "Choose where this account belongs."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-2xl leading-none text-muted hover:bg-brand-soft hover:text-foreground" aria-label="Close">×</button>
        </div>

        {!section ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => setSectionKey(choice.key)}
                className="flex items-start gap-3 rounded-xl border border-line p-4 text-left transition hover:border-brand hover:bg-brand-soft/40"
              >
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${choice.dot}`} />
                <span>
                  <span className="block font-semibold">{choice.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                    {choice.key === "banking" && "Checking, savings, or cash."}
                    {choice.key === "investments" && "Brokerage, retirement, 529, HSA, crypto, and more."}
                    {choice.key === "credit" && "Rewards cards, benefits, free nights, and card balances."}
                    {choice.key === "loans" && "Mortgage, auto, student, personal, medical, or other debt."}
                    {choice.key === "kids" && "Savings, investments, or 529s kept separate from household investments."}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="px-5 pt-4">
              <button type="button" onClick={() => setSectionKey(null)} className="text-sm font-medium text-brand hover:text-brand-strong">← Choose another type</button>
            </div>
            <AddAccountForm section={section} onDone={() => onClose()} />
            {section.key !== "credit" && section.key !== "loans" ? (
              <p className="px-5 pb-5 text-xs leading-relaxed text-muted">
                You can add buckets after the account is created. Account totals will always be calculated from their buckets.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function EditAccountForm({
  account,
  section,
  onDone,
}: {
  account: AccountData;
  section: Section;
  onDone: () => void;
}) {
  const [savePending, startSave] = useTransition();
  const [delPending, startDel] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-2 border-t border-line bg-background/60 px-4 py-3">
      <form
        action={(fd) =>
          startSave(async () => {
            await updateAccount(fd);
            onDone();
          })
        }
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="id" value={account.id} />
        {section.kidsGroup ? <input type="hidden" name="kidsAccount" value="on" /> : null}
        {/* Row 1: name, holder, account reference */}
        <div className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={account.name}
            required
            className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            name="holder"
            defaultValue={account.holder ?? ""}
            placeholder="Holder"
            title="Whose account? (e.g. V, J, Joint)"
            className="w-20 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            name="accountNumber"
            defaultValue={account.accountNumber ?? ""}
            placeholder="Account reference"
            className="w-36 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {/* Row 2: ownership, kind/subtype, active, save */}
        <div className="flex items-center gap-2">
          <select name="ownership" defaultValue={account.ownership} className="rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="sole">Sole</option>
            <option value="joint">Joint</option>
          </select>
          {section.offerSubtype ? (
            <input
              name="subtype"
              defaultValue={account.subtype ?? ""}
              placeholder="Type… (e.g. Roth IRA, 529)"
              className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
          ) : null}
          {section.key === "banking" ? (
            <select
              name="bankGroup"
              defaultValue={account.bankGroup ?? "spending"}
              title="Net Worth splits long-term Savings from everyday Bank Accounts"
              className="rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="spending">Checking</option>
              <option value="savings">Savings</option>
            </select>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              name="active"
              defaultChecked={account.active}
              className="h-3.5 w-3.5 rounded accent-[var(--brand)]"
            />
            Active
          </label>
          <button
            type="submit"
            disabled={savePending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {savePending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      {confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Delete &quot;{account.name}&quot;?</span>
          <form action={(fd) => startDel(() => deleteAccount(fd))}>
            <input type="hidden" name="id" value={account.id} />
            <button
              type="submit"
              disabled={delPending}
              className="text-xs font-bold text-negative hover:underline disabled:opacity-60"
            >
              {delPending ? "Deleting…" : "Yes, delete"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-xs text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs font-medium text-negative hover:underline"
          >
            Delete account
          </button>
          <button
            type="button"
            onClick={onDone}
            className="text-xs font-medium text-muted hover:text-foreground hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// Grab handle for drag-to-reorder — mirrors the Net Worth grid's handle so
// both boards reorder the same way (Victor prefers grab-and-drag over arrows).
function EditPill({ onClick, className, children }: { onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <span className="group/pill relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold hover:ring-1 ${className}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity duration-75 group-hover/pill:opacity-100">
        Click to edit
      </span>
    </span>
  );
}

function GripHandle({ onMouseDown, size = "md" }: { onMouseDown: () => void; size?: "sm" | "md" }) {
  const px = size === "sm" ? 11 : 13;
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}
      title="Drag to reorder"
      className="flex shrink-0 cursor-grab items-center rounded p-0.5 text-muted/60 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
    >
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </span>
  );
}

// Pointer-based row reordering shared by both drag contexts on this page
// (accounts within a section, buckets within an account). Rows carry a
// data-drop-key="<kind>:<id>"; grabbing a handle starts the drag, releasing
// over another row of the same kind fires onReorder(fromId, toId). Same
// approach as the Net Worth grid.
function usePointerReorder(kind: string, onReorder: (fromId: string, toId: string) => void) {
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const keyUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>("[data-drop-key]");
    const key = rowEl?.getAttribute("data-drop-key");
    return key && key.startsWith(`${kind}:`) ? key.slice(kind.length + 1) : null;
  };

  const startDrag = (id: string) => {
    dragId.current = id;
    document.body.style.cursor = "grabbing";
    const onMove = (e: MouseEvent) => setDragOverId(keyUnder(e.clientX, e.clientY));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverId(null);
      const from = dragId.current;
      dragId.current = null;
      const to = keyUnder(e.clientX, e.clientY);
      if (from && to && from !== to) onReorder(from, to);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { dragOverId, startDrag };
}
