"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
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
  recalculateBalance,
  updateBucket,
  updateBucketBalance,
  updateBucketBankGroup,
  upsertCardDetails,
} from "./actions";
import { setAccountSnapshot, setBucketSnapshot } from "../networth/actions";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-07-01" -> "Jul"
function monthAbbr(firstOfMonth: string): string {
  return MONTH_ABBR[parseInt(firstOfMonth.slice(5, 7), 10) - 1] ?? "";
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
};

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  subtype: string | null; // free-text label, e.g. "Roth IRA", "Trump Account", "UTMA"
  holder: string | null;
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
  // Sub-kind choices offered by the add form (label per kind). Omit for a
  // single fixed kind (e.g. Kids Funding always creates a "checking" row —
  // the kind doesn't matter once is_kids_account routes it here).
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
    match: (a) => !a.isKidsAccount && (a.kind === "checking" || a.kind === "savings_bucket"),
    kindLabels: { checking: "Checking", savings_bucket: "Savings" },
  },
  {
    key: "investments",
    label: "Investments & Brokerages",
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
    label: "Loans",
    dot: "bg-accent",
    liability: true,
    match: (a) => a.kind === "debt_loan",
    kindLabels: { debt_loan: "Loan" },
  },
  // Kids Funding sits last — it's the kids' money, excluded from Assets / Net
  // Worth, so it reads as a footnote beneath the household's own accounts.
  {
    key: "kids",
    label: "Kids Funding",
    dot: "bg-violet-500",
    liability: false,
    match: (a) => a.isKidsAccount,
    kindLabels: {},
    fixedKind: "checking",
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
  const active = accounts.filter((a) => a.active);
  const isLiability = (kind: string) => kind === "credit_card" || kind === "debt_loan";

  const assets = active
    .filter((a) => !isLiability(a.kind) && !a.isKidsAccount)
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const debtsTotal = budgetDebts.reduce((sum, d) => sum + d.balanceCents, 0);
  const net = assets - debtsTotal;

  const assetSections = SECTIONS.filter((s) => !s.liability && !s.creditCard && !s.kidsGroup);
  const kidsSections = SECTIONS.filter((s) => s.kidsGroup);
  const creditSections = SECTIONS.filter((s) => s.creditCard);
  const legacySections = SECTIONS.filter(
    (s) => s.liability && accounts.some((a) => s.match(a)),
  );
  const excludedSections = [...kidsSections, ...creditSections];

  const sectionKeys = [
    "debts",
    ...assetSections.map((s) => s.key),
    ...excludedSections.map((s) => s.key),
    ...legacySections.map((s) => s.key),
  ];
  const [collapsed, setCollapsed] = useSessionCollapse("accounts-sections-open", () =>
    Object.fromEntries(["debts", ...SECTIONS.map((s) => s.key)].map((k) => [k, true])),
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Accounts</h1>
        <p className="text-sm text-muted">
          Your asset accounts feed Net Worth. Debts live in Budget — enter each once, use it everywhere.
        </p>
      </div>

      {/* Net worth summary */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryStat label="Assets" value={assets} currency={currency} tone="text-positive" />
        <SummaryStat label="Debts" value={debtsTotal} currency={currency} tone="text-negative" />
        <SummaryStat
          label="Net worth"
          value={net}
          currency={currency}
          tone={net >= 0 ? "text-foreground" : "text-negative"}
        />
      </div>

      <div className="flex justify-end">
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

        <BudgetDebtsSection
          debts={budgetDebts}
          currency={currency}
          open={!collapsed.debts}
          onToggle={() => toggleSection("debts")}
        />

        {legacySections.map((section) => (
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
            legacy
          />
        ))}
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
  const [adding, setAdding] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
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

  // Group cards by holder (Vic / Johana / …). Cards without a holder land in
  // an "Unassigned" bucket. Sub-groups only render when there's >1 group.
  const holderGroups = groupByHolder(accounts);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
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
          <span className="text-sm font-semibold tabular-nums text-negative">
            {formatMoney(totalOwed, currency)} owed
          </span>
        ) : null}
      </div>

      {/* Summary strip — only on the main section, hidden when empty */}
      {open && isMain && (feesAll > 0 || totalOwed > 0) ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          {totalOwed !== 0 ? (
            <span>
              <span className="font-semibold">Owed:</span>{" "}
              <span className={`font-semibold tabular-nums ${totalOwed > 0 ? "text-negative" : "text-positive"}`}>
                {formatMoney(totalOwed, currency)}
              </span>{" "}
              across {accounts.length} card{accounts.length !== 1 ? "s" : ""}
            </span>
          ) : null}
          {feesAll > 0 ? (
            <span>
              <span className="font-semibold">Annual fees:</span>{" "}
              <span className="font-semibold text-foreground">{formatMoney(feesPaid, currency)}</span> paid
              {feesWaived > 0 ? (
                <>
                  {" · "}
                  <span className="font-semibold text-positive">{formatMoney(feesWaived, currency)}</span> waived
                </>
              ) : null}
              {" · "}
              <span className="font-semibold text-foreground">{formatMoney(feesAll, currency)}</span> if all applied
            </span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-line">
          {accounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">
              {isArchived ? "No archived cards." : "No credit cards yet — add one below."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((a) => (
                <CreditCardPanel
                  key={a.id}
                  card={a}
                  currency={currency}
                  nonCardAccounts={nonCardAccounts}
                  allBuckets={allBuckets}
                  isArchived={isArchived}
                  defaultEditing={a.id === justAddedId}
                  onEditingOpened={() => setJustAddedId(null)}
                />
              ))}
            </ul>
          )}

          {!isArchived && (
            adding ? (
              <AddAccountForm
                section={section}
                onDone={(newId) => {
                  setAdding(false);
                  if (newId) setJustAddedId(newId);
                }}
              />
            ) : (
              <div className="border-t border-line px-4 py-2">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="text-sm font-medium text-brand hover:text-brand-strong"
                >
                  + Add credit card
                </button>
              </div>
            )
          )}
        </div>
      ) : null}
    </section>
  );
}

