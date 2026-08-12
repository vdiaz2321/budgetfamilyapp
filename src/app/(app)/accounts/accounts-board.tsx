"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import {
  addAccount,
  addBucket,
  closeCard,
  deleteAccount,
  deleteBucket,
  payCard,
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

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-07-01" -> "Jul"
function monthAbbr(firstOfMonth: string): string {
  return MONTH_ABBR[parseInt(firstOfMonth.slice(5, 7), 10) - 1] ?? "";
}

function maskAccountNumber(accountNumber: string | null): string | null {
  const lastFour = accountNumber?.replace(/\s/g, "").slice(-4);
  return lastFour ? `•••• ${lastFour}` : null;
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
  // Prior-month bucket_snapshots (null = never recorded yet for that month).
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
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
  owedCents?: number;
  monthSpendCents?: number;
  // Prior-month account_snapshots (null = never recorded yet for that month).
  // For bucketed accounts these are derived server-side from bucket_snapshots.
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
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
    dot: "bg-brand",
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
    label: "Credit Cards",
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
    label: "Archived Cards",
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
    dot: "bg-accent",
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
    dot: "bg-violet-500",
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
  const active = accounts.filter((a) => a.active);
  const isLiability = (kind: string) => kind === "credit_card" || kind === "debt_loan";

  const assets = active
    .filter((a) => !isLiability(a.kind) && !a.isKidsAccount)
    .reduce((sum, a) => sum + a.balanceCents, 0);
  // Build a map so we can tell which debts are already shown as debt_loan account rows.
  const accountKindById = new Map(active.map((a) => [a.id, a.kind]));
  const isDebtLoanLinked = (d: BudgetDebt) =>
    !!d.accountId && accountKindById.get(d.accountId) === "debt_loan";

  // debt_loan accounts are counted directly from the accounts array.
  const directDebtTotal = active
    .filter((a) => a.kind === "debt_loan")
    .reduce((sum, a) => sum + Math.abs(a.balanceCents), 0);
  const countedDirectDebtTotal = active
    .filter((a) => a.kind === "debt_loan" && !isDebtExcludedFromNetWorth(a.subtype))
    .reduce((sum, a) => sum + Math.abs(a.balanceCents), 0);

  // Budget debts only count rows NOT already represented as a debt_loan account
  // (e.g. credit cards flagged as revolving/payoff debt).
  const budgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) ? sum : sum + d.balanceCents),
    0,
  );
  const countedBudgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) || isDebtExcludedFromNetWorth(d.debtKind) ? sum : sum + d.balanceCents),
    0,
  );
  // Rewards cards are tracked separately from the Debt section. Their
  // transaction activity must not be converted into a household debt row.
  const debtsTotal = budgetDebtTotal + directDebtTotal;
  const mortgageExcluded = countedBudgetDebtTotal !== budgetDebtTotal || countedDirectDebtTotal !== directDebtTotal;
  const net = assets - countedBudgetDebtTotal - countedDirectDebtTotal;

  const assetSections = SECTIONS.filter((s) => !s.liability && !s.creditCard && !s.kidsGroup);
  const kidsSections = SECTIONS.filter((s) => s.kidsGroup);
  const creditSections = SECTIONS.filter((s) => s.creditCard);
  const debtAccountSections = SECTIONS.filter(
    (s) => s.liability && accounts.some((a) => s.match(a)),
  );
  const excludedSections = [...kidsSections, ...creditSections];

  // Only show orphan debts (no linked account) — linked debts are already shown in their account section.
  const visibleBudgetDebts = budgetDebts.filter((d) => d.balanceCents !== 0 && !d.accountId);
  const sectionKeys = [
    ...assetSections.map((s) => s.key),
    ...excludedSections.map((s) => s.key),
    ...debtAccountSections.map((s) => s.key),
    ...(visibleBudgetDebts.length > 0 ? ["budget_debts"] : []),
  ];
  const [collapsed, setCollapsed] = useSessionCollapse("accounts-sections-open", () =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, true])),
  );
  const allOpen = sectionKeys.every((k) => !collapsed[k]);
  const toggleSection = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Each account's bucket-drawer open/closed state, keyed by account id —
  // survives navigating to another page and back within the same browser
  // session instead of resetting to its default every time this board
  // remounts. See feedback: "Amex Savings keeps staying expanded... when I
  // collapse it when moving to a different page."
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

  const exportCsv = () => {
    const q = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [
      ["Name", "Kind", "Subtype", "Holder", "Active", "Balance", "Owed", "Annual Fee", "Fee Waived", "Date Opened", "Date Closed", "Is Kids", "Bank Group", "Current Points", "Rewards Program"].join(","),
    ];
    for (const a of accounts) {
      const d = a.cardDetails;
      rows.push([
        q(a.name),
        q(a.kind),
        q(a.subtype),
        q(a.holder),
        q(a.active ? "Yes" : "No"),
        q((a.balanceCents / 100).toFixed(2)),
        q(a.owedCents ? (a.owedCents / 100).toFixed(2) : ""),
        q(a.annualFeeCents ? (a.annualFeeCents / 100).toFixed(2) : ""),
        q(a.feeWaived ? "Yes" : ""),
        q(a.dateOpened),
        q(a.dateClosed),
        q(a.isKidsAccount ? "Yes" : ""),
        q(a.bankGroup),
        q(d?.currentPoints ?? ""),
        q(d?.rewardsProgram),
      ].join(","));
      for (const b of a.buckets) {
        rows.push([
          q(`  ${b.name}`),
          q("bucket"),
          q(""),
          q(""),
          q(""),
          q((b.balanceCents / 100).toFixed(2)),
          q(""), q(""), q(""), q(""), q(""), q(""), q(b.bankGroup), q(""), q(""),
        ].join(","));
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Accounts</h1>
        <p className="text-sm text-muted">
          Track banking, investments, cards, debts, and Kids Funding in one place.
        </p>
      </div>

      {/* Net worth summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryStat label="Assets" value={assets} currency={currency} tone="text-positive" />
        <SummaryStat label="Debts" value={debtsTotal} currency={currency} tone="text-negative" />
        <SummaryStat
          label="Net worth"
          value={net}
          currency={currency}
          tone={net >= 0 ? "text-foreground" : "text-negative"}
          hint={mortgageExcluded ? "Mortgage excluded" : undefined}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="shrink-0 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-strong"
        >
          + Add account
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="shrink-0 whitespace-nowrap rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-muted shadow-sm ring-1 ring-black/10 transition hover:bg-brand-soft hover:text-brand dark:ring-white/15"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={toggleAll}
          className="shrink-0 whitespace-nowrap rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-brand shadow-sm ring-1 ring-black/10 transition hover:bg-brand-soft dark:ring-white/15"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <div className="space-y-3">
        {assetSections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.match(a))}
            currency={currency}
            historyMonths={historyMonths}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
            isBucketsOpen={isBucketsOpen}
            onToggleBuckets={toggleBuckets}
          />
        ))}

        {debtAccountSections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.match(a))}
            currency={currency}
            historyMonths={historyMonths}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
            isBucketsOpen={isBucketsOpen}
            onToggleBuckets={toggleBuckets}
          />
        ))}

        {visibleBudgetDebts.length > 0 ? (
          <BudgetDebtsSection
            debts={visibleBudgetDebts}
            currency={currency}
            open={!collapsed.budget_debts}
            onToggle={() => toggleSection("budget_debts")}
          />
        ) : null}
      </div>

      {/* Kids Funding + Credit Cards sit apart — not counted in Net Worth. */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-3 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Not counted in net worth
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>
        {kidsSections.map((section) => {
          const sectionAccounts = accounts.filter((a) => section.match(a));
          if (sectionAccounts.length === 0 && section.key !== "kids") return null;
          return (
            <AccountSection
              key={section.key}
              section={section}
              accounts={sectionAccounts}
              currency={currency}
              historyMonths={historyMonths}
              open={!collapsed[section.key]}
              onToggle={() => toggleSection(section.key)}
              isBucketsOpen={isBucketsOpen}
              onToggleBuckets={toggleBuckets}
            />
          );
        })}
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
  const bankLabel = (a: AccountData) => a.cardDetails?.bank ?? a.subtype ?? "Other";
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

  // Fee summary considers ALL open cards (across every sub-section) so numbers
  // read the same on the main and closed-this-year sub-groups.
  const openCards = allCreditCards.filter((a) => !a.dateClosed);
  const feesPaid = openCards
    .filter((a) => !a.feeWaived && (a.annualFeeCents ?? 0) > 0)
    .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
  const feesWaived = openCards
    .filter((a) => a.feeWaived && (a.annualFeeCents ?? 0) > 0)
    .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
  const feesAll = feesPaid + feesWaived;
  const totalOwed = accounts.reduce((s, a) => s + (a.owedCents ?? 0), 0);
  const rewardCards = allCreditCards.filter((a) => a.cardDetails);
  const pointsValue = rewardCards.reduce((sum, a) => {
    const d = a.cardDetails;
    return sum + (d?.pointsValueMicros ? Math.round((d.currentPoints * d.pointsValueMicros) / 10_000) : 0);
  }, 0);
  const freeNightValue = rewardCards.reduce((sum, a) => sum + (a.cardDetails?.freeNightCreditCents ?? 0), 0);
  const totalPoints = rewardCards.reduce((sum, a) => sum + (a.cardDetails?.currentPoints ?? 0), 0);
  const travelValue = rewardCards
    .filter((a) => a.cardDetails?.rewardsCategory === "travel")
    .reduce((sum, a) => sum + (a.cardDetails?.pointsValueMicros ? Math.round((a.cardDetails.currentPoints * a.cardDetails.pointsValueMicros) / 10_000) : 0), 0);
  const hotelValue = rewardCards
    .filter((a) => a.cardDetails?.rewardsCategory === "hotel")
    .reduce((sum, a) => sum + (a.cardDetails?.pointsValueMicros ? Math.round((a.cardDetails.currentPoints * a.cardDetails.pointsValueMicros) / 10_000) : 0), 0);
  return (
    <section id={section.key === "credit" ? "credit-cards" : undefined} className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
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
        {!open && totalOwed > 0 ? (
          <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-negative sm:text-sm">
            {formatMoney(totalOwed, currency)} owed
          </span>
        ) : null}
      </div>

      {/* Summary strip — only on the main section, hidden when empty */}
      {open && isMain && (feesAll > 0 || totalOwed > 0 || rewardCards.length > 0 || allCreditCards.length > 0) ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          {totalOwed !== 0 ? (
            <span>
              <span className="font-semibold">Owed:</span>{" "}
              <span className={`font-semibold tabular-nums ${totalOwed > 0 ? "text-negative" : "text-positive"}`}>
                {formatMoney(totalOwed, currency)}
              </span>
            </span>
          ) : null}
          {isMain && rewardCards.length > 0 ? (
            <span>
              <span className="font-semibold">Rewards value:</span>{" "}
              <span className="font-semibold text-positive">{formatMoney(pointsValue + freeNightValue, currency)}</span>
              {totalPoints > 0 ? <> · <span className="font-semibold">Current Pts:</span> <span className="font-semibold text-foreground">{totalPoints.toLocaleString()}</span></> : null}
              {travelValue > 0 ? <> · Travel {formatMoney(travelValue, currency)}</> : null}
              {hotelValue > 0 ? <> · Hotel {formatMoney(hotelValue, currency)}</> : null}
              {freeNightValue > 0 ? <> · Free nights {formatMoney(freeNightValue, currency)}</> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-line">
          {reorderError ? (
            <p className="border-b border-line px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
          ) : null}
          {localAccounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">
              {isArchived ? "No archived cards." : "No credit cards yet — add one below."}
            </p>
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

// One card panel — collapsed row of glance-info, expanded 2-column grid for the
// full rewards details plus [Edit] [Pay Card] [Close] action bar.
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
  const [closePending, startClose] = useTransition();
  const [reopenPending, startReopen] = useTransition();

  const d = card.cardDetails;
  const owed = card.owedCents ?? 0;

  // Free-night expiry state for highlighting
  const today = new Date().toISOString().slice(0, 10);
  const fnExpires = d?.freeNightExpiresOn ?? null;
  const fnUsed = d?.benefitUsedOn ?? null;
  const fnExpired = fnExpires ? fnExpires < today : false;
  const fnDaysLeft = fnExpires && !fnExpired
    ? Math.round((new Date(fnExpires).getTime() - new Date(today).getTime()) / 86_400_000)
    : null;
  const fnSoon = fnDaysLeft !== null && fnDaysLeft <= 60;
  // expires color: muted-strikethrough if used+expired (renewal due), green if used+not-expired,
  // red if expired+unused (missed), amber if soon+unused, else normal
  const fnExpiresColor = fnUsed && fnExpired
    ? "text-muted line-through"
    : fnUsed
      ? "text-positive"
      : fnExpired
        ? "text-negative font-semibold"
        : fnSoon
          ? "text-amber-600 dark:text-amber-400 font-semibold"
          : "";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = monthNames[new Date().getMonth()];
  const monthSpend = card.monthSpendCents ?? 0;

  const bank = d?.bank ?? card.subtype ?? null;

  return (
    <li
      data-drop-key={`credit-card:${card.id}`}
      className={`${expanded ? "bg-brand-soft/15" : "hover:bg-brand-soft/25"} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
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
          // Collapsing must also clear the "editing" flag so a stale, unchanged
          // Save/Cancel/Delete bar doesn't hang out below when the panel reopens.
          if (!next) setEditing(false);
          return next;
        })}
        className={`flex flex-1 items-center gap-2 ${!isArchived && onDragStart ? "pl-1" : "pl-4"} pr-4 py-2 text-left`}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="truncate text-sm font-medium">{card.name}</span>
            {card.holder ? (
              <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                {card.holder}
              </span>
            ) : null}
            {bank ? (
              <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                {bank}
              </span>
            ) : null}
            {d?.authUser ? (
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {d.authUser}
              </span>
            ) : null}
            {card.dateClosed ? (
              <span className="shrink-0 rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
                Closed {card.dateClosed}
              </span>
            ) : null}
            {d && d.currentPoints > 0 ? (
              <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {d.currentPoints.toLocaleString()} pts
              </span>
            ) : null}
            {card.dateOpened ? (
              <span className="shrink-0 text-[10px] text-muted">
                Opened {card.dateOpened}
              </span>
            ) : null}
          </span>
          {(() => {
            const parts: React.ReactNode[] = [];
            if (card.annualFeeCents && !card.feeWaived) parts.push(<span key="fee">{formatMoney(card.annualFeeCents, currency)}/yr fee</span>);
            if (d?.freeNightCreditCents) parts.push(<span key="fnc">Free-Night Credit: {formatMoney(d.freeNightCreditCents, currency)}</span>);
            if (d?.freeNightPointsLimit) parts.push(<span key="fnp">Free Night: {d.freeNightPointsLimit.toLocaleString()} pts</span>);
            if (d?.freeNightExpiresOn) parts.push(<span key="fne" className={fnExpiresColor}>Free-Night Expires: {d.freeNightExpiresOn}{fnExpired && !fnUsed ? " ⚠ expired" : fnSoon && !fnUsed ? ` (${fnDaysLeft}d left)` : ""}</span>);
            if (d?.benefitUsedOn) parts.push(<span key="fnu" className={fnUsed && fnExpired ? "text-negative" : "text-positive"}>Used/Scheduled: {d.benefitUsedOn}</span>);
            if (!parts.length) return null;
            return (
              <p className="mt-0.5 text-[11px] text-muted sm:truncate">
                {parts.map((p, i) => <React.Fragment key={i}>{i > 0 ? " · " : ""}{p}</React.Fragment>)}
              </p>
            );
          })()}
        </span>
        <span className={`w-24 shrink-0 text-right text-sm font-semibold tabular-nums ${owed > 0 ? "text-negative" : owed < 0 ? "text-positive" : "text-muted"}`}>
          {owed !== 0 ? formatMoney(owed, currency) : "—"}
        </span>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-line bg-background/40 px-4 py-3">
          {/* Two-column detail grid */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <DetailRow label="Bank" value={bank} />
            <DetailRow label="Rewards" value={[d?.rewardsCategory, d?.rewardsProgram].filter(Boolean).join(" · ") || "—"} />
            <DetailRow label="Points" value={d && d.currentPoints > 0 ? d.currentPoints.toLocaleString() : "—"} />
            <DetailRow
              label="Points value"
              value={d?.pointsValueMicros ? <>{(d.pointsValueMicros / 1_000_000).toFixed(4)} / point · {formatMoney(Math.round((d.currentPoints * d.pointsValueMicros) / 10_000), currency)} <a href="https://www.dailydrop.com/calculator" target="_blank" rel="noreferrer" className="ml-1 text-brand hover:underline">Verify ↗</a></> : "—"}
            />
            <DetailRow label="Auth user" value={d?.authUser ?? "—"} />
            <DetailRow
              label="Bonus"
              value={
                d?.bonusInfo
                  ? d.bonusEarned
                    ? `${d.bonusInfo} ✓ met`
                    : d.bonusSpendCents
                      ? `${d.bonusInfo} · ${formatMoney(d.bonusSpendCents, currency)} spend${d.bonusSpendDeadline ? ` by ${d.bonusSpendDeadline}` : ""}`
                      : d.bonusInfo
                  : "—"
              }
            />
            <DetailRow label="Charging" value={d?.charging ?? "—"} />
            <DetailRow
              label="Annual fee"
              value={
                card.annualFeeCents
                  ? `${formatMoney(card.annualFeeCents, currency)}${card.feeWaived ? " (waived)" : ""}${d && d.feesPaidCents > 0 ? ` · ${formatMoney(d.feesPaidCents, currency)} paid` : ""}`
                  : "—"
              }
            />
            <DetailRow label="Opened" value={card.dateOpened ?? "—"} />
            <DetailRow
              label="Free night"
              value={
                d?.freeNightCreditCents || d?.freeNightExpiresOn || d?.freeNightPointsLimit
                  ? [
                      d.freeNightCreditCents ? formatMoney(d.freeNightCreditCents, currency) : null,
                      d.freeNightPointsLimit ? `${d.freeNightPointsLimit.toLocaleString()} pts` : null,
                      d.freeNightExpiresOn ? `expires ${d.freeNightExpiresOn}` : null,
                    ].filter(Boolean).join(" · ")
                  : "—"
              }
            />
            {d?.benefitUsedOn ? (
              <DetailRow label="Used / scheduled" value={d.benefitUsedOn} />
            ) : null}
            <DetailRow label="Closed" value={card.dateClosed ?? "—"} />
            <DetailRow label="Payoff tracking" value={d?.isRevolvingDebt ? "Included in Debt/Loans" : "Off"} />
            <DetailRow
              label="Spending limit"
              value={d?.spendingLimitCents ? formatMoney(d.spendingLimitCents, currency) : "—"}
            />
            {monthSpend !== 0 && !isArchived ? (
              <DetailRow label={`${monthLabel} spent`} value={formatMoney(monthSpend, currency)} />
            ) : null}
          </div>

          {d?.remarks ? (
            <p className="text-xs text-muted">
              <span className="font-semibold">Remarks:</span> {d.remarks}
            </p>
          ) : null}

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {!editing && !paying ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft/70"
                >
                  Edit details
                </button>
                {!isArchived && !card.dateClosed ? (
                  <button
                    type="button"
                    onClick={() => setPaying(true)}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
                  >
                    {owed > 0 ? "Pay full balance" : "Pay Card"}
                  </button>
                ) : null}
                {!isArchived && !card.dateClosed ? (
                  <form action={(fd) => startClose(() => closeCard(fd))}>
                    <input type="hidden" name="id" value={card.id} />
                    <button
                      type="submit"
                      disabled={closePending}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative/10 disabled:opacity-60"
                    >
                      {closePending ? "Closing…" : "Close Card"}
                    </button>
                  </form>
                ) : null}
                {(isArchived || card.dateClosed) ? (
                  <form action={(fd) => startReopen(() => reopenCard(fd))}>
                    <input type="hidden" name="id" value={card.id} />
                    <button
                      type="submit"
                      disabled={reopenPending}
                      className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft/70 disabled:opacity-60"
                    >
                      {reopenPending ? "Reopening…" : "Reopen"}
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}
          </div>

          {editing ? (
            <EditCreditCardForm
              card={card}
              onDone={() => setEditing(false)}
            />
          ) : null}

          {paying ? (
            <PayCardModal
              card={card}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={allBuckets}
              onClose={() => setPaying(false)}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="min-w-[6.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="min-w-0 text-sm text-foreground">{value}</span>
    </div>
  );
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
  const d = card.cardDetails;

  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-3">
      {/* One form: saves both account-level basics AND rewards details together */}
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
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="accountId" value={card.id} />
        <input type="hidden" name="isCreditCard" value="on" />
        <input type="hidden" name="subtype" value={card.subtype ?? ""} />
        <input type="hidden" name="active" value={card.active ? "on" : ""} />

        {/* Card basics */}
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
        </div>

        {/* Rewards details */}
        <div className="grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <LabeledInput label="Bank" name="bank" defaultValue={d?.bank ?? card.subtype ?? ""} placeholder="AMEX / Chase / Cap 1" />
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Rewards category</span>
            <select name="rewardsCategory" defaultValue={d?.rewardsCategory ?? ""} className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Not set</option><option value="travel">Travel</option><option value="hotel">Hotel</option>
            </select>
          </label>
          <LabeledInput label="Rewards program" name="rewardsProgram" defaultValue={d?.rewardsProgram ?? ""} placeholder="Hilton, Hyatt, Chase UR…" />
          <LabeledInput label="Value per point ($)" name="pointsValue" type="number" step="0.0001" defaultValue={d?.pointsValueMicros ? (d.pointsValueMicros / 1_000_000).toFixed(4) : ""} placeholder="0.0020" />
          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
            <input type="checkbox" name="five24Countable" defaultChecked={d?.five24Countable ?? true} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
            Count toward Chase 5/24
          </label>
          <LabeledInput label="Auth user" name="authUser" defaultValue={d?.authUser ?? ""} placeholder="" />
          <LabeledInput label="Charging" name="charging" defaultValue={d?.charging ?? ""} placeholder="Netflix, Google Drive" />
          <LabeledInput label="Current points" name="currentPoints" type="text" defaultValue={d?.currentPoints ? d.currentPoints.toLocaleString() : ""} placeholder="0" />
          <LabeledInput label="Bonus info" name="bonusInfo" defaultValue={d?.bonusInfo ?? ""} placeholder="60,000 pts" />
          <LabeledInput label="Bonus spend req." name="bonusSpend" type="number" step="0.01" prefix="$" defaultValue={d?.bonusSpendCents ? centsToDisplay(d.bonusSpendCents) : ""} placeholder="3000" />
          <LabeledInput label="Bonus deadline" name="bonusDeadline" type="date" defaultValue={d?.bonusSpendDeadline ?? ""} />
          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
            <input type="checkbox" name="bonusEarned" defaultChecked={d?.bonusEarned ?? false} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
            Bonus earned
          </label>
          <LabeledInput label="Free-night credit" name="freeNightCredit" type="number" step="0.01" prefix="$" defaultValue={d?.freeNightCreditCents ? centsToDisplay(d.freeNightCreditCents) : ""} />
          <LabeledInput label="Free-night expires" name="freeNightExpires" type="date" defaultValue={d?.freeNightExpiresOn ?? ""} />
          <LabeledInput label="Free night (pts limit)" name="freeNightPointsLimit" type="number" step="1" defaultValue={d?.freeNightPointsLimit ?? ""} />
          <LabeledInput label="Used / scheduled" name="benefitUsedOn" type="date" defaultValue={d?.benefitUsedOn ?? ""} />
          <LabeledInput label="Spending limit" name="spendingLimit" type="number" step="1" prefix="$" defaultValue={d?.spendingLimitCents ? centsToDisplay(d.spendingLimitCents) : ""} />
          <LabeledInput label="Fees paid this year" name="feesPaid" type="number" step="0.01" prefix="$" defaultValue={d?.feesPaidCents ? centsToDisplay(d.feesPaidCents) : ""} />
          <LabeledInput label="Card URL" name="cardUrl" type="url" defaultValue={d?.cardUrl ?? ""} placeholder="https://issuer.com/card" />
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Benefits reset</span>
            <select name="benefitCadence" defaultValue={d?.benefitCadence ?? "annual"} className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="anniversary">Card anniversary</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Remarks</label>
            <input name="remarks" defaultValue={d?.remarks ?? ""} placeholder="" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div className="space-y-3 rounded-lg border-2 border-rose-200 bg-rose-50/60 p-3 sm:col-span-2 dark:border-rose-900/50 dark:bg-rose-950/20">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <LabeledInput label="Balance owed" name="payoffBalance" type="number" min="0" step="0.01" defaultValue={d?.payoffBalanceCents ? centsToDisplay(d.payoffBalanceCents) : card.owedCents ? centsToDisplay(Math.max(0, card.owedCents)) : ""} />
              <LabeledInput label="APR %" name="payoffApr" type="number" min="0" step="0.001" defaultValue={d?.payoffApr ?? ""} />
              <LabeledInput label="0% promo ends" name="promoAprEndsOn" type="date" defaultValue={d?.promoAprEndsOn ?? ""} />
              <LabeledInput label="Minimum / mo" name="payoffMinimum" type="number" min="0" step="0.01" defaultValue={d?.payoffMinimumCents ? centsToDisplay(d.payoffMinimumCents) : ""} />
              <LabeledInput label="Planned / mo" name="payoffPlanned" type="number" min="0" step="0.01" defaultValue={d?.payoffPlannedCents ? centsToDisplay(d.payoffPlannedCents) : ""} />
              <LabeledInput label="Due day" name="payoffDueDay" type="number" min="1" max="31" step="1" defaultValue={d?.payoffDueDay ?? ""} />
            </div>
            <p className="text-[11px] text-muted">
              Balance and payment plan sync to Budget → Debt/Loans. Record actual interest charges there when carrying a balance past the promo period.
            </p>
          </div>
          {detailsError ? (
            <p className="sm:col-span-2 text-sm font-medium text-negative">{detailsError}</p>
          ) : null}
          {migrationWarning ? (
            <p className="sm:col-span-2 text-xs text-amber-600 dark:text-amber-400">
              Saved (most fields). To also save Used/Scheduled and Free Night pts limit, run migration 0026 in Supabase SQL Editor.
            </p>
          ) : null}
        </div>

        <div className="order-first flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savePending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {savePending ? "Saving…" : "Save all changes"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">Delete &quot;{card.name}&quot;?</span>
              <form action={(fd) => startDel(() => deleteAccount(fd))}>
                <input type="hidden" name="id" value={card.id} />
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
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs font-medium text-negative hover:underline"
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

function SummaryStat({
  label,
  value,
  currency,
  tone,
  hint,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5 shadow-sm ring-1 ring-black/5 sm:block sm:text-center sm:py-3 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="min-w-0 text-right sm:text-center">
        <p className={`truncate text-base font-bold tabular-nums sm:mt-0.5 sm:text-lg ${tone}`}>
          {formatMoney(value, currency)}
        </p>
        {hint ? <p className="text-[10px] text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

function AccountSection({
  section,
  accounts,
  currency,
  historyMonths,
  open,
  onToggle,
  isBucketsOpen,
  onToggleBuckets,
  legacy = false,
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
  historyMonths: [string, string, string];
  open: boolean;
  onToggle: () => void;
  isBucketsOpen: (id: string) => boolean;
  onToggleBuckets: (id: string) => void;
  legacy?: boolean;
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

  const total = localAccounts
    .filter((a) => a.active)
    .reduce((sum, a) => sum + a.balanceCents, 0);

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
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] sm:grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (open) setEditingId(null);
            onToggle();
          }}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${section.dot}`} />
          <span className="truncate font-semibold">{section.label}</span>
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
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
          {localAccounts.length > 0 ? (
            <div className="grid grid-cols-[1.5rem_1rem_minmax(0,1fr)_6rem] sm:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_1.25rem] items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <span />
              <span />
              <span />
              <span className="justify-self-stretch text-center">{monthAbbr(historyMonths[0])}</span>
              <span className="hidden justify-self-stretch text-center sm:block">{monthAbbr(historyMonths[1])}</span>
              <span className="hidden justify-self-stretch text-center sm:block">{monthAbbr(historyMonths[2])}</span>
              <span className="hidden sm:block" />
            </div>
          ) : null}
          {localAccounts.length === 0 ? (
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

function BudgetDebtsSection({
  debts,
  currency,
  open,
  onToggle,
}: {
  debts: BudgetDebt[];
  currency: string;
  open: boolean;
  onToggle: () => void;
}) {
  const total = debts.reduce((sum, d) => sum + d.balanceCents, 0);
  const kindLabel = (kind: string | null) =>
    DEBT_KINDS.find((k) => k.value === kind)?.label ?? "Debt";
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] sm:grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
          <span className="truncate font-semibold">Debts</span>
          <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
            {debts.length}
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
        <span className={`text-right text-sm font-bold tabular-nums ${total > 0 ? "text-negative" : ""}`}>
          {formatMoney(total, currency)}
        </span>
      </div>
      {open ? (
        <div className="border-t border-line">
          <ul className="divide-y divide-line">
            {debts.map((d) => {
              const excluded = isDebtExcludedFromNetWorth(d.debtKind);
              return (
                <li
                  key={d.subcategoryId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.name}</p>
                    <p className="truncate text-[11px] text-muted">
                      {kindLabel(d.debtKind)}
                      {excluded ? " · not in net worth" : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${d.balanceCents > 0 ? "text-negative" : "text-muted"}`}>
                    {formatMoney(d.balanceCents, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
            Managed in{" "}
            <Link href="/budget" className="font-medium text-brand hover:text-brand-strong">
              Budget → Debt
            </Link>
            . Edit balances there.
          </p>
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
  editing: boolean;
  onToggleEdit: () => void;
  onDragStart: () => void;
  isDragOver: boolean;
  bucketsOpen: boolean;
  onToggleBuckets: () => void;
}) {
  const kindLabel = section.kindLabels[account.kind] ?? account.kind;
  // Banking rows already show a Savings/Checking chip (the Net Worth tag) —
  // showing the structural kind label too just repeats the same word.
  const showKind = section.key !== "banking" && Object.keys(section.kindLabels).length > 1;
  // Buckets make sense for asset accounts (savings/investments/cash), not for
  // credit cards or loans.
  const allowBuckets = !section.liability;
  const bucketCount = account.buckets.length;

  const rowBg = editing ? "bg-brand-soft/30" : "hover:bg-brand-soft/25";

  return (
    <li
      data-drop-key={`account:${account.id}`}
      className={`${rowBg} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
    >
      <div className="grid grid-cols-[1.5rem_1rem_minmax(0,1fr)_6rem] sm:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_1.25rem] items-center gap-1.5 px-4 py-1.5">
        <GripHandle onMouseDown={onDragStart} />
        {allowBuckets ? (
          <button
            type="button"
            onClick={onToggleBuckets}
            title={bucketsOpen ? "Hide buckets" : "Show buckets"}
            aria-expanded={bucketsOpen}
            className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-brand-soft/50 hover:text-brand"
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
        <button
          type="button"
          onClick={onToggleEdit}
          className="group/name relative flex w-full min-w-0 max-w-full flex-col items-start justify-self-start gap-0.5 text-left sm:inline-flex sm:w-fit sm:flex-row sm:items-baseline sm:gap-2"
        >
          <span
            role="tooltip"
            className="pointer-events-none absolute -top-6 left-0 z-10 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity duration-75 group-hover/name:opacity-100"
          >
            Click to edit
          </span>
          {/* Tag row: sits above the name on mobile so the name gets full width;
              on desktop moves after the name via `sm:order-2` for the original inline look. */}
          <span className="order-1 flex min-w-0 flex-wrap items-baseline gap-1.5 sm:order-2">
            {account.holder ? (
              <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                {account.holder}
              </span>
            ) : null}
            {account.ownership === "joint" ? (
              <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">Joint</span>
            ) : null}
            {account.institution ? <span className="shrink-0 text-[11px] text-muted">{account.institution}</span> : null}
            {maskAccountNumber(account.accountNumber) ? <span className="shrink-0 text-[11px] text-muted">{maskAccountNumber(account.accountNumber)}</span> : null}
            {section.key === "banking" && account.bankGroup ? (
              <span
                title="Net Worth uses this account-level setting"
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  account.bankGroup === "savings"
                    ? "bg-positive/15 text-positive"
                    : "bg-black/5 text-muted dark:bg-white/10"
                }`}
              >
                {account.bankGroup === "savings" ? "Savings" : "Checking"}
              </span>
            ) : null}
            {account.subtype ? (
              <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                {account.subtype}
              </span>
            ) : null}
            {showKind ? <span className="shrink-0 text-[11px] text-muted">{kindLabel}</span> : null}
            {bucketCount > 0 ? (
              <span className="shrink-0 text-[11px] text-muted">
                {bucketCount} {bucketCount === 1 ? "bucket" : "buckets"}
              </span>
            ) : null}
            {!account.active ? <span className="shrink-0 text-[11px] text-muted">archived</span> : null}
          </span>
          <span className={`order-2 w-full truncate text-sm sm:order-1 sm:w-auto ${account.active ? "text-foreground" : "text-negative"}`}>
            {account.name}
          </span>
        </button>

        {allowBuckets && bucketCount > 0 ? (
          <>
            <DerivedBalance balanceCents={account.balanceCents} currency={currency} />
            <div className="hidden sm:contents">
              <DerivedBalance
                balanceCents={account.prevMonthCents ?? 0}
                currency={currency}
                muted={account.prevMonthCents == null}
              />
              <DerivedBalance
                balanceCents={account.prev2MonthCents ?? 0}
                currency={currency}
                muted={account.prev2MonthCents == null}
              />
            </div>
          </>
        ) : (
          <>
            <BalanceInput
              id={account.id}
              balanceCents={account.balanceCents}
              currency={currency}
              liability={section.liability}
            />
            <div className="hidden sm:contents">
              <HistoricBalanceInput
                accountId={account.id}
                month={historyMonths[1]}
                balanceCents={account.prevMonthCents}
                currency={currency}
                liability={section.liability}
              />
              <HistoricBalanceInput
                accountId={account.id}
                month={historyMonths[2]}
                balanceCents={account.prev2MonthCents}
                currency={currency}
                liability={section.liability}
              />
            </div>
          </>
        )}
        <span className="hidden sm:block" aria-hidden />
      </div>

      {allowBuckets && bucketsOpen ? (
              <BucketDrawer
                account={account}
                currency={currency}
                historyMonths={historyMonths}
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
}: {
  account: AccountData;
  currency: string;
  historyMonths: [string, string, string];
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
    <div className="border-t border-line bg-background/40 px-4 py-2 sm:pl-11 sm:pr-4">
      {reorderError ? <p className="pb-1.5 text-xs font-medium text-negative">{reorderError}</p> : null}
      {localBuckets.length === 0 ? (
        <p className="py-1 text-xs text-muted">
          No buckets yet — optional. Split this account into sinking funds (e.g. Emergency Fund,
          Vehicle, Real Estate). Leave empty for accounts you don&apos;t need to break down.
        </p>
      ) : (
        <ul className="divide-y divide-line/60">
          {localBuckets.map((b) => (
            <BucketRow
              key={b.id}
              bucket={b}
              currency={currency}
              historyMonths={historyMonths}
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
  onDragStart,
  isDragOver,
}: {
  bucket: BucketData;
  currency: string;
  historyMonths: [string, string, string];
  onDragStart: () => void;
  isDragOver: boolean;
}) {
  const [delPending, startDel] = useTransition();

  return (
    <li
      data-drop-key={`bucket:${bucket.id}`}
      className={`group relative grid items-center gap-1.5 py-1 ${
        isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""
      } grid-cols-[1.5rem_minmax(0,1fr)_6rem] sm:grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_8.5rem_8.5rem_1.25rem]`}
    >
      <GripHandle onMouseDown={onDragStart} size="sm" />
      <BucketNameInput id={bucket.id} name={bucket.name} />
      <BucketBalanceInput id={bucket.id} balanceCents={bucket.balanceCents} currency={currency} />
      <div className="hidden sm:contents">
        <HistoricBucketBalanceInput
          bucketId={bucket.id}
          month={historyMonths[1]}
          balanceCents={bucket.prevMonthCents}
          currency={currency}
        />
        <HistoricBucketBalanceInput
          bucketId={bucket.id}
          month={historyMonths[2]}
          balanceCents={bucket.prev2MonthCents}
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
        className={`w-full min-w-0 rounded-md bg-transparent px-1 py-0.5 text-xs transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 sm:text-sm ${
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
  const initial = centsToDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => updateBucketBalance(fd))}
      className="justify-self-center inline-flex items-center gap-0"
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
        className={`w-auto min-w-0 max-w-full flex-none rounded-md bg-transparent py-0.5 px-0 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
  const initial = balanceCents == null ? "" : centsToDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setBucketSnapshot(fd))}
      className="justify-self-center inline-flex items-center gap-0"
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
        className="justify-self-center inline-flex items-center gap-0 py-1"
      >
        <span className="text-sm">—</span>
      </div>
    );
  }
  return (
    <div
      title="Sum of this account's buckets — edit the buckets below to change it"
      className="justify-self-center inline-flex items-center gap-0 py-1"
    >
      <span className={`text-sm ${negative ? "text-negative" : "text-muted"}`}>{currencySymbol(currency)}</span>
      <span className={`text-[0.9375rem] tabular-nums ${negative ? "text-negative font-semibold" : ""}`}>
        {centsToDisplay(balanceCents)}
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
  const initial = balanceCents == null ? "" : centsToDisplay(balanceCents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setAccountSnapshot(fd))}
      className="justify-self-center inline-flex items-center gap-0"
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
  const initial = centsToDisplay(balanceCents);

  return (
    <div className="flex w-full items-center justify-center">
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
  const kindKeys = Object.keys(section.kindLabels);
  const multiKind = kindKeys.length > 1;

  // Credit cards get a proper labeled "card basics" form (Card name, Holder,
  // Annual fee + waived, Date opened, Date closed) matching Edit details, so
  // fields are clear up front. Rewards details (bank, points, bonus, etc.)
  // are still filled in via Edit details after the card is created.
  if (section.creditCard) {
    return (
      <div className="border-t border-line px-4 py-3">
        <form
          action={(fd) =>
            start(async () => {
              const result = await addAccount(fd);
              if (result?.error) setError(result.error);
              else onDone(result?.id ?? null);
            })
          }
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <input type="hidden" name="kind" value={section.fixedKind ?? kindKeys[0]} />
          <LabeledInput label="Card name" name="name" placeholder="e.g. 1175 Sapphire V" required autoFocus onChange={() => setError(null)} />
          <LabeledInput label="Institution" name="institution" placeholder="e.g. Chase" />
          <LabeledInput label="Account holder(s)" name="holder" />
          <LabeledInput label="Account reference" name="accountNumber" placeholder="Full number or last four" />
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Ownership
            <select name="ownership" defaultValue="sole" className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="sole">Sole</option>
              <option value="joint">Joint</option>
            </select>
          </label>
          <LabeledInput label="Annual fee" name="annualFee" type="number" step="0.01" placeholder="0.00" />
          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
            <input type="checkbox" name="feeWaived" className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
            Fee waived (e.g. military benefit)
          </label>
          <LabeledInput label="Date opened" name="dateOpened" type="date" />
          <LabeledInput label="Date closed" name="dateClosed" type="date" />
          <div className="flex items-center gap-2 sm:col-span-2">
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
            <span className="ml-auto text-[11px] text-muted">You can add rewards and benefits after saving.</span>
          </div>
          {error ? (
            <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p>
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
        <LabeledInput label="Institution" name="institution" placeholder="e.g. Fidelity, Amex, Navy Federal" />
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
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 id="add-account-title" className="text-lg font-bold">
              {section ? `Add ${{ banking: "banking account", investments: "investment", credit: "credit card", loans: "debt", kids: "Kids Funding account" }[section.key] ?? "account"}` : "Add account"}
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
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="id" value={account.id} />
        {section.kidsGroup ? <input type="hidden" name="kidsAccount" value="on" /> : null}
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
          name="institution"
          defaultValue={account.institution ?? ""}
          placeholder="Institution"
          className="w-32 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          name="accountNumber"
          defaultValue={account.accountNumber ?? ""}
          placeholder="Account reference"
          className="w-36 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <select name="ownership" defaultValue={account.ownership} className="rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="sole">Sole</option>
          <option value="joint">Joint</option>
        </select>
        {section.offerSubtype ? (
          <input
            name="subtype"
            defaultValue={account.subtype ?? ""}
            placeholder="Type… (e.g. Retirement, Roth IRA, 529, Trump Account)"
            className="w-56 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
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
