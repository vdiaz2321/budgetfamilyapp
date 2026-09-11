"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { TAX_LABEL_SHORT, TAX_TREATMENTS } from "@/lib/tax-treatment";
import { RETIREMENT_KINDS, RETIREMENT_LABEL } from "@/lib/retirement-kind";
import { centsToGroupedDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { CardPaymentsLedger, type CardPayment } from "@/components/card-payments-ledger";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { GripHandle, LabeledInput, PayCardModal, usePointerReorder } from "./shared-ui";
import {
  addAccount,
  addCreditCardWithDetails,
  addBucket,
  deleteAccount,
  deleteBucket,
  transferBetweenAccounts,
  reorderAccounts,
  reorderBuckets,
  updateAccount,
  updateBalance,
  updateBucket,
  updateBucketBalance,
} from "./actions";
import { setAccountSnapshot, setBucketSnapshot } from "../networth/actions";
import { DEBT_KINDS } from "../budget/types";
import { isDebtExcludedFromNetWorth, hasPropertyAsset } from "@/lib/net-worth";
import { PeriodPicker } from "../insights/insights-period-picker";
import { currentPeriodKey, periodLabel, priorKey, type Granularity } from "../insights/period";
import {
  CREDIT_SECTIONS,
  type AccountData,
  type BucketData,
  type BudgetDebt,
  type CardDetails,
  type NonCardAccount,
  type RewardActivity,
  type Section,
} from "./types";

// Re-exported so importers (page.tsx) keep one import site for the board and
// the shapes it takes.
export type { AccountData, BucketData, BudgetDebt, CardDetails, NonCardAccount, RewardActivity };

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

// How many months the popup shows, newest first. Columns past the first
// appear only as the popup gets wide enough for them — see MONTH_GRID below.
const MONTH_COLUMNS = 5;
// Column visibility, by index: month 0 always, 1-2 once the panel clears
// 560px, 3-4 once it clears 860px. Kept as literal class strings because
// Tailwind only generates the arbitrary values it can see in the source.
// Written out in full rather than built by string surgery: Tailwind only
// emits the arbitrary variants it can literally see in the source, so a class
// assembled at runtime silently never gets any CSS.
const MONTH_TIER = ["", "hidden @[560px]:contents", "hidden @[860px]:contents"] as const;
const MONTH_HEAD_TIER = ["", "hidden @[560px]:block", "hidden @[860px]:block"] as const;
const monthTier = (i: number) => (i === 0 ? MONTH_TIER[0] : i <= 2 ? MONTH_TIER[1] : MONTH_TIER[2]);
const monthHeadTier = (i: number) =>
  i === 0 ? MONTH_HEAD_TIER[0] : i <= 2 ? MONTH_HEAD_TIER[1] : MONTH_HEAD_TIER[2];
// Row grids: name + 1 money column when narrow, + 3 at 560px, + 5 at 860px.
const ROW_GRID =
  "grid-cols-[1.5rem_1rem_minmax(0,1fr)_6rem] @[560px]:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7rem_7rem_7rem_1.25rem] @[860px]:grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7rem_7rem_7rem_7rem_7rem_1.25rem]";
const DEBT_ROW_GRID =
  "grid-cols-[minmax(0,1fr)_6rem] @[560px]:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] @[860px]:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_7rem_7rem]";

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
  ...CREDIT_SECTIONS,
  {
    key: "property",
    label: "Property",
    dot: "bg-[color:var(--viz-bills)]",
    liability: false,
    match: (a) => !a.isKidsAccount && a.kind === "property",
    kindLabels: { property: "Property" },
    fixedKind: "property",
    offerSubtype: true,
    subtypeOptions: ["Primary residence", "Rental property", "Land", "Other"],
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
  historyMonths: string[];
  // Payments made TO cards — feeds the read-only "Card payments" report at
  // the bottom of the Credit Cards section. Never used for balances.
  cardPayments?: CardPayment[];
};

/** Shared tax <select>. Kept in one place so the account and bucket controls
 *  can't drift apart in labelling or option order. */
/**
 * Which annual contribution limit governs this holding.
 *
 * Separate from the tax-treatment picker beside it because the two answer
 * different questions: a Roth IRA and a Roth TSP are both tax-free, but they
 * are governed by completely different limits. Setting this explicitly is what
 * stops the contribution-cap card guessing from the account name — and a guess
 * there is what made a second Roth IRA look like a second full allowance.
 */
function RetirementKindSelect({
  name,
  value,
  className,
}: {
  name: string;
  value: string | null;
  className?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      aria-label="Retirement type"
      className={`rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand ${className ?? ""}`}
    >
      <option value="">Not a retirement account</option>
      {RETIREMENT_KINDS.map((k) => (
        <option key={k} value={k}>
          {RETIREMENT_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

function TaxTreatmentSelect({
  name,
  value,
  onChanged,
  className,
}: {
  name: string;
  value: string | null;
  onChanged?: () => void;
  className?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      onChange={onChanged ? () => onChanged() : undefined}
      aria-label="Tax treatment"
      // Fixed width, and the NAME yields instead: a squeezed select renders
      // its own value as "Deferre"/"Tax-fre", which reads as broken. A
      // truncated bucket name is an editable input that shows the rest on
      // focus, so it degrades far more gracefully.
      className={`w-[5.25rem] shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand ${className ?? ""}`}
    >
      {/* No "Auto" option: Victor sets the treatment himself. The blank entry
          exists only so an account created before this field can still render
          — it disappears from the list the moment a real value is chosen. */}
      {value ? null : <option value="">Not set</option>}
      {TAX_TREATMENTS.map((t) => (
        <option key={t} value={t}>
          {TAX_LABEL_SHORT[t]}
        </option>
      ))}
    </select>
  );
}

// The Type field's vocabulary. It used to be free text, which let the same
// thing in as "401k", "401 K" and "Roth ira" — three spellings that then
// classify (and group) differently downstream. Anything missing goes in
// through "Add type…", and once one account uses a custom value it shows up
// in every other account's list via SubtypeOptionsContext.
const ACCOUNT_SUBTYPES = [
  "Checking",
  "Savings",
  "Taxable",
  "401K",
  "Roth IRA",
  "Trad IRA",
  "TSP Roth",
  "TSP Traditional",
  "REIT",
];

/** A section whose Type field has a fixed vocabulary (Property). Unlike
 *  SubtypeSelect there is no "Add type…" escape hatch — the list is the list. */
function FixedSubtypeSelect({
  name,
  options,
  value,
  className,
}: {
  name: string;
  options: string[];
  value: string | null;
  className?: string;
}) {
  const current = (value ?? "").trim();
  const all = current && !options.includes(current) ? [...options, current] : options;
  return (
    <select
      name={name}
      defaultValue={current}
      aria-label="Type"
      className={`rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand ${className ?? ""}`}
    >
      <option value="">Type…</option>
      {all.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

/** Custom types already in use, so "Mortgage" only has to be typed once. */
const SubtypeOptionsContext = React.createContext<string[]>([]);

/** Sections whose Type field is an account type. Debts keep DEBT_KINDS and
 *  credit cards keep the free-text bank name. */
const usesSubtypeList = (sectionKey: string) => sectionKey === "investments" || sectionKey === "kids";

function SubtypeSelect({
  name,
  value,
  className,
}: {
  name: string;
  value: string | null;
  className?: string;
}) {
  const known = React.useContext(SubtypeOptionsContext);
  const current = (value ?? "").trim();
  const options = Array.from(new Set([...ACCOUNT_SUBTYPES, ...known, ...(current ? [current] : [])]));
  const [custom, setCustom] = useState(false);
  const base = "rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

  if (custom) {
    return (
      <span className={`flex min-w-0 items-center gap-1 ${className ?? ""}`}>
        <input
          name={name}
          defaultValue=""
          autoFocus
          placeholder="New type (e.g. Mortgage)"
          className={`min-w-0 flex-1 ${base}`}
        />
        <button
          type="button"
          onClick={() => setCustom(false)}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-muted hover:bg-black/5 dark:hover:bg-white/10"
        >
          Use list
        </button>
      </span>
    );
  }

  return (
    <select
      name={name}
      defaultValue={current}
      aria-label="Account type"
      onChange={(e) => {
        if (e.target.value === "__add") setCustom(true);
      }}
      className={`${base} ${className ?? ""}`}
    >
      <option value="">Type…</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value="__add">+ Add type…</option>
    </select>
  );
}

export function AccountsBoard({
  accounts,
  budgetDebts,
  currency,
  nonCardAccounts = [],
  historyMonths,
  cardPayments = [],
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const creditCards = accounts.filter((a) => a.kind === "credit_card");
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
  const displayMonths: string[] = Array.from({ length: MONTH_COLUMNS }, (_, i) =>
    shiftMonth(anchorMonth, i),
  );
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
  // A mortgage only counts against Net Worth once the home behind it is
  // tracked — see lib/net-worth.ts.
  const ownsProperty = hasPropertyAsset(active);
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
    .filter((a) => a.kind === "debt_loan" && !isDebtExcludedFromNetWorth(a.subtype, ownsProperty))
    .reduce((sum, a) => sum + Math.abs(balanceOf(a)), 0);

  // Budget debts only count rows NOT already represented as a debt_loan account
  // (e.g. credit cards flagged as revolving/payoff debt).
  const budgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) ? sum : sum + debtBalanceOf(d)),
    0,
  );
  const countedBudgetDebtTotal = budgetDebts.reduce(
    (sum, d) => (isDebtLoanLinked(d) || isDebtExcludedFromNetWorth(d.debtKind, ownsProperty) ? sum : sum + debtBalanceOf(d)),
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
      if (isDebtExcludedFromNetWorth(a.subtype, ownsProperty)) continue;
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
      if (isDebtLoanLinked(d) || isDebtExcludedFromNetWorth(d.debtKind, ownsProperty)) continue;
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
  const [collapsed, setCollapsed] = useSessionCollapse("accounts-sections-open", () =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.key !== "credit"])),
  );
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
  // Which section's popup is showing. Deliberately not persisted: reopening
  // the page to a modal over the board would be disorienting.
  const [openSectionKey, setOpenSectionKey] = useState<string | null>(null);
  const toggleBuckets = (id: string) =>
    setBucketsOpen((c) => ({ ...c, [id]: !isBucketsOpen(id) }));

  // Custom Types already saved on fund accounts, offered alongside the fixed
  // list so a one-off ("Mortgage") only has to be typed once.
  const knownSubtypes = Array.from(
    new Set(
      accounts
        .filter((a) => a.kind === "investment" || a.isKidsAccount)
        .map((a) => (a.subtype ?? "").trim())
        .filter(Boolean),
    ),
  );

  return (
    <SubtypeOptionsContext.Provider value={knownSubtypes}>
    <div className="mx-auto w-full max-w-[110rem] space-y-4">
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
            className="shrink-0 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-strong"
          >
            Transfer Funds
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="shrink-0 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-strong"
          >
            Add account
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
            // One popup at a time — these open as dialogs now, so this is a
            // plain "which section is open" rather than the persisted
            // per-section collapse the credit-card lists still use.
            open={openSectionKey === section.key}
            onToggle={() => setOpenSectionKey((k) => (k === section.key ? null : section.key))}
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
            <CreditCardListSection
              key={section.key}
              section={section}
              accounts={sectionAccounts}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={accounts.flatMap((a) => a.buckets)}
              open={!collapsed[section.key]}
              onToggle={() => toggleSection(section.key)}
            />
          );
        })}
        {/* Card payments is its own card, not a tail welded onto the Credit
            Cards card — a separate report that collapses on its own. */}
        {creditCards.length > 0 ? (
          <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <CardPaymentsLedger
              payments={cardPayments}
              cardNames={Object.fromEntries(creditCards.map((c) => [c.id, c.name]))}
              currency={currency}
              storageKey="accounts-card-payments-open"
              showChart={false}
            />
          </div>
        ) : null}
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
    </SubtypeOptionsContext.Provider>
  );
}

// ---- Credit cards on Accounts: what each card owes, and how to pay it.
//
// The points, free nights and rewards ledger moved to /travel — this is the
// money half. A card's balance belongs beside the accounts that pay it.

function CreditCardListSection({
  section,
  accounts,
  currency,
  nonCardAccounts,
  allBuckets,
  open,
  onToggle,
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  open: boolean;
  onToggle: () => void;
}) {
  const [payCardFor, setPayCardFor] = useState<AccountData | null>(null);
  const isMain = section.key === "credit";
  const totalOwed = accounts.reduce((s, a) => s + (a.owedCents ?? 0), 0);

  return (
    <section id={isMain ? "credit-cards" : undefined} className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Mobile puts the title and chevron on their own row and drops the
          link + total underneath; below ~400px they cannot share a line
          without the chip sitting on top of the title. */}
      {/* The whole header toggles, blank space included — same as the other
          section tiles. The title and chevron buttons have no onClick of their
          own: their clicks (and Enter/Space) bubble up to this one. */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-black/[0.02] sm:px-6 dark:hover:bg-white/[0.04]"
      >
        <button type="button" className="order-1 min-w-0 shrink-0 text-left" aria-expanded={open}>
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${section.dot}`} aria-hidden />
            <span className="text-base font-bold sm:text-lg">{section.label}</span>
          </span>
        </button>
        {/* The row itself is the button now, so say so — a card with no visible
            control needs one line telling you it is one. */}
        {open && accounts.length > 0 ? (
          <span className="order-1 min-w-0 flex-1 text-[11px] text-muted">Click on card to make payment</span>
        ) : null}
        {/* ml-auto pins this group right even when collapsed — the hint
            above used to be the only spacer, so it slid left without it. */}
        <div className="order-3 flex w-full items-center justify-between gap-3 sm:order-2 sm:ml-auto sm:w-auto sm:justify-end">
        {/* Where the points live now. Named for what it holds, not "see also". */}
        <Link
          href="/travel"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md border border-brand/30 bg-background px-2 py-1 text-[11px] font-semibold text-brand transition hover:border-brand/60 hover:bg-brand-soft/30 dark:bg-slate-950"
        >
          Points & rewards →
        </Link>
        <span className="shrink-0 text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Total CC owed</span>
          <span className="block text-sm font-bold tabular-nums text-negative sm:text-base">
            {formatMoney(totalOwed, currency)}
          </span>
        </span>
        </div>
        <button
          type="button"
          className="order-2 ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-slate-100 dark:hover:bg-slate-800 sm:order-3 sm:ml-0"
          aria-label={open ? `Collapse ${section.label}` : `Expand ${section.label}`}
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

      {open ? (
        accounts.length === 0 ? (
          <p className="border-t border-line px-4 py-4 text-xs text-muted sm:px-6">No cards here yet.</p>
        ) : (
          // Tiles, not one 13-row column: at full width a single list left
          // two-thirds of the card empty and pushed Card payments off the
          // screen. Ragged last rows are why these are ringed tiles with a
          // gap rather than a hairline grid. One line per card — name, holder,
          // owed, Pay; the annual fee lives on /travel with the rest of the
          // card's detail.
          <ul className="grid grid-cols-1 gap-2 border-t border-line px-4 py-3 sm:grid-cols-2 sm:px-6 md:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id}>
                {/* An open card is the whole row: thirteen Pay pills read as a
                    field of buttons, and the card is the thing you mean to
                    press. A closed card keeps the row, minus the action. */}
                {!a.dateClosed ? (
                  <button
                    type="button"
                    onClick={() => setPayCardFor(a)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left ring-1 ring-line transition hover:bg-black/5 hover:ring-black/25 dark:hover:bg-white/10 dark:hover:ring-white/30"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.name}</span>
                    {/* Red is for money actually owed. A paid-off card reading
                        in red made twelve settled cards look like twelve
                        problems. */}
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        (a.owedCents ?? 0) > 0 ? "text-negative" : "text-muted"
                      }`}
                    >
                      {formatMoney(a.owedCents ?? 0, currency)}
                    </span>
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-line">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-muted">{a.name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">
                      {formatMoney(a.owedCents ?? 0, currency)}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {payCardFor ? (
        <PayCardModal
          card={payCardFor}
          currency={currency}
          nonCardAccounts={nonCardAccounts}
          allBuckets={allBuckets}
          onClose={() => setPayCardFor(null)}
        />
      ) : null}
    </section>
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

type SumSelection = {
  mode: boolean;
  picks: Map<string, number>;
  toggle: (key: string, cents: number) => void;
  refresh: (key: string, cents: number) => void;
};
const SumSelectContext = React.createContext<SumSelection | null>(null);

// Wraps one money cell so it can be picked into the popup's running sum.
// In "Add up" mode a transparent button covers the input, so a tap (including
// on a phone) selects instead of focusing. Outside the mode, Cmd/Ctrl/Shift
// -click selects and a plain click still edits.
function SumCell({ pickKey, cents, children }: { pickKey: string; cents: number | null; children: React.ReactNode }) {
  const sum = React.useContext(SumSelectContext);
  const picked = sum != null && sum.picks.has(pickKey);
  const refresh = sum?.refresh;
  useEffect(() => {
    if (picked && cents != null) refresh?.(pickKey, cents);
  }, [picked, cents, pickKey, refresh]);

  if (!sum || cents == null) return <>{children}</>;
  const isModifierClick = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey;
  return (
    <div
      onMouseDownCapture={(e) => {
        // Stop the input from taking focus on a modifier-click.
        if (isModifierClick(e)) e.preventDefault();
      }}
      onClickCapture={(e) => {
        if (!isModifierClick(e)) return;
        e.preventDefault();
        e.stopPropagation();
        sum.toggle(pickKey, cents);
      }}
      className={`relative -mx-0.5 flex w-full items-center justify-end rounded-md px-0.5 ${
        picked ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/60" : ""
      }`}
    >
      {children}
      {sum.mode ? (
        <button
          type="button"
          aria-pressed={picked}
          aria-label={picked ? "Remove from sum" : "Add to sum"}
          onClick={(e) => {
            e.stopPropagation();
            sum.toggle(pickKey, cents);
          }}
          className={`absolute inset-0 cursor-pointer rounded-md ${picked ? "" : "hover:bg-sky-500/10"}`}
        />
      ) : null}
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
  historyMonths: string[];
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

  // Pick-to-sum, spreadsheet style. "Add up" mode makes a tap select a value
  // instead of editing it (the only way on a phone); on desktop Cmd/Ctrl/Shift
  // -click selects without the mode, so editing is never locked out.
  const [sumMode, setSumMode] = useState(false);
  const [sumPicks, setSumPicks] = useState<Map<string, number>>(() => new Map());
  const toggleSumPick = useCallback((key: string, cents: number) => {
    setSumPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, cents);
      return next;
    });
  }, []);
  // A picked value that gets edited keeps the sum current.
  const refreshSumPick = useCallback((key: string, cents: number) => {
    setSumPicks((prev) => (prev.has(key) && prev.get(key) !== cents ? new Map(prev).set(key, cents) : prev));
  }, []);
  const sumTotal = [...sumPicks.values()].reduce((s, c) => s + c, 0);
  const closePopup = () => {
    setEditingId(null);
    setSumMode(false);
    setSumPicks(new Map());
    onToggle();
  };

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
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header */}
      {/* Full-row click target — tapping anywhere on the tile (label OR
          amount) opens the section's popup. The Debt/Loan Page link stops
          propagation so it navigates instead of also opening. */}
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
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
            className="shrink-0 -rotate-90 text-muted"
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

      {open ? (
        <ModalShell
          title={section.label}
          onClose={closePopup}
          className="sm:max-w-5xl"
          headerExtra={
            sumPicks.size > 0 ? (
              <div className="flex items-center gap-1.5 whitespace-nowrap sm:gap-2">
                <span className="text-xs text-muted">
                  Sum<span className="hidden sm:inline"> of {sumPicks.size}</span>
                </span>
                <span className="text-base font-bold tabular-nums">{formatMoney(sumTotal, currency)}</span>
                <button
                  type="button"
                  onClick={() => setSumPicks(new Map())}
                  className="rounded-md px-1.5 py-1 text-xs font-medium sm:px-2 text-muted ring-1 ring-line transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                >
                  Clear
                </button>
              </div>
            ) : null
          }
          headerActions={
          <button
            type="button"
            aria-pressed={sumMode}
            onClick={() => setSumMode((v) => !v)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ring-1 transition ${
              sumMode
                ? "bg-foreground text-surface ring-foreground hover:bg-foreground/80"
                : "bg-surface text-foreground ring-black/10 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/10"
            }`}
          >
            {sumMode ? "Done adding up" : "Add up values"}
          </button>
          }
        >
        <SumSelectContext.Provider value={{ mode: sumMode, picks: sumPicks, toggle: toggleSumPick, refresh: refreshSumPick }}>
        {/* The sheet sits flush with the bottom of the phone, so the last row
            would otherwise sit under the home indicator. */}
        <div className="@container pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {reorderError ? (
          <p className="px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
        ) : null}
        <div>
          {localAccounts.length > 0 || extraDebts.length > 0 ? (
            localAccounts.length === 0 && extraDebts.length > 0 ? (
              <div className={`grid ${DEBT_ROW_GRID} items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted`}>
                <span />
                {historyMonths.map((m, i) => (
                  <span key={m} className={`text-right ${monthHeadTier(i)}`}>
                    {monthAbbr(m)}
                  </span>
                ))}
              </div>
            ) : (
              <div className={`grid ${ROW_GRID} items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted`}>
                {headerBadge ? (
                  <span className="col-span-3 truncate text-[10px] font-medium uppercase tracking-wide text-muted">{headerBadge}</span>
                ) : (
                  <>
                    <span />
                    <span />
                    <span />
                  </>
                )}
                {historyMonths.map((m, i) => (
                  <span
                    key={m}
                    className={`justify-self-stretch text-right ${monthHeadTier(i)}`}
                  >
                    {monthAbbr(m)}
                  </span>
                ))}
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
                  className={`grid ${DEBT_ROW_GRID} items-center gap-1.5 px-4 py-1.5`}
                >
                  <span className="w-full min-w-0 truncate text-sm text-foreground">{d.name}</span>
                  {/* Same as account rows: each column reads the snapshot for
                      whichever month the header is currently showing. */}
                  <SumCell
                    pickKey={`d:${d.subcategoryId}:${historyMonths[0]}`}
                    cents={d.balancesByMonth?.[historyMonths[0]] ?? d.balanceCents}
                  >
                    <span className="w-full text-right text-sm font-semibold tabular-nums text-negative">
                      {formatMoney(d.balancesByMonth?.[historyMonths[0]] ?? d.balanceCents, currency)}
                    </span>
                  </SumCell>
                  {historyMonths.slice(1).map((m, idx) => {
                    const v = d.balancesByMonth?.[m] ?? null;
                    return (
                      <div key={m} className={monthTier(idx + 1)}>
                        <SumCell pickKey={`d:${d.subcategoryId}:${m}`} cents={v}>
                        <span className="flex w-full justify-end">
                          {v != null ? (
                            <span className="inline-flex items-center gap-0 font-semibold tabular-nums text-negative">
                              <span className="text-xs text-muted">{currencySymbol(currency)}</span>
                              <span className="text-sm">{centsToGroupedDisplay(v)}</span>
                            </span>
                          ) : <span className="text-sm text-muted">—</span>}
                        </span>
                        </SumCell>
                      </div>
                    );
                  })}
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
        </div>
        </SumSelectContext.Provider>
        </ModalShell>
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
  historyMonths: string[];
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
      <div className={`grid ${ROW_GRID} items-center gap-1.5 px-4 py-1.5`}>
        <GripHandle onMouseDown={onDragStart} />
        {allowBuckets ? (
          <button
            type="button"
            onClick={onToggleBuckets}
            aria-label={bucketsOpen ? "Hide buckets" : "Show buckets"}
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
          {account.ownership === "joint" ? (
            <EditPill onClick={onToggleEdit} className="hidden bg-black/5 text-muted hover:ring-muted @[560px]:inline-flex dark:bg-white/10">
              Joint
            </EditPill>
          ) : null}
          {section.key === "banking" && account.bankGroup ? (
            <EditPill
              onClick={onToggleEdit}
              className={`${account.bankGroup === "savings" ? "bg-positive/15 text-positive hover:ring-positive" : "bg-black/5 text-muted hover:ring-muted dark:bg-white/10"}`}
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
            // Always visible: the only signal on the row that this account is
            // split into buckets. It used to be @[560px]-only text, which the
            // half-width section cards never reached, so no account ever
            // showed it.
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
              {bucketCount} {bucketCount === 1 ? "bucket" : "buckets"}
            </span>
          ) : null}
          {maskAccountNumber(account.accountNumber) ? <span className="hidden shrink-0 text-[11px] text-muted @[560px]:inline">{maskAccountNumber(account.accountNumber)}</span> : null}
          {!account.active ? <span className="shrink-0 text-[11px] text-muted">archived</span> : null}
        </div>

        {allowBuckets && bucketCount > 0 ? (
          <>
            <SumCell pickKey={`a:${account.id}:${historyMonths[0]}`} cents={balanceFor(account, 0) ?? account.balanceCents}>
              <DerivedBalance balanceCents={balanceFor(account, 0) ?? account.balanceCents} currency={currency} />
            </SumCell>
            {historyMonths.slice(1).map((m, idx) => (
              <div key={m} className={monthTier(idx + 1)}>
                <SumCell pickKey={`a:${account.id}:${m}`} cents={balanceFor(account, idx + 1)}>
                  <DerivedBalance
                    balanceCents={balanceFor(account, idx + 1) ?? 0}
                    currency={currency}
                    muted={balanceFor(account, idx + 1) == null}
                  />
                </SumCell>
              </div>
            ))}
          </>
        ) : (
          <>
            <SumCell
              pickKey={`a:${account.id}:${historyMonths[0]}`}
              cents={isPastPeriod ? balanceFor(account, 0) : account.balanceCents}
            >
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
            </SumCell>
            {historyMonths.slice(1).map((m, idx) => (
              <div key={m} className={monthTier(idx + 1)}>
                <SumCell pickKey={`a:${account.id}:${m}`} cents={balanceFor(account, idx + 1)}>
                  <HistoricBalanceInput
                    accountId={account.id}
                    month={m}
                    balanceCents={balanceFor(account, idx + 1)}
                    currency={currency}
                    liability={section.liability}
                  />
                </SumCell>
              </div>
            ))}
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
  historyMonths: string[];
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
    <div className="border-t border-line bg-background/40 px-4 py-1">
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
              accountKind={account.kind}
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
  accountKind,
  currency,
  historyMonths,
  isPastPeriod,
  onDragStart,
  isDragOver,
}: {
  bucket: BucketData;
  accountKind: string;
  currency: string;
  historyMonths: string[];
  isPastPeriod: boolean;
  onDragStart: () => void;
  isDragOver: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // All three columns read the month they're actually headed with. They used
  // to use prevMonthCents/prev2MonthCents, which are fixed to the month before
  // *today* — so selecting an earlier period moved the column headings but
  // left the old months' figures underneath them.
  const cellFor = (month: string): number | null => bucket.balancesByMonth[month] ?? null;

  return (
    <li
      data-drop-key={`bucket:${bucket.id}`}
      className={`group relative ${
        isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""
      }`}
    >
      <div
        className={`grid h-7 items-center gap-1.5 ${ROW_GRID}`}
      >
      <GripHandle onMouseDown={onDragStart} size="sm" />
      {/* Empty cell under the account's expand chevron — the bucket grid is
          the account grid, so the money columns line up between the two. */}
      <span />
      {/* No per-bucket tax select: the treatment is set once on the account
          (its Type pill in the row header shows it), and resolveTaxTreatment
          reads the bucket's NAME, so a bucket called "Roth" still bands
          correctly on /invest without a control on every row. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          className="min-w-0 truncate rounded-md px-1 py-0 text-left text-sm transition hover:bg-brand-soft/40"
        >
          {bucket.name}
        </button>
      </div>
      <SumCell
        pickKey={`b:${bucket.id}:${historyMonths[0]}`}
        cents={isPastPeriod ? cellFor(historyMonths[0]) : bucket.balanceCents}
      >
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
      </SumCell>
      {historyMonths.slice(1).map((m, idx) => (
        <div key={m} className={monthTier(idx + 1)}>
          <SumCell pickKey={`b:${bucket.id}:${m}`} cents={cellFor(m)}>
            <HistoricBucketBalanceInput
              bucketId={bucket.id}
              month={m}
              balanceCents={cellFor(m)}
              currency={currency}
            />
          </SumCell>
        </div>
      ))}
      </div>
      {editing ? (
        <BucketEditPanel
          bucket={bucket}
          accountKind={accountKind}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

// Rename / delete for one bucket, opened by clicking the bucket's name.
//
// This replaces a blur-to-save name input plus a hover-only ✕. Both were
// problems: the ✕ was absolutely positioned and collided with the row once
// bucket rows could wrap to two lines, it never appeared on touch at all
// (there is no hover on a phone), and a one-click delete sat permanently
// beside an editable field. An explicit panel gives rename, Cancel and a
// confirmed Delete the same shape the account rows already use.
function BucketEditPanel({
  bucket,
  accountKind,
  onDone,
}: {
  bucket: BucketData;
  accountKind: string;
  onDone: () => void;
}) {
  // Holder and retirement type only mean something on an investment account —
  // a savings bucket under Banking is never a Roth IRA, and offering the
  // choice there just invites a wrong answer. updateBucket only writes
  // retirement_kind when the field is present, so leaving it out preserves
  // whatever is already stored.
  const isInvestment = accountKind === "investment";
  const [savePending, startSave] = useTransition();
  const [delPending, startDel] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="border-t border-line/60 bg-background/60 px-1 py-2">
      <form
        action={(fd) =>
          startSave(async () => {
            await updateBucket(fd);
            onDone();
          })
        }
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="id" value={bucket.id} />
        <input
          name="name"
          defaultValue={bucket.name}
          autoFocus
          aria-label="Bucket name"
          // Holder and retirement type joined this row, and three fields
          // sharing one line clipped the name to a few characters. The name
          // takes the full width and the other two wrap beneath it.
          className="w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand @[420px]:w-auto @[420px]:flex-1 @[420px]:basis-48"
        />
        {/* Whose money this bucket is. IRA limits are per person and one
            brokerage account routinely holds a Roth for each spouse, so
            without this the cap card can only fall back to the account's
            holder and would merge two people's separate allowances. */}
        {isInvestment ? (
          <>
            <input
              name="holder"
              defaultValue={bucket.holder ?? ""}
              aria-label="Bucket holder"
              placeholder="Holder (e.g. Victor)"
              className="w-32 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <RetirementKindSelect name="retirementKind" value={bucket.retirementKind} />
          </>
        ) : null}
        <button
          type="submit"
          disabled={savePending}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {savePending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground"
        >
          Cancel
        </button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {confirmDelete ? (
          <>
            <span className="text-xs text-muted">
              Delete &ldquo;{bucket.name}&rdquo;? Its balance leaves this account&rsquo;s total.
            </span>
            <form action={(fd) => startDel(() => deleteBucket(fd))}>
              <input type="hidden" name="id" value={bucket.id} />
              <button
                type="submit"
                disabled={delPending}
                className="rounded-md bg-negative px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {delPending ? "Deleting…" : "Yes, delete"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition hover:text-foreground"
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/10"
          >
            Delete bucket
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * An amount input exactly as wide as its own text, so the "$" beside it never
 * floats away from the digits.
 *
 * Sizing it in `ch` was close but never right: CSS `1ch` is the width of "0"
 * in the default figures (10.08px here) while these boxes render
 * `tabular-nums` at 9.77px, and "," / "." are under half a digit. On a
 * right-aligned value every bit of that slack pooled on the LEFT — precisely
 * where the "$" sits. An invisible sizer holding the same string measures the
 * real thing instead of estimating it.
 */
function AutoWidthAmountInput({
  sizeClass,
  className,
  defaultValue,
  placeholder,
  onInput,
  ...rest
}: { sizeClass: string } & React.ComponentProps<"input">) {
  const sizerRef = useRef<HTMLSpanElement>(null);
  const initial = String(defaultValue ?? "");

  return (
    // The sizer sits in normal flow and sets the width; the input is laid over
    // it. A grid/flex stack instead lets the input's intrinsic `size` (20
    // characters) win the track, which is what pushed the "$" away again.
    <span className="relative inline-block max-w-full flex-none">
      <span
        ref={sizerRef}
        aria-hidden
        className={`invisible block whitespace-pre ${sizeClass}`}
      >
        {initial || placeholder || ""}
      </span>
      <input
        {...rest}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onInput={(e) => {
          if (sizerRef.current) {
            sizerRef.current.textContent = e.currentTarget.value || placeholder || "";
          }
          onInput?.(e);
        }}
        size={1}
        className={`absolute inset-0 h-full w-full min-w-0 ${sizeClass} ${className ?? ""}`}
      />
    </span>
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
      <AutoWidthAmountInput
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        sizeClass="py-0 text-right text-sm tabular-nums"
        className={`rounded-md bg-transparent px-0 transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
      <AutoWidthAmountInput
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="—"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        sizeClass="py-0.5 text-right text-sm tabular-nums"
        className={`rounded-md bg-transparent px-0 transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
        className="justify-self-end inline-flex items-center gap-0 py-1"
      >
        <span className="text-sm">—</span>
      </div>
    );
  }
  return (
    <div
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
      <AutoWidthAmountInput
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="—"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          // Empty stays empty — don't create a $0.00 snapshot from nothing.
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        sizeClass="py-1 text-right text-[0.9375rem] tabular-nums"
        className={`rounded-md bg-transparent px-0 transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
        <AutoWidthAmountInput
          // Remount (reset to the server value) whenever the saved amount changes.
          key={initial}
          name="balance"
          // Keep the field exactly as wide as its value so the currency symbol
          // stays attached instead of sitting at the far side of empty space.
          type="text"
          inputMode="decimal"
          defaultValue={initial}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
          }}
          sizeClass="py-1 text-right text-[0.9375rem] tabular-nums"
          className={`rounded-md bg-transparent px-0 transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
          <>
            {section.subtypeOptions ? (
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Type
                <FixedSubtypeSelect
                  name="subtype"
                  options={section.subtypeOptions}
                  value={null}
                  className="mt-1 w-full font-normal normal-case tracking-normal text-foreground"
                />
              </label>
            ) : usesSubtypeList(section.key) ? (
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Type
                <SubtypeSelect name="subtype" value={null} className="mt-1 w-full font-normal normal-case tracking-normal text-foreground" />
              </label>
            ) : (
              <LabeledInput label="Type" name="subtype" placeholder="e.g. AMEX, Chase" />
            )}
            {/* Tax treatment and contribution limits are investment questions —
                a house has neither. */}
            {section.key === "property" ? null : (
            <>
            {/* Set at creation rather than guessed from the name later — this
                is the value "How it's taxed" on /invest bands the account by. */}
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Tax treatment
              <select
                name="taxTreatment"
                defaultValue="taxable"
                className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm font-normal normal-case tracking-normal text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {TAX_TREATMENTS.map((t) => (
                  <option key={t} value={t}>
                    {TAX_LABEL_SHORT[t]}
                  </option>
                ))}
              </select>
            </label>
            {/* Asked at creation so the contribution-cap card never has to
                guess. Traditional and Roth are both offered because that is
                what the user knows about the account — they happen to share
                one annual limit, which the hint says rather than hiding. */}
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Retirement type
              <RetirementKindSelect
                name="retirementKind"
                value={null}
                className="mt-1 w-full font-normal normal-case tracking-normal text-foreground"
              />
              <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">
                Sets which IRS contribution limit applies. Traditional and Roth IRAs share one
                limit per person.
              </span>
            </label>
            </>
            )}
          </>
        ) : null}
        <LabeledInput
          label={section.key === "property" ? "Property name" : "Account name"}
          name="name"
          placeholder={section.key === "loans" ? "e.g. Home Mortgage" : section.key === "property" ? "e.g. 123 Main St" : "e.g. Fidelity Roth IRA"}
          required
          autoFocus
          onChange={() => setError(null)}
        />
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
          label={section.key === "loans" ? "Current balance owed" : section.key === "property" ? "Current value" : "Current balance"}
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
    ["banking", "investments", "property", "credit", "loans", "kids"].includes(section.key),
  );
  const section = choices.find((choice) => choice.key === sectionKey) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-0 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 id="add-account-title" className="text-lg font-bold">
              {section ? `Add ${{ banking: "banking account", investments: "investment", property: "property", credit: "credit card details", loans: "debt", kids: "Kids Funding account" }[section.key] ?? "account"}` : "Add account"}
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
                    {choice.key === "property" && "A home, rental, or land — its value is what a mortgage nets against."}
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
        {/* Row 1: name, holder, account reference — one equal third each, so
            they grow together with the card instead of the two fixed-width
            fields pushing "Account reference" past its edge. Stacked on a
            narrow card, where three across would be unreadable. */}
        <div className="grid grid-cols-1 items-center gap-2 @[420px]:grid-cols-3">
          <input
            name="name"
            defaultValue={account.name}
            required
            className="w-full min-w-0 rounded-md bg-surface px-3 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            name="holder"
            defaultValue={account.holder ?? ""}
            placeholder="Holder"
            className="w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            name="accountNumber"
            defaultValue={account.accountNumber ?? ""}
            placeholder="Account reference"
            className="w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {/* Row 2: ownership, kind/subtype, active, save */}
        <div className="flex flex-wrap items-center gap-2">
          <select name="ownership" defaultValue={account.ownership} className="rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="sole">Sole</option>
            <option value="joint">Joint</option>
          </select>
          {section.offerSubtype ? (
            section.subtypeOptions ? (
              <FixedSubtypeSelect
                name="subtype"
                options={section.subtypeOptions}
                value={account.subtype}
                className="min-w-[8rem] flex-1"
              />
            ) : usesSubtypeList(section.key) ? (
              <SubtypeSelect name="subtype" value={account.subtype} className="min-w-[8rem] flex-1" />
            ) : (
              <input
                name="subtype"
                defaultValue={account.subtype ?? ""}
                placeholder="Type… (e.g. Roth IRA, 529)"
                className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            )
          ) : null}
          {(section.key === "investments" || section.key === "kids") ? (
            <>
              <TaxTreatmentSelect
                name="taxTreatment"
                value={account.taxTreatment}
                className="!w-auto !py-1.5 !text-sm !text-foreground"
              />
              <RetirementKindSelect name="retirementKind" value={account.retirementKind} />
            </>
          ) : null}
          {section.key === "banking" ? (
            <select
              name="bankGroup"
              defaultValue={account.bankGroup ?? "spending"}
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
  // No "Click to edit" tooltip: hover-only hints don't exist on a phone, and
  // the pill's own hover ring already says it is a control.
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold hover:ring-1 ${className}`}
    >
      {children}
    </button>
  );
}

