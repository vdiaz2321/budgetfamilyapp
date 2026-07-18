"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import {
  addAccount,
  addBucket,
  deleteAccount,
  deleteBucket,
  reorderAccounts,
  reorderBuckets,
  updateAccount,
  updateBalance,
  updateBucket,
  updateBucketBalance,
  updateBucketBankGroup,
} from "./actions";

export type BucketData = {
  id: string;
  accountId: string;
  name: string;
  balanceCents: number;
  // Its own Checking/Savings tag — accounts with a mix of both (e.g. a
  // "Checking" bucket and a "Savings" bucket under one bank account) no
  // longer have to force the whole account into one type.
  bankGroup: "savings" | "spending" | null;
};

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  subtype: string | null; // free-text label, e.g. "Roth IRA", "Trump Account", "UTMA"
  holder: string | null;
  active: boolean;
  // Kids Funding: tracked here, but always excluded from Assets / Net Worth.
  isKidsAccount: boolean;
  // Banking accounts only: "savings" (long-term pile) vs "spending" (everyday).
  // Splits the Net Worth analytics' Current Savings from Bank Accounts. null =
  // spending. Ignored for investment / kids accounts.
  bankGroup: "savings" | "spending" | null;
  balanceCents: number;
  buckets: BucketData[];
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
  // New accounts in this section are flagged out of net worth.
  kidsGroup?: boolean;
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
    liability: true,
    match: (a) => a.kind === "credit_card",
    kindLabels: { credit_card: "Credit card" },
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
};

