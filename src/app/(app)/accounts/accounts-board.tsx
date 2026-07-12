"use client";

import { useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { addAccount, deleteAccount, updateAccount, updateBalance } from "./actions";

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  holder: string | null;
  active: boolean;
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
  currency: string;
};

export function AccountsBoard({ accounts, currency }: Props) {
  const active = accounts.filter((a) => a.active);
  const isLiability = (kind: string) => kind === "credit_card" || kind === "debt_loan";

  const assets = active
    .filter((a) => !isLiability(a.kind))
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const liabilities = active
    .filter((a) => isLiability(a.kind))
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const net = assets - liabilities;

  // Loans section only appears if legacy debt_loan accounts exist.
  const sections = SECTIONS.filter(
    (s) => s.key !== "loans" || accounts.some((a) => a.kind === "debt_loan"),
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Accounts</h1>
        <p className="text-sm text-muted">
          Balances entered here feed Networth — enter each account once, use it everywhere.
        </p>
      </div>

      {/* Net worth summary */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryStat label="Assets" value={assets} currency={currency} tone="text-positive" />
        <SummaryStat label="Debts" value={liabilities} currency={currency} tone="text-negative" />
        <SummaryStat
          label="Net worth"
          value={net}
          currency={currency}
          tone={net >= 0 ? "text-foreground" : "text-negative"}
        />
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <AccountSection
            key={section.key}
            section={section}
            accounts={accounts.filter((a) => section.kinds.includes(a.kind))}
            currency={currency}
          />
        ))}
      </div>
    </div>
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
}: {
  section: Section;
  accounts: AccountData[];
  currency: string;
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
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 px-4 py-2.5">
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

          {adding ? (
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

  return (
    <li className={editing ? "bg-brand-soft/30" : "hover:bg-brand-soft/25"}>
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 px-4 py-1.5">
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
          {!account.active ? <span className="shrink-0 text-[11px] text-muted">archived</span> : null}
        </button>

        <BalanceInput
          id={account.id}
          balanceCents={account.balanceCents}
          currency={currency}
          liability={section.liability}
        />
      </div>

      {editing ? <EditAccountForm account={account} onDone={onToggleEdit} /> : null}
    </li>
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
      className="relative justify-self-end"
    >
      <input type="hidden" name="id" value={id} />
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
        {currencySymbol(currency)}
      </span>
      <input
        // Remount (reset to the server value) whenever the saved amount changes.
        key={initial}
        name="balance"
        type="number"
        step="0.01"
        inputMode="decimal"
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`w-[8rem] rounded-md bg-transparent py-1 pl-5 pr-2 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-surface focus:outline-none focus:ring-2 ${
          liability && balanceCents > 0 ? "text-negative" : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
  );
}

function AddAccountForm({ section, onDone }: { section: Section; onDone: () => void }) {
  const [pending, start] = useTransition();
  const multiKind = section.kinds.length > 1;

  return (
    <form
      action={(fd) =>
        start(async () => {
          await addAccount(fd);
          onDone();
        })
      }
      className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2"
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
