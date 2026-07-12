"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import {
  addAccount,
  addBucket,
  deleteAccount,
  deleteBucket,
  updateAccount,
  updateBalance,
  updateBucket,
  updateBucketBalance,
} from "./actions";

export type BucketData = {
  id: string;
  accountId: string;
  name: string;
  balanceCents: number;
};

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  holder: string | null;
  active: boolean;
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

// The plan's four account types, mapped onto the account_kind enum.
// debt_loan is legacy/managed from Budget → shown only if rows exist.
type Section = {
  key: string;
  label: string;
  dot: string;
  kinds: string[];
  liability: boolean;
  // Sub-kind choices offered by the add form (label per kind).
  kindLabels: Record<string, string>;
};

const SECTIONS: Section[] = [
  {
    key: "banking",
    label: "Banking",
    dot: "bg-brand",
    kinds: ["checking", "savings_bucket"],
    liability: false,
    kindLabels: { checking: "Checking", savings_bucket: "Savings" },
  },
  {
    key: "cash",
    label: "Cash",
    dot: "bg-positive",
    kinds: ["cash"],
    liability: false,
    kindLabels: { cash: "Cash" },
  },
  {
    key: "investments",
    label: "Investments & Brokerages",
    dot: "bg-sky-500",
    kinds: ["investment"],
    liability: false,
    kindLabels: { investment: "Investment" },
  },
  {
    key: "credit",
    label: "Credit Cards",
    dot: "bg-negative",
    kinds: ["credit_card"],
    liability: true,
    kindLabels: { credit_card: "Credit card" },
  },
  {
    key: "loans",
    label: "Loans",
    dot: "bg-accent",
    kinds: ["debt_loan"],
    liability: true,
    kindLabels: { debt_loan: "Loan" },
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

  const assets = active
    .filter((a) => !isLiability(a.kind))
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
  const legacySections = SECTIONS.filter(
    (s) => s.liability && accounts.some((a) => s.kinds.includes(a.kind)),
  );

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

      <div className="space-y-3">
        {assetSections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.kinds.includes(a.kind))}
            currency={currency}
          />
        ))}

        {/* Debts, read-only, sourced from the Budget Debt group. */}
        <BudgetDebtsSection debts={budgetDebts} currency={currency} />

        {/* Legacy credit-card/loan accounts — kept only so they can be deleted. */}
        {legacySections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.kinds.includes(a.kind))}
            currency={currency}
            legacy
          />
        ))}
      </div>
    </div>
  );
}

// Read-only mirror of the Budget Debt group so you see debts alongside assets.
function BudgetDebtsSection({ debts, currency }: { debts: BudgetDebt[]; currency: string }) {
  const [open, setOpen] = useState(true);
  const total = debts.reduce((sum, d) => sum + d.balanceCents, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="grid grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
  legacy = false,
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
  legacy?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const total = accounts
    .filter((a) => a.active)
    .reduce((sum, a) => sum + a.balanceCents, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_15rem] items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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

      {open ? (
        <div className="border-t border-line">
          {accounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">No accounts yet — add one below.</p>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  section={section}
                  currency={currency}
                  editing={editingId === a.id}
                  onToggleEdit={() =>
                    setEditingId((id) => (id === a.id ? null : a.id))
                  }
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
}: {
  account: AccountData;
  section: Section;
  currency: string;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const kindLabel = section.kindLabels[account.kind] ?? account.kind;
  const showKind = section.kinds.length > 1;
  // Buckets make sense for asset accounts (savings/investments/cash), not for
  // credit cards or loans.
  const allowBuckets = !section.liability;
  const bucketCount = account.buckets.length;
  const [bucketsOpen, setBucketsOpen] = useState(bucketCount > 0);

  return (
    <li className={editing ? "bg-brand-soft/30" : "hover:bg-brand-soft/25"}>
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_10rem] items-center gap-1.5 px-4 py-1.5">
        {allowBuckets ? (
          <button
            type="button"
            onClick={() => setBucketsOpen((v) => !v)}
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
          className="flex min-w-0 items-baseline gap-2 text-left"
        >
          <span className={`truncate text-sm ${account.active ? "text-foreground" : "text-muted line-through"}`}>
            {account.name}
          </span>
          {account.holder ? (
            <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              {account.holder}
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

        <BalanceInput
          id={account.id}
          balanceCents={account.balanceCents}
          currency={currency}
          liability={section.liability}
        />
      </div>

      {allowBuckets && bucketsOpen ? (
        <BucketDrawer account={account} currency={currency} />
      ) : null}

      {editing ? <EditAccountForm account={account} onDone={onToggleEdit} /> : null}
    </li>
  );
}

// The bucket breakdown for one account: named sinking funds + an auto-computed
// "Unallocated" remainder so the parts always reconcile to the account total.
function BucketDrawer({ account, currency }: { account: AccountData; currency: string }) {
  const [adding, setAdding] = useState(false);

  const allocated = account.buckets.reduce((sum, b) => sum + b.balanceCents, 0);
  const unallocated = account.balanceCents - allocated;

  return (
    <div className="border-t border-line bg-background/40 pl-11 pr-4 py-2">
      {account.buckets.length === 0 ? (
        <p className="py-1 text-xs text-muted">
          No buckets yet — optional. Split this account into sinking funds (e.g. Emergency Fund,
          Vehicle, Real Estate). Leave empty for accounts you don&apos;t need to break down.
        </p>
      ) : (
        <ul className="divide-y divide-line/60">
          {account.buckets.map((b) => (
            <BucketRow key={b.id} bucket={b} currency={currency} />
          ))}
        </ul>
      )}

      {/* Auto remainder — the "AMEX Savings (Extra)" plug. Only meaningful once
          at least one bucket exists. */}
      {account.buckets.length > 0 ? (
        <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1.5">
          <span className="text-xs font-medium text-muted">
            Unallocated{unallocated < 0 ? " (over-allocated)" : ""}
          </span>
          <span className={`text-sm tabular-nums ${unallocated < 0 ? "text-negative" : "text-muted"}`}>
            {formatMoney(unallocated, currency)}
          </span>
        </div>
      ) : null}

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

function BucketRow({ bucket, currency }: { bucket: BucketData; currency: string }) {
  const [delPending, startDel] = useTransition();

  return (
    <li className="group grid grid-cols-[minmax(0,1fr)_10rem_1.25rem] items-center gap-1.5 py-1">
      <BucketNameInput id={bucket.id} name={bucket.name} />
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

function AddBucketForm({ accountId, onDone }: { accountId: string; onDone: () => void }) {
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
  const multiKind = section.kinds.length > 1;

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
            {section.kinds.map((k) => (
              <option key={k} value={k}>{section.kindLabels[k]}</option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="kind" value={section.kinds[0]} />
        )}
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

function EditAccountForm({ account, onDone }: { account: AccountData; onDone: () => void }) {
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