export function AccountsBoard({ accounts, budgetDebts, currency }: Props) {
  const active = accounts.filter((a) => a.active);
  const isLiability = (kind: string) => kind === "credit_card" || kind === "debt_loan";

  // Kids Funding is tracked here but excluded from Assets / Net Worth
  // everywhere — it's the kids' money, not the household's.
  const assets = active
    .filter((a) => !isLiability(a.kind) && !a.isKidsAccount)
    .reduce((sum, a) => sum + a.balanceCents, 0);
  // Debts come from the Budget Debt group (single source of truth), not from
  // accounts. Any legacy credit-card/loan accounts are shown for cleanup but
  // NOT counted here (they'd double-count against the Budget debt).
  const debtsTotal = budgetDebts.reduce((sum, d) => sum + d.balanceCents, 0);
  const net = assets - debtsTotal;

  // Asset sections are always shown + editable. Legacy liability sections
  // (credit cards / loans) appear only if such accounts still exist, so you
  // can delete them and move that debt into Budget.
  const assetSections = SECTIONS.filter((s) => !s.liability);
  // The household's own assets (feed Net Worth) vs. Kids Funding, which is
  // tracked but excluded — pulled out so it renders in its own group at the
  // very bottom, past the Debts line, so it reads as clearly separate.
  const ownAssetSections = assetSections.filter((s) => !s.kidsGroup);
  const kidsSections = assetSections.filter((s) => s.kidsGroup);
  const legacySections = SECTIONS.filter(
    (s) => s.liability && accounts.some((a) => s.match(a)),
  );

  // Every section's open/collapsed state, lifted here so one button can
  // expand or collapse them all at once.
  const sectionKeys = ["debts", ...assetSections.map((s) => s.key), ...legacySections.map((s) => s.key)];
  // Start every section collapsed on each visit — open only what you need.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(["debts", ...SECTIONS.map((s) => s.key)].map((k) => [k, true])),
  );
  const allOpen = sectionKeys.every((k) => !collapsed[k]);
  const toggleAll = () =>
    setCollapsed(Object.fromEntries(sectionKeys.map((k) => [k, allOpen])));
  const toggleSection = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Each account's bucket-drawer open/closed state, keyed by account id —
  // survives navigating to another page and back within the same browser
  // session instead of resetting to its default every time this board
  // remounts. See feedback: "Amex Savings keeps staying expanded... when I
  // collapse it when moving to a different page."
  const bucketCountById = new Map(accounts.map((a) => [a.id, a.buckets.length]));
  const [bucketsOpen, setBucketsOpen] = useSessionCollapse("accounts-buckets-open", () =>
    Object.fromEntries(accounts.filter((a) => a.buckets.length > 0).map((a) => [a.id, true])),
  );
  const isBucketsOpen = (id: string) => bucketsOpen[id] ?? (bucketCountById.get(id) ?? 0) > 0;
  const toggleBuckets = (id: string) =>
    setBucketsOpen((c) => ({ ...c, [id]: !isBucketsOpen(id) }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
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
        {ownAssetSections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.match(a))}
            currency={currency}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
            isBucketsOpen={isBucketsOpen}
            onToggleBuckets={toggleBuckets}
          />
        ))}

        {/* Debts, read-only, sourced from the Budget Debt group. */}
        <BudgetDebtsSection
          debts={budgetDebts}
          currency={currency}
          open={!collapsed.debts}
          onToggle={() => toggleSection("debts")}
        />

        {/* Legacy credit-card/loan accounts — kept only so they can be deleted. */}
        {legacySections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.match(a))}
            currency={currency}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
            isBucketsOpen={isBucketsOpen}
            onToggleBuckets={toggleBuckets}
            legacy
          />
        ))}
      </div>

      {/* Kids Funding sits apart, below the household's own accounts and the
          debts line, so it's visually clear this money isn't in Net Worth. */}
      {kidsSections.length > 0 ? (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-3 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Not counted in net worth
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          {kidsSections.map((section) => (
            <AccountSection
              key={section.key}
              section={section}
              accounts={accounts.filter((a) => section.match(a))}
              currency={currency}
              open={!collapsed[section.key]}
              onToggle={() => toggleSection(section.key)}
              isBucketsOpen={isBucketsOpen}
              onToggleBuckets={toggleBuckets}
            />
          ))}
        </div>
      ) : null}
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
  open,
  onToggle,
  isBucketsOpen,
  onToggleBuckets,
  legacy = false,
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
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

  // Collapsing a section while a row's edit form is open shouldn't leave it
  // silently open underneath — close it, so reopening the section shows the
  // normal read view again.
  useEffect(() => {
    if (!open) setEditingId(null);
  }, [open]);

  // Reorder optimistically — reflect the new order the instant you click,
  // instead of waiting on a full round trip to the server. `accounts` still
  // wins once the server responds (revalidated data replaces this local copy).
  const [localAccounts, setLocalAccounts] = useState(accounts);
  useEffect(() => {
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
          onClick={onToggle}
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
      <div className="grid grid-cols-[1.75rem_1.25rem_minmax(0,1fr)_10rem] items-center gap-1.5 px-4 py-1.5">
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
          <DerivedBalance balanceCents={account.balanceCents} currency={currency} />
        ) : (
          <BalanceInput
            id={account.id}
            balanceCents={account.balanceCents}
            currency={currency}
            liability={section.liability}
          />
        )}
      </div>

      {allowBuckets && bucketsOpen ? (
        <BucketDrawer account={account} currency={currency} showBankGroup={section.key === "banking"} />
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
  showBankGroup,
}: {
  account: AccountData;
  currency: string;
  showBankGroup: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();

  // Reorder optimistically, same reasoning as accounts above.
  const [localBuckets, setLocalBuckets] = useState(account.buckets);
  useEffect(() => {
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
  onDragStart,
  isDragOver,
  showBankGroup,
}: {
  bucket: BucketData;
  currency: string;
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
          ? "grid-cols-[1.75rem_minmax(0,1fr)_5.5rem_10rem_1.25rem]"
          : "grid-cols-[1.75rem_minmax(0,1fr)_10rem_1.25rem]"
      }`}
    >
      <GripHandle onMouseDown={onDragStart} size="sm" />
      <BucketNameInput id={bucket.id} name={bucket.name} />
      {showBankGroup ? (
        <BucketBankGroupSelect id={bucket.id} bankGroup={bucket.bankGroup} />
      ) : null}
      <BucketBalanceInput id={bucket.id} balanceCents={bucket.balanceCents} currency={currency} />
      <form
        action={(fd) => startDel(() => deleteBucket(fd))}
        onSubmit={(e) => {
          if (!confirm(`Delete bucket "${bucket.name}"? Its monthly history is removed too.`)) {
            e.preventDefault();
          }
        }}
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
function DerivedBalance({ balanceCents, currency }: { balanceCents: number; currency: string }) {
  return (
    <div
      title="Sum of this account's buckets — edit the buckets below to change it"
      className="flex items-center justify-end gap-0.5 justify-self-end py-1 px-1"
    >
      <span className="text-sm text-muted">{currencySymbol(currency)}</span>
      <span className="text-[0.9375rem] tabular-nums">{centsToDisplay(balanceCents)}</span>
    </div>
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
    <form
      ref={formRef}
      action={(fd) => start(() => updateBalance(fd))}
      className="flex items-center justify-end gap-0.5 justify-self-end"
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
          liability && balanceCents > 0 ? "text-negative" : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
  );
}

function AddAccountForm({ section, onDone }: { section: Section; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const kindKeys = Object.keys(section.kindLabels);
  const multiKind = kindKeys.length > 1;

  return (
    <div className="border-t border-line">
      <form
        action={(fd) =>
          start(async () => {
            const result = await addAccount(fd);
            if (result?.error) setError(result.error);
            else onDone();
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
            placeholder="Type… (e.g. Retirement, Roth IRA, 529, Trump Account)"
            className="w-56 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : null}
        <input
          name="name"
          placeholder="Account name…"
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
        <input
          name="balance"
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder="Balance"
          className="w-28 rounded-md bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
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
      <form
        action={(fd) => startDel(() => deleteAccount(fd))}
        onSubmit={(e) => {
          if (!confirm(`Delete "${account.name}"? Past transactions keep their history but lose the account link.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={account.id} />
        <button
          type="submit"
          disabled={delPending}
          className="text-xs font-medium text-negative hover:underline disabled:opacity-60"
        >
          {delPending ? "Deleting…" : "Delete account"}
        </button>
      </form>
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