function groupByHolder(cards: AccountData[]): { holder: string; cards: AccountData[] }[] {
  const map = new Map<string, AccountData[]>();
  const order: string[] = [];
  for (const c of cards) {
    const h = c.holder?.trim() || "Unassigned";
    if (!map.has(h)) { order.push(h); map.set(h, []); }
    map.get(h)!.push(c);
  }
  return order.map((h) => ({ holder: h, cards: map.get(h)! }));
}

function HolderGroup({
  holder,
  cards,
  currency,
  nonCardAccounts,
  allBuckets,
  isArchived,
  justAddedId,
  onJustAddedConsumed,
}: {
  holder: string;
  cards: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  isArchived: boolean;
  justAddedId?: string | null;
  onJustAddedConsumed?: () => void;
}) {
  const [open, setOpen] = useSessionCollapse(`accounts-cc-holder-${holder}`, () => ({ [holder]: true }));
  const isOpen = open[holder] ?? true;
  const toggle = () => setOpen((s) => ({ ...s, [holder]: !isOpen }));
  const holderOwed = cards.reduce((s, c) => s + (c.owedCents ?? 0), 0);

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 bg-background/40 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:bg-brand-soft/25"
        aria-expanded={isOpen}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span>{holder}</span>
        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-white/10">
          {cards.length} card{cards.length !== 1 ? "s" : ""}
        </span>
        {holderOwed > 0 ? (
          <span className="ml-auto text-[11px] font-semibold tabular-nums text-negative normal-case tracking-normal">
            {formatMoney(holderOwed, currency)} owed
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <ul className="divide-y divide-line">
          {cards.map((c) => (
            <CreditCardPanel
              key={c.id}
              card={c}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={allBuckets}
              isArchived={isArchived}
              defaultEditing={c.id === justAddedId}
              onEditingOpened={onJustAddedConsumed}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
  defaultEditing = false,
  onEditingOpened,
}: {
  card: AccountData;
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  isArchived: boolean;
  defaultEditing?: boolean;
  onEditingOpened?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultEditing);
  const [editing, setEditing] = useState(defaultEditing);
  useEffect(() => {
    if (defaultEditing) {
      setExpanded(true);
      setEditing(true);
      onEditingOpened?.();
    }
    // Fires only when a new card was just added and this panel is its
    // freshly-mounted target — parent immediately clears the marker so this
    // won't re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEditing]);
  const [paying, setPaying] = useState(false);
  const [closePending, startClose] = useTransition();
  const [reopenPending, startReopen] = useTransition();

  const d = card.cardDetails;
  const owed = card.owedCents ?? 0;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = monthNames[new Date().getMonth()];
  const monthSpend = card.monthSpendCents ?? 0;

  const bank = d?.bank ?? card.subtype ?? null;

  return (
    <li className={expanded ? "bg-brand-soft/15" : "hover:bg-brand-soft/25"}>
      {/* Collapsed row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
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
          </span>
          {(card.dateOpened || (card.annualFeeCents && !card.feeWaived) || (d && (d.freeNightCreditCents || d.freeNightPointsLimit || d.freeNightExpiresOn || d.benefitUsedOn))) ? (
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {card.dateOpened ? <>Opened {card.dateOpened}</> : null}
              {card.annualFeeCents && !card.feeWaived ? <> · <span className="font-medium text-amber-600 dark:text-amber-400">{formatMoney(card.annualFeeCents, currency)}/yr fee</span></> : null}
              {d?.freeNightCreditCents ? <> · Free-Night Credit: {formatMoney(d.freeNightCreditCents, currency)}</> : null}
              {d?.freeNightPointsLimit ? <> · Free Night: {d.freeNightPointsLimit.toLocaleString()} pts</> : null}
              {d?.freeNightExpiresOn ? <> · Free-Night Expires: {d.freeNightExpiresOn}</> : null}
              {d?.benefitUsedOn ? <> · Used/Scheduled: {d.benefitUsedOn}</> : null}
            </p>
          ) : null}
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

      {expanded ? (
        <div className="space-y-3 border-t border-line bg-background/40 px-4 py-3">
          {/* Two-column detail grid */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <DetailRow label="Bank" value={bank} />
            <DetailRow label="Points" value={d && d.currentPoints > 0 ? d.currentPoints.toLocaleString() : "—"} />
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
                    Pay Card
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
        className="space-y-3"
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
          <div className="sm:col-span-2">
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Remarks</label>
            <input name="remarks" defaultValue={d?.remarks ?? ""} placeholder="" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
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

        <div className="flex items-center justify-between gap-2 pt-1">
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
  ...inputProps
}: { label: string; prefix?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
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
          <LabeledInput label="Amount" name="amount" type="number" step="0.01" min="0" required autoFocus />
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

// Read-only mirror of the Budget Debt group so you see debts alongside assets.
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

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="grid grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-negative" />
          <span className="font-semibold">Debts</span>
          <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand">
            from Budget
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
          {debts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">
              No debts yet — add credit cards and loans in the Budget Debt group.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {debts.map((d) => (
                <li
                  key={d.subcategoryId}
                  className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-2 px-4 py-1.5"
                >
                  <span className="truncate text-sm">{d.name}</span>
                  <span className={`text-right text-sm tabular-nums ${d.balanceCents > 0 ? "text-negative" : "text-muted"}`}>
                    {formatMoney(d.balanceCents, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2">
            <Link href="/budget" className="text-sm font-medium text-brand hover:text-brand-strong">
              Manage debts in Budget →
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>
        {formatMoney(value, currency)}
      </p>
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
  const [adding, setAdding] = useState(false);
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
      <div className="grid grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
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
          <span className="font-semibold">{section.label}</span>
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
            <div className="grid grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7.5rem_7.5rem_7.5rem] items-center gap-1.5 border-b border-line/60 bg-background/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <span />
              <span />
              <span />
              <span className="text-right">{monthAbbr(historyMonths[0])}</span>
              <span className="text-right">{monthAbbr(historyMonths[1])}</span>
              <span className="text-right">{monthAbbr(historyMonths[2])}</span>
            </div>
          ) : null}
          {localAccounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">No accounts yet — add one below.</p>
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
          ) : adding ? (
            <AddAccountForm section={section} onDone={() => setAdding(false)} />
          ) : (
            <div className="border-t border-line px-4 py-2">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="text-sm font-medium text-brand hover:text-brand-strong"
              >
                + Add account
              </button>
            </div>
          )}
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
      <div className="grid grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_7.5rem_7.5rem_7.5rem] items-center gap-1.5 px-4 py-1.5">
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
          className="group/name relative inline-flex w-fit min-w-0 max-w-full items-baseline justify-self-start gap-2 text-left"
        >
          <span
            role="tooltip"
            className="pointer-events-none absolute -top-6 left-0 z-10 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity duration-75 group-hover/name:opacity-100"
          >
            Click to edit
          </span>
          <span className={`truncate text-sm ${account.active ? "text-foreground" : "text-muted line-through"}`}>
            {account.name}
          </span>
          {account.holder ? (
            <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              {account.holder}
            </span>
          ) : null}
          {/* With buckets, each one carries its own Checking/Savings tag
              below (an account can hold both) — a single account-level tag
              here would misrepresent a mixed account, so it only shows when
              there's nothing underneath to tag instead. */}
          {section.key === "banking" && account.bankGroup && bucketCount === 0 ? (
            <span
              title="Net Worth splits Savings from everyday Checking"
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
          {account.isKidsAccount ? (
            <span
              title="Tracked here, but not counted in Assets or Net Worth"
              className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted dark:bg-white/10"
            >
              not in net worth
            </span>
          ) : null}
          {showKind ? <span className="shrink-0 text-[11px] text-muted">{kindLabel}</span> : null}
          {bucketCount > 0 ? (
            <span className="shrink-0 text-[11px] text-muted">
              {bucketCount} {bucketCount === 1 ? "bucket" : "buckets"}
            </span>
          ) : null}
          {!account.active ? <span className="shrink-0 text-[11px] text-muted">archived</span> : null}
        </button>

        {allowBuckets && bucketCount > 0 ? (
          <>
            <DerivedBalance balanceCents={account.balanceCents} currency={currency} />
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
          </>
        ) : (
          <>
            <BalanceInput
              id={account.id}
              balanceCents={account.balanceCents}
              currency={currency}
              liability={section.liability}
              kind={account.kind}
            />
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
          </>
        )}
      </div>

      {allowBuckets && bucketsOpen ? (
        <BucketDrawer
          account={account}
          currency={currency}
          historyMonths={historyMonths}
          showBankGroup={section.key === "banking"}
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
  showBankGroup,
}: {
  account: AccountData;
  currency: string;
  historyMonths: [string, string, string];
  showBankGroup: boolean;
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
    <div className="border-t border-line bg-background/40 pl-11 pr-4 py-2">
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
              showBankGroup={showBankGroup}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <AddBucketForm accountId={account.id} onDone={() => setAdding(false)} showBankGroup={showBankGroup} />
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
  showBankGroup,
}: {
  bucket: BucketData;
  currency: string;
  historyMonths: [string, string, string];
  onDragStart: () => void;
  isDragOver: boolean;
  showBankGroup: boolean;
}) {
  const [delPending, startDel] = useTransition();

  return (
    <li
      data-drop-key={`bucket:${bucket.id}`}
      className={`group grid items-center gap-1.5 py-1 ${
        isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""
      } ${
        showBankGroup
          ? "grid-cols-[1.75rem_minmax(0,1fr)_5.5rem_7.5rem_7.5rem_7.5rem_1.25rem]"
          : "grid-cols-[1.75rem_minmax(0,1fr)_7.5rem_7.5rem_7.5rem_1.25rem]"
      }`}
    >
      <GripHandle onMouseDown={onDragStart} size="sm" />
      <BucketNameInput id={bucket.id} name={bucket.name} />
      {showBankGroup ? (
        <BucketBankGroupSelect id={bucket.id} bankGroup={bucket.bankGroup} />
      ) : null}
      <BucketBalanceInput id={bucket.id} balanceCents={bucket.balanceCents} currency={currency} />
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
      <form
        action={(fd) => startDel(() => deleteBucket(fd))}
        className="justify-self-end"
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

// Compact Checking/Savings picker for one bucket — saves immediately on
// change, same as the balance/name fields, no separate edit mode needed.
function BucketBankGroupSelect({
  id,
  bankGroup,
}: {
  id: string;
  bankGroup: "savings" | "spending" | null;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={(fd) => start(() => updateBucketBankGroup(fd))}>
      <input type="hidden" name="id" value={id} />
      <select
        key={bankGroup ?? ""}
        name="bankGroup"
        defaultValue={bankGroup ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        title="Checking or Savings — Net Worth splits on this"
        className={`w-full min-w-0 rounded-md bg-transparent px-1 py-0.5 text-[11px] font-semibold uppercase transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        } ${bankGroup === "savings" ? "text-positive" : "text-muted"}`}
      >
        <option value="">—</option>
        <option value="spending">Checking</option>
        <option value="savings">Savings</option>
      </select>
    </form>
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
        className={`w-full min-w-0 rounded-md bg-transparent px-1 py-0.5 text-sm transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
      className="flex items-center justify-end gap-0.5 justify-self-end"
    >
      <input type="hidden" name="id" value={id} />
      <span className="pointer-events-none text-sm text-muted">{currencySymbol(currency)}</span>
      <input
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        size={Math.max(initial.length, 5) + 2}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent py-0.5 px-1 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
      className="flex items-center justify-end gap-0.5 justify-self-end"
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
        size={Math.max(initial.length, 5) + 2}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent py-0.5 px-1 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

function AddBucketForm({
  accountId,
  onDone,
  showBankGroup,
}: {
  accountId: string;
  onDone: () => void;
  showBankGroup: boolean;
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
        {showBankGroup ? (
          <select
            name="bankGroup"
            defaultValue=""
            title="Checking or Savings — Net Worth splits on this"
            className="rounded-md bg-surface px-2 py-1 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">—</option>
            <option value="spending">Checking</option>
            <option value="savings">Savings</option>
          </select>
        ) : null}
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
        className="flex items-center justify-end gap-0.5 justify-self-end py-1 px-1 text-muted/60"
      >
        <span className="text-sm">—</span>
      </div>
    );
  }
  return (
    <div
      title="Sum of this account's buckets — edit the buckets below to change it"
      className="flex items-center justify-end gap-0.5 justify-self-end py-1 px-1"
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
      className="flex items-center justify-end gap-0.5 justify-self-end"
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
        size={Math.max(initial.length, 5) + 2}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          // Empty stays empty — don't create a $0.00 snapshot from nothing.
          if (v === "" && balanceCents == null) return;
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent py-1 px-1 text-right text-[0.9375rem] tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
  kind,
}: {
  id: string;
  balanceCents: number;
  currency: string;
  liability: boolean;
  kind?: string;
}) {
  const [pending, start] = useTransition();
  const [reconciling, startReconcile] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(balanceCents);
  // Reconcile only for ledger-driven accounts (skip investment — those aren't
  // derived from a transaction ledger).
  const canReconcile = kind !== "investment";

  return (
    <div className="flex items-center gap-1 justify-self-end">
      {canReconcile ? (
        <form
          action={(fd) => startReconcile(() => recalculateBalance(fd))}
          onSubmit={(e) => {
            if (!window.confirm("Rebuild this balance from all transactions on the account? Starting balance is treated as $0; any manual adjustments will be replaced.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={reconciling}
            title="Recalculate balance from transactions (starting from $0)"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-50"
            aria-label="Reconcile from transactions"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={reconciling ? "animate-spin" : ""} aria-hidden>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </form>
      ) : null}
      <form
        ref={formRef}
        action={(fd) => start(() => updateBalance(fd))}
        className="flex items-center justify-end gap-0.5"
      >
        <input type="hidden" name="id" value={id} />
        <span className="pointer-events-none text-sm text-muted">
          {currencySymbol(currency)}
        </span>
        <input
          // Remount (reset to the server value) whenever the saved amount changes.
          key={initial}
          name="balance"
          // type=text (not number) so the `size` attr can shrink the box to fit
          // its content — `size` is ignored on number inputs, which strands the $.
          type="text"
          inputMode="decimal"
          defaultValue={initial}
          size={Math.max(initial.length, 5) + 2}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
          }}
          className={`min-w-0 rounded-md bg-transparent py-1 px-1 text-right text-[0.9375rem] tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
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
  const kindKeys = Object.keys(section.kindLabels);
  const multiKind = kindKeys.length > 1;
  const openEditRef = useRef(false);

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
              else onDone(openEditRef.current ? (result?.id ?? null) : null);
            })
          }
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <input type="hidden" name="kind" value={section.fixedKind ?? kindKeys[0]} />
          <LabeledInput label="Card name" name="name" placeholder="e.g. 1175 Sapphire V" required autoFocus onChange={() => setError(null)} />
          <LabeledInput label="Holder" name="holder" />
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
              onClick={() => { openEditRef.current = false; }}
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
            <span className="ml-auto text-[11px] text-muted">
              Rewards, points, bonus, etc. →{" "}
              <button
                type="submit"
                disabled={pending}
                onClick={() => { openEditRef.current = true; }}
                className="font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-60"
              >
                Add &amp; open Edit details
              </button>
            </span>
          </div>
          {error ? (
            <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p>
          ) : null}
        </form>
      </div>
    );
  }

  return (
    <div className="border-t border-line">
      <form
        action={(fd) =>
          start(async () => {
            const result = await addAccount(fd);
            if (result?.error) setError(result.error);
            else onDone(result?.id ?? null);
          })
        }
        className="flex flex-wrap items-center gap-2 px-4 py-2"
      >
        {multiKind ? (
          <select
            name="kind"
            className="rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {kindKeys.map((k) => (
              <option key={k} value={k}>{section.kindLabels[k]}</option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="kind" value={section.fixedKind ?? kindKeys[0]} />
        )}
        {section.kidsGroup ? <input type="hidden" name="kidsAccount" value="on" /> : null}
        {section.offerSubtype ? (
          <input
            name="subtype"
            placeholder={section.creditCard ? "Bank (e.g. AMEX, Chase)" : "Type… (e.g. Retirement, Roth IRA, 529, Trump Account)"}
            className={`${section.creditCard ? "w-40" : "w-56"} rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand`}
          />
        ) : null}
        <input
          name="name"
          placeholder={section.creditCard ? "Card name…" : "Account name…"}
          required
          autoFocus
          onChange={() => setError(null)}
          className="min-w-0 flex-1 rounded-md bg-background px-3 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          name="holder"
          placeholder="Holder"
          title="Whose account? (e.g. V, J, Joint)"
          className="w-20 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        {section.creditCard ? (
          <>
            <input
              name="annualFee"
              type="number"
              step="0.01"
              placeholder="Annual fee"
              className="w-28 rounded-md bg-background px-2 py-1.5 text-right text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" name="feeWaived" className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
              Waived
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Opened
              <input
                name="dateOpened"
                type="date"
                className="rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
          </>
        ) : (
          <input
            name="balance"
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="Balance"
            className="w-28 rounded-md bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => onDone()}
          className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </form>
      {error ? (
        <p className="px-4 pb-2 text-sm font-medium text-negative">{error}</p>
      ) : null}
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
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="text-xs font-medium text-negative hover:underline"
        >
          Delete account
        </button>
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
