"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { useMounted } from "@/lib/use-mounted";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import {
  coverOverspend,
  deleteSubcategory,
  deleteTransaction,
  moveSubcategoryToGroup,
  setSubcategoryRecurring,
  reassignPlanned,
  updateSubcategory,
  upsertDebtAndPlan,
  upsertPlan,
  upsertSavingsGoalAndLink,
} from "./actions";
import type { AccountOption, BucketOption, RowData, SubOption, TxData, TxPrefill } from "./types";
import { DEBT_KINDS } from "./types";

const HEADER_ACCENT: Record<CategoryKind, string> = {
  income: "bg-positive",
  savings: "bg-sky-500",
  bills: "bg-brand",
  expenses: "bg-accent",
  // A softer, desaturated coral-red rather than the hot negative token
  // (red-600) used for figures — the solid header fill was reading too bright,
  // while still keeping the white title/figure legible.
  debt: "bg-[#e0625e]",
};

type Props = {
  row: RowData;
  kind: CategoryKind;
  currency: string;
  monthKey: string; // YYYY-MM-01
  subOptions: SubOption[];
  groupOptions: { id: string; name: string; kind: CategoryKind }[];
  paymentAccountOptions: AccountOption[];
  debtAccountOptions: AccountOption[];
  bucketOptions: BucketOption[];
  snowballExtraCents: number;
  isSnowballFocus: boolean;
  // Every tx already loaded on the Budget page; the panel filters to this
  // subcategory + month so the user can see what actually made up the Spent
  // figure without hopping to the Transactions page.
  transactions: TxData[];
  accountNameById: Map<string, string>;
  onClose: () => void;
  onAddTransaction: (prefill?: TxPrefill) => void;
  onEditTransaction: (tx: TxData) => void;
  onOverspentCovered: () => void;
};

// Move planned dollars from a category that has room into this overspent one.
// Only categories with something left to give are offered, with the amount
// pre-filled to exactly cover the shortfall — the common case is one tap.
function CoverOverspend({
  row,
  monthKey,
  currency,
  shortfallCents,
  subOptions,
  onCovered,
}: {
  row: RowData;
  monthKey: string;
  currency: string;
  shortfallCents: number;
  subOptions: SubOption[];
  onCovered: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState(centsToDisplay(shortfallCents));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Outflow categories only. "Remaining" on an income item means income still
  // expected to arrive, not planned money sitting unspent — offering those as
  // donors would let you fund a shortfall out of a paycheque you haven't
  // received, which is exactly the mistake envelope budgeting exists to stop.
  const donors = subOptions
    .filter((s) => s.id !== row.subId && s.kind !== "income" && (s.remainingCents ?? 0) > 0)
    .sort((a, b) => (b.remainingCents ?? 0) - (a.remainingCents ?? 0));

  if (!open) {
    return (
      <div className="border-b border-line bg-negative/5 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-negative underline-offset-2 hover:underline"
        >
          Cover the {formatMoney(shortfallCents, currency)} from another category
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-line bg-negative/5 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        Move money into {row.name}
      </p>
      {donors.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted">
          No category has planned money left this month to move.
        </p>
      ) : (
        <>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              aria-label="Move from"
              className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Take from…</option>
              {donors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {formatMoney(d.remainingCents ?? 0, currency)} left
                </option>
              ))}
            </select>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Amount to move"
              className="w-full rounded-lg bg-background px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || !fromId}
                onClick={() => {
                  setError(null);
                  const fd = new FormData();
                  fd.set("fromSubcategoryId", fromId);
                  fd.set("toSubcategoryId", row.subId);
                  fd.set("month", monthKey);
                  fd.set("amount", amount);
                  start(async () => {
                    const res = await coverOverspend(fd);
                    if (res?.error) setError(res.error);
                    else {
                      setOpen(false);
                      onCovered();
                    }
                  });
                }}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {pending ? "Moving…" : "Move"}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); }}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
          {error ? <p className="mt-1.5 text-xs text-negative">{error}</p> : null}
        </>
      )}
    </div>
  );
}

export function ItemPanel({
  row,
  kind,
  currency,
  monthKey,
  subOptions,
  groupOptions,
  paymentAccountOptions,
  debtAccountOptions,
  bucketOptions,
  snowballExtraCents,
  isSnowballFocus,
  transactions,
  accountNameById,
  onClose,
  onAddTransaction,
  onEditTransaction,
  onOverspentCovered,
}: Props) {
  const [showItemDetails, setShowItemDetails] = useState(false);
  // BudgetBoard keeps both the desktop rail and mobile sheet mounted. Each
  // copy needs a unique form id so its external Save button submits the form
  // in the panel the user actually edited.
  const saveFormId = `plan-form-${useId()}`;
  const isPlainForm = !(kind === "debt" && row.debt) && !(kind === "savings" && row.savings);
  // Filter txs to this row's subcategory and the currently-viewed month. The
  // month is a "first of the month" ISO date; a tx belongs if its YYYY-MM
  // prefix matches.
  const monthPrefix = monthKey.slice(0, 7);
  const monthTxs = transactions
    .filter((t) => t.subId === row.subId && t.date.startsWith(monthPrefix))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const isIncome = kind === "income";
  const remaining = row.plannedCents - row.spentCents;
  const over = remaining < 0;
  // Paying more toward a debt, or putting more into savings, than you planned
  // isn't "overspending" — it's a good thing. Frame the overage as extra put in
  // (a positive number) rather than a negative "Overspent". Bills/expenses keep
  // the real over-budget warning.
  const overIsGood = kind === "debt" || kind === "savings";
  const verb = isIncome
    ? "received"
    : kind === "debt"
      ? "paid"
      : kind === "savings"
        ? "saved"
        : "spent";
  const headerLabel = isIncome
    ? "Received"
    : over
      ? overIsGood
        ? kind === "debt"
          ? "Extra paid"
          : "Extra saved"
        : "Overspent"
      : "Remaining";
  const headerValue = isIncome ? row.spentCents : over && overIsGood ? -remaining : remaining;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Colored header */}
      <div className={`relative ${HEADER_ACCENT[kind]} px-4 pb-3 pt-3 pr-11`}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/30"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <InlineNameEdit subId={row.subId} name={row.name} />
            <p className="mt-0.5 text-[11px] text-white/90 tabular-nums">
              {formatMoney(row.spentCents, currency)} {verb} of{" "}
              {formatMoney(row.plannedCents, currency)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-white/80">
              {headerLabel}
            </p>
            <p className="text-xl font-bold leading-tight text-white tabular-nums">
              {formatMoney(headerValue, currency)}
            </p>
          </div>
        </div>
      </div>

      {over && !overIsGood ? (
        <CoverOverspend
          row={row}
          monthKey={monthKey}
          currency={currency}
          shortfallCents={-remaining}
          subOptions={subOptions}
          onCovered={onOverspentCovered}
        />
      ) : null}

      <DeleteFooter
        subId={row.subId}
        onDeleted={onClose}
        onAddTransaction={onAddTransaction}
        saveFormId={saveFormId}
        onDetails={isPlainForm ? () => setShowItemDetails(true) : undefined}
      />

      {/* Expenses are the variable side of the budget — groceries, fuel,
          clothing all differ month to month, so repeating last month's figure
          there would be a guess dressed up as a number. The prefill is for
          fixed charges: bills, paycheck deductions, savings, debt. */}
      {kind !== "expenses" ? (
        <RecurringStrip row={row} currency={currency} onAddTransaction={onAddTransaction} />
      ) : null}

      <ItemGroupSelect row={row} kind={kind} groupOptions={groupOptions} />

      {(() => {
        const body =
          kind === "debt" && row.debt ? (
            <DebtForm
              key={row.subId}
              row={row}
              currency={currency}
              monthKey={monthKey}
              accountOptions={debtAccountOptions}
              snowballExtraCents={snowballExtraCents}
              isSnowballFocus={isSnowballFocus}
              formId={saveFormId}
            />
          ) : kind === "savings" && row.savings ? (
            <SavingsForm key={row.subId} row={row} bucketOptions={bucketOptions} monthKey={monthKey} formId={saveFormId} />
          ) : (
            <PlannedForm
              subId={row.subId}
              monthKey={monthKey}
              plannedCents={row.plannedCents}
              spentCents={row.spentCents}
              itemName={row.name}
              currency={currency}
              subOptions={subOptions}
              dueDay={row.dueDay}
              paymentAccountId={row.paymentAccountId}
              paymentAccountOptions={paymentAccountOptions}
              hasDue={kind !== "debt" && KINDS_WITH_DUE.includes(kind)}
              autoPlanned={row.autoPlanned}
              showDetails={showItemDetails}
              onCloseDetails={() => setShowItemDetails(false)}
              onAddTransaction={onAddTransaction}
              formId={saveFormId}
            />
          );
        return body ? <div className="space-y-4 px-5 pb-4 pt-4">{body}</div> : null;
      })()}

      <MonthTransactions
        txs={monthTxs}
        currency={currency}
        accountNameById={accountNameById}
        onEdit={onEditTransaction}
      />
    </div>
  );
}

function ItemGroupSelect({
  row,
  kind,
  groupOptions,
}: {
  row: RowData;
  kind: CategoryKind;
  groupOptions: { id: string; name: string; kind: CategoryKind }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const compatible = groupOptions.filter((group) => group.kind === kind);
  if (compatible.length < 2) return null;

  return (
    <form
      action={(formData) =>
        start(async () => {
          setError(null);
          const result = await moveSubcategoryToGroup(formData);
          if (result.error) setError(result.error);
        })
      }
      className="border-b border-line bg-background/50 px-5 py-3"
    >
      <input type="hidden" name="subcategoryId" value={row.subId} />
      <label className="flex items-center gap-3 text-xs">
        <span className="font-semibold text-muted">Category group</span>
        <select
          key={row.categoryId}
          name="categoryId"
          defaultValue={row.categoryId}
          disabled={pending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="ml-auto max-w-[12rem] rounded-lg bg-surface px-2.5 py-1.5 font-semibold text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
        >
          {compatible.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
      {error ? <p className="mt-2 text-xs text-negative">{error}</p> : null}
    </form>
  );
}

// Editable title inside the colored header. Click to edit, Enter or blur to
// save, Esc to cancel. Uses the same updateSubcategory action as the old
// Rename form — no schema change.
function InlineNameEdit({ subId, name }: { subId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="min-w-0 flex-1 truncate rounded px-1 -mx-1 text-left text-lg font-bold text-white hover:bg-white/10"
      >
        {name}
      </button>
    );
  }
  return (
    <form
      ref={formRef}
      action={(fd) =>
        start(async () => {
          await updateSubcategory(fd);
          setEditing(false);
        })
      }
      className="min-w-0 flex-1"
    >
      <input type="hidden" name="id" value={subId} />
      <input
        ref={inputRef}
        autoFocus
        name="name"
        defaultValue={name}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => formRef.current?.requestSubmit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={pending}
        className="w-full min-w-0 rounded bg-white px-2 py-1 text-lg font-bold text-gray-900 shadow-sm outline-none ring-2 ring-white/70"
      />
    </form>
  );
}

// This button lives outside its target form and associates through `form`.
// Do not synchronously disable it from its click handler: doing so cancels the
// browser's default submit activation before React receives the form action.
function SaveButton({ saveFormId }: { saveFormId: string }) {
  return (
    <button
      type="submit"
      form={saveFormId}
      className="flex shrink-0 items-center gap-1.5 rounded bg-brand px-5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
    >
      Save
    </button>
  );
}

// Utilities and paycheck deductions bill the same amount every month, so
// retyping them is pure busywork. Marking an item Recurring surfaces last
// month's actual as a one-click prefill: it opens the transaction form with
// the amount filled in, and the user still picks Clear or Add — nothing is
// saved behind their back.
function RecurringStrip({
  row,
  currency,
  onAddTransaction,
}: {
  row: RowData;
  currency: string;
  onAddTransaction: (prefill?: TxPrefill) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = () => {
    const fd = new FormData();
    fd.set("subcategoryId", row.subId);
    if (!row.isRecurring) fd.set("isRecurring", "on");
    start(async () => {
      await setSubcategoryRecurring(fd);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-5 py-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={row.isRecurring}
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition disabled:opacity-60 ${
          row.isRecurring
            ? "bg-positive/15 text-positive ring-positive/40 hover:bg-positive/25"
            : "bg-transparent text-muted ring-line hover:text-foreground"
        }`}
      >
        {row.isRecurring ? "✓ Recurring" : "Recurring"}
      </button>
      {/* Only on recurring items, and only when last month actually had
          activity — a dead "$0.00" button would be noise on a brand-new item
          or the first month an item exists. */}
      {row.isRecurring && row.prevSpentCents > 0 ? (
        <button
          type="button"
          onClick={() =>
            onAddTransaction({
              cents: row.prevSpentCents,
              accountId: row.prevAccountId,
              payee: row.prevPayee,
            })
          }
          className="min-w-0 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-brand ring-1 ring-brand/20 transition hover:bg-brand/20"
        >
          <span aria-hidden="true">↺</span> Prev Mo Spent {formatMoney(row.prevSpentCents, currency)}
        </button>
      ) : null}
      {row.isRecurring && row.prevSpentCents === 0 ? (
        <span className="min-w-0 text-[11px] text-muted">No spend last month to copy</span>
      ) : null}
    </div>
  );
}

function DeleteFooter({
  subId,
  onDeleted,
  onAddTransaction,
  saveFormId,
  onDetails,
}: {
  subId: string;
  onDeleted: () => void;
  onAddTransaction: (prefill?: TxPrefill) => void;
  saveFormId?: string;
  onDetails?: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/70 bg-surface px-5 py-2">
      {onDetails ? (
        <button
          type="button"
          onClick={onDetails}
          className="shrink-0 rounded bg-brand-soft/60 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20"
        >
          Details
        </button>
      ) : null}
      <button
        type="button"
        // Wrapped, not passed directly: the callback takes an optional prefill
        // amount, and a bare handler would hand it the click event instead.
        onClick={() => onAddTransaction()}
        className="flex-1 rounded bg-positive/15 py-1.5 text-xs font-semibold text-positive transition hover:bg-positive/25"
      >
        +Transaction
      </button>
      {saveFormId ? <SaveButton saveFormId={saveFormId} /> : null}
      <form
        action={(fd) => start(() => deleteSubcategory(fd).then(onDeleted))}
        className="shrink-0"
      >
        <input type="hidden" name="id" value={subId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-negative/[0.06] px-3 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/10 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function MonthTransactions({
  txs,
  currency,
  accountNameById,
  onEdit,
}: {
  txs: TxData[];
  currency: string;
  accountNameById: Map<string, string>;
  onEdit: (tx: TxData) => void;
}) {
  if (txs.length === 0) {
    return (
      <div className="border-t border-line/70 px-5 py-3 text-center text-xs text-muted">
        No transactions this month
      </div>
    );
  }
  const dateLabel = (iso: string) => {
    // "2026-07-25" → "Jul 25". Split-based parse avoids the UTC-vs-local
    // ambiguity of `new Date("2026-07-25")` (which would render as Jul 24 in
    // negative UTC offsets).
    const [, m, d] = iso.split("-").map(Number);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${MONTHS[m - 1]} ${d}`;
  };
  return (
    <div className="border-t border-line/70 px-5 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        This month · {txs.length} transaction{txs.length === 1 ? "" : "s"}
      </h3>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {txs.map((t) => (
          <TxRow key={t.id} t={t} currency={currency} accountNameById={accountNameById} onEdit={onEdit} dateLabel={dateLabel} />
        ))}
      </ul>
    </div>
  );
}

function TxRow({
  t,
  currency,
  accountNameById,
  onEdit,
  dateLabel,
}: {
  t: TxData;
  currency: string;
  accountNameById: Map<string, string>;
  onEdit: (tx: TxData) => void;
  dateLabel: (iso: string) => string;
}) {
  const [delPending, startDel] = useTransition();
  const acct = t.accountId ? accountNameById.get(t.accountId) : null;
  return (
    <li className="group flex items-center gap-1 rounded-md px-1 hover:bg-surface-raised/60">
      <button
        type="button"
        onClick={() => onEdit(t)}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-1.5 text-left text-xs"
        title="Edit transaction"
      >
        <span className="w-10 shrink-0 tabular-nums text-muted">{dateLabel(t.date)}</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{t.payee ?? "—"}</span>
          {acct ? <span className="ml-1 text-muted">· {acct}</span> : null}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatMoney(t.amountCents, currency)}
        </span>
      </button>
      <button
        type="button"
        title="Delete transaction"
        disabled={delPending}
        onClick={() => {
          const fd = new FormData();
          fd.append("id", t.id);
          startDel(async () => { await deleteTransaction(fd); });
        }}
        className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-sm font-bold text-negative opacity-0 transition group-hover:opacity-100 hover:bg-negative/10 disabled:opacity-40"
      >
        ×
      </button>
    </li>
  );
}

function PlannedForm({
  subId,
  monthKey,
  plannedCents,
  spentCents,
  itemName,
  currency,
  subOptions,
  dueDay,
  paymentAccountId,
  paymentAccountOptions,
  hasDue,
  autoPlanned,
  showDetails,
  onCloseDetails,
  formId,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  spentCents: number;
  itemName: string;
  currency: string;
  subOptions: SubOption[];
  dueDay?: number | null;
  paymentAccountId: string | null;
  paymentAccountOptions: AccountOption[];
  hasDue?: boolean;
  autoPlanned?: boolean;
  showDetails: boolean;
  onCloseDetails: () => void;
  onAddTransaction: (prefill?: TxPrefill) => void;
  formId: string;
}) {
  const [, startDue] = useTransition();
  const router = useRouter();

  const plannedInput = (
    <label className="block flex-1 min-w-0">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">Planned ($)</span>
      <input
        key={plannedCents}
        name="planned"
        type="number"
        step="0.01"
        min="0"
        defaultValue={centsToDisplay(plannedCents)}
        onFocus={(e) => e.currentTarget.select()}
        disabled={autoPlanned}
        placeholder="0.00"
        className="w-full rounded-lg bg-background px-3 py-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );

  return (
    <>
      <form
        id={formId}
        action={(fd) => startDue(async () => {
          if (!autoPlanned) await upsertPlan(fd);
          await updateSubcategory(fd);
          router.refresh();
        })}
        className="space-y-2"
      >
        {/* Never name a hidden input just "id" — that clashes with React 19's
            form-action wiring (named form controls shadow form.id, and the
            submit falls through to a native GET that reloads the page without
            calling the server action). */}
        <input type="hidden" name="name" value={itemName} />
        <input type="hidden" name="subcategoryId" value={subId} />
        <input type="hidden" name="month" value={monthKey} />

        {hasDue ? (
          <Section title="Planned & due day">
            <div className="flex items-end gap-2">
              {plannedInput}
              <label className="block flex-1 min-w-0">
                <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">Due day</span>
                <input
                  key={dueDay ?? ""}
                  name="dueDay"
                  type="number"
                  min={1}
                  max={31}
                  placeholder="—"
                  defaultValue={dueDay ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-lg bg-background px-3 py-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </label>
            </div>
            {paymentAccountOptions.length > 0 ? (
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">Charged to (optional)</span>
                <select
                  key={paymentAccountId ?? "none"}
                  name="paymentAccountId"
                  defaultValue={paymentAccountId ?? ""}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">No linked account</option>
                  {paymentAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-muted">Used to prefill the account when you mark this item Paid. Nothing charges automatically.</span>
              </label>
            ) : null}
          </Section>
        ) : (
          <Section title="Planned amount">
            {plannedInput}
          </Section>
        )}
      </form>

      {showDetails ? (
        <ItemDetailsPopover
          subId={subId}
          itemName={itemName}
          monthKey={monthKey}
          plannedCents={plannedCents}
          spentCents={spentCents}
          currency={currency}
          subOptions={subOptions}
          onClose={onCloseDetails}
        />
      ) : null}
    </>
  );
}

function ItemDetailsPopover({
  subId,
  itemName,
  monthKey,
  plannedCents,
  spentCents,
  currency,
  subOptions,
  onClose,
}: {
  subId: string;
  itemName: string;
  monthKey: string;
  plannedCents: number;
  spentCents: number;
  currency: string;
  subOptions: SubOption[];
  onClose: () => void;
}) {
  const [reassignOpen, setReassignOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toSubId, setToSubId] = useState<string>("");
  const [amount, setAmount] = useState<string>(centsToDisplay(Math.max(0, plannedCents - spentCents)));
  const available = plannedCents - spentCents;
  const monthLabel = new Date(`${monthKey}T00:00:00`).toLocaleString("en-US", { month: "short", year: "numeric" });
  const mounted = useMounted();
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-black/10 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{itemName}</p>
            <p className="text-sm font-bold text-foreground">Details · {monthLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-brand-soft hover:text-foreground"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <dl className="grid grid-cols-3 gap-2 px-4 py-3 text-center">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Assigned</dt>
            <dd className="mt-0.5 text-sm font-bold text-foreground tabular-nums">{formatMoney(plannedCents, currency)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Spent</dt>
            <dd className="mt-0.5 text-sm font-bold text-negative tabular-nums">{formatMoney(spentCents, currency)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Available</dt>
            <dd className={`mt-0.5 text-sm font-bold tabular-nums ${available < 0 ? "text-negative" : "text-positive"}`}>
              {formatMoney(available, currency)}
            </dd>
          </div>
        </dl>

        {!reassignOpen ? (
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              disabled={available <= 0}
              onClick={() => setReassignOpen(true)}
              className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
            >
              Reassign available funds
            </button>
            {available <= 0 ? (
              <p className="mt-1.5 text-center text-[11px] text-muted">Nothing available to reassign.</p>
            ) : null}
          </div>
        ) : (
          <form
            className="space-y-3 border-t border-line px-4 py-3"
            action={(fd) =>
              start(async () => {
                setError(null);
                const res = await reassignPlanned(fd);
                if (res && "error" in res && res.error) setError(res.error);
                else onClose();
              })
            }
          >
            <input type="hidden" name="fromSubId" value={subId} />
            <input type="hidden" name="month" value={monthKey} />
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Reassign to</span>
              <select
                name="toSubId"
                value={toSubId}
                onChange={(e) => setToSubId(e.target.value)}
                required
                className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Pick a budget item…</option>
                {subOptions.filter((s) => s.id !== subId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Amount (max {formatMoney(available, currency)})
              </span>
              <input
                name="amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg bg-background px-3 py-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
            {error ? <p className="text-xs font-medium text-negative">{error}</p> : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReassignOpen(false)}
                className="flex-1 rounded-lg bg-background py-2 text-sm font-medium text-muted ring-1 ring-line transition hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !toSubId}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
              >
                {pending ? "Moving…" : "Move funds"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DebtForm({
  row,
  currency,
  monthKey,
  accountOptions,
  snowballExtraCents,
  isSnowballFocus,
  formId,
}: {
  row: RowData;
  currency: string;
  monthKey: string;
  accountOptions: AccountOption[];
  snowballExtraCents: number;
  isSnowballFocus: boolean;
  formId: string;
}) {
  const [, start] = useTransition();
  const router = useRouter();
  const plannedRef = useRef<HTMLInputElement>(null);
  const d = row.debt!;
  // What the Snowball page currently schedules for this debt this month —
  // its min payment, plus the snowball extra if it's the focus debt. This is
  // just informational: "Planned this month" is what YOU'RE budgeting to pay
  // and can differ from the contractual "Min. payment" below it.
  const scheduledCents = d.minCents + (isSnowballFocus ? snowballExtraCents : 0);
  return (
    <Section title="Debt details">
      <form id={formId} action={(fd) => start(async () => { await upsertDebtAndPlan(fd); router.refresh(); })} className="space-y-2">
        <input type="hidden" name="subcategoryId" value={row.subId} />
        <input type="hidden" name="month" value={monthKey} />
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Planned this month
          </span>
          <input
            ref={plannedRef}
            key={row.plannedCents}
            name="planned"
            type="number"
            step="0.01"
            defaultValue={centsToDisplay(row.plannedCents)}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg bg-background px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        {isSnowballFocus ? <p className="text-[11px] text-muted">Snowball baseline this month: <span className="font-semibold tabular-nums text-brand">{formatMoney(scheduledCents, currency)}</span></p> : null}
        <Grid>
          <Labeled label="Balance" name="balance" type="number" step="0.01" defaultValue={centsToDisplay(d.balanceCents)} />
          <Labeled label="Min. payment" name="minPayment" type="number" step="0.01" defaultValue={centsToDisplay(d.minCents)} />
          <Labeled label="Interest %" name="apr" type="number" step="0.001" defaultValue={String(d.apr)} />
          <Labeled label="Due day" name="dueDay" type="number" min={1} max={31} defaultValue={d.dueDay ?? ""} />
        </Grid>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Debt type
          </span>
          <select
            key={d.debtKind ?? "none"}
            name="debtKind"
            defaultValue={d.debtKind ?? ""}
            className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">Not set</option>
            {DEBT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <Labeled
          label="0% APR ends"
          name="promoAprEndsOn"
          type="date"
          defaultValue={d.promoAprEndsOn ?? ""}
          title="If you signed up for an intro 0% offer, set when it ends so you know before real interest kicks in."
        />
        {accountOptions.length > 0 ? (
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
              Linked account
            </span>
            <select
              key={d.accountId ?? "none"}
              name="accountId"
              defaultValue={d.accountId ?? ""}
              className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Not linked</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <span className="mt-0.5 block text-[10px] text-muted">
              Link the credit card / loan account this debt represents — Networth then
              counts it once (this balance, not the account&apos;s).
            </span>
          </label>
        ) : null}
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Notes
          </span>
          <textarea
            key={d.notes ?? ""}
            name="notes"
            defaultValue={d.notes ?? ""}
            rows={2}
            placeholder="Anything worth remembering about this debt…"
            className="w-full resize-none rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
      </form>
    </Section>
  );
}

function calcMonthly(goalStr: string, startStr: string, targetDate: string): string {
  const goal = parseFloat(goalStr) || 0;
  const start = parseFloat(startStr) || 0;
  const left = goal - start;
  if (!targetDate || left <= 0) return "";
  const [ty, tm] = targetDate.split("-").map(Number);
  const now = new Date();
  const months = (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth());
  if (months <= 0) return "";
  return String(Math.ceil((left / months) * 100) / 100);
}

function savingsPace(goalCents: number, startCents: number, monthlyCents: number, targetDate: string | null, spentCents: number) {
  if (goalCents <= 0 || !targetDate) return null;
  const savedCents = startCents + spentCents;
  if (savedCents >= goalCents) return "reached" as const;
  const [ty, tm] = targetDate.split("-").map(Number);
  const now = new Date();
  const months = (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth());
  if (months <= 0) return "overdue" as const;
  const required = Math.ceil((goalCents - savedCents) / months);
  return monthlyCents >= required ? "on_track" as const : "behind" as const;
}

function SavingsForm({ row, bucketOptions, monthKey, formId }: { row: RowData; bucketOptions: BucketOption[]; monthKey: string; formId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const s = row.savings!;
  const [goal, setGoal] = useState(centsToDisplay(s.goalCents));
  const [savingsStart, setSavingsStart] = useState(centsToDisplay(s.startCents));
  const [targetDate, setTargetDate] = useState(s.targetDate ?? "");
  const [monthly, setMonthly] = useState(centsToDisplay(s.monthlyCents));

  function recompute(newGoal = goal, newStart = savingsStart, newDate = targetDate) {
    const auto = calcMonthly(newGoal, newStart, newDate);
    if (auto) setMonthly(auto);
  }

  const pace = savingsPace(s.goalCents, s.startCents, s.monthlyCents, s.targetDate, row.spentCents);

  return (
    <Section title="Savings goal">
      {pace === "reached" && (
        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-positive">
          <span>✓</span> Goal reached!
        </p>
      )}
      {pace === "behind" && (
        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-amber-500">
          <span>⚠</span> Behind pace
        </p>
      )}
      {pace === "overdue" && (
        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-negative">
          <span>!</span> Target date passed
        </p>
      )}
      {pace === "on_track" && (
        <p className="mb-2 flex items-center gap-1 text-xs font-medium text-positive">
          <span>✓</span> On track
        </p>
      )}
      <form id={formId} action={(fd) => start(async () => { await upsertSavingsGoalAndLink(fd); router.refresh(); })} className="space-y-2">
        <input type="hidden" name="subcategoryId" value={row.subId} />
        <input type="hidden" name="month" value={monthKey} />
        <Grid>
          <Labeled label="Planned monthly" name="planned" type="number" step="0.01" defaultValue={centsToDisplay(row.plannedCents)} />
          <Labeled label="Goal" name="goal" type="number" step="0.01" value={goal}
            onChange={(e) => { setGoal(e.target.value); recompute(e.target.value, savingsStart, targetDate); }} />
          <Labeled
            label="Target date"
            name="targetDate"
            type="date"
            value={targetDate}
            onChange={(e) => { setTargetDate(e.target.value); recompute(goal, savingsStart, e.target.value); }}
            title="Set this to see whether your Monthly amount is on pace to hit the Goal by then."
          />
          <Labeled label="Start" name="start" type="number" step="0.01" value={savingsStart}
            onChange={(e) => { setSavingsStart(e.target.value); recompute(goal, e.target.value, targetDate); }} />
        </Grid>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Monthly to reach goal" labelClassName="text-[8.5px]" name="monthly" type="number" step="0.01" value={monthly}
            onChange={(e) => setMonthly(e.target.value)} />
          {bucketOptions.length > 0 ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                Linked bucket
              </span>
              <select
                key={s.linkedBucketId ?? s.linkedAccountId ?? "none"}
                name="linkTarget"
                defaultValue={
                  s.linkedAccountId
                    ? `account:${s.linkedAccountId}`
                    : s.linkedBucketId ?? ""
                }
                className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Not linked</option>
                {(() => {
                  const family = bucketOptions.filter((b) => !b.isKids);
                  const kids = bucketOptions.filter((b) => b.isKids);
                  const groups: { label: string; items: typeof bucketOptions; disabled?: boolean }[] = [];
                  const addSection = (items: typeof bucketOptions, suffix: string) => {
                    const seen: string[] = [];
                    const byAcct = new Map<string, typeof bucketOptions>();
                    for (const b of items) {
                      if (!byAcct.has(b.accountName)) { seen.push(b.accountName); byAcct.set(b.accountName, []); }
                      byAcct.get(b.accountName)!.push(b);
                    }
                    for (const acct of seen) groups.push({ label: acct + suffix, items: byAcct.get(acct)! });
                  };
                  addSection(family, "");
                  if (kids.length > 0) {
                    groups.push({ label: "── Kids Funding ──", items: [], disabled: true });
                    addSection(kids, " (Kids)");
                  }
                  return groups.map((g) =>
                    g.disabled
                      ? <optgroup key={g.label} label={g.label} disabled />
                      : <optgroup key={g.label} label={g.label}>
                          {g.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </optgroup>
                  );
                })()}
              </select>
            </label>
          ) : null}
        </div>
        <SaveBtn pending={pending} full />
      </form>
    </Section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Labeled({
  label,
  hint,
  labelClassName,
  onFocus,
  ...inputProps
}: { label: string; hint?: string; labelClassName?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "labelClassName">) {
  return (
    <label className="block">
      <span className={`mb-0.5 flex items-center gap-1 font-medium uppercase tracking-wide text-muted ${labelClassName ?? "text-[10px]"}`}>
        {label}
        {hint && <span className="font-normal normal-case tracking-normal text-muted/60">{hint}</span>}
      </span>
      <input
        {...inputProps}
        // Select the existing value on focus so typing replaces a "0" or
        // "0.00" placeholder instead of requiring it to be deleted first.
        onFocus={onFocus ?? ((e) => e.currentTarget.select())}
        className="w-full rounded-lg bg-background px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </label>
  );
}

function SaveBtn({ pending, full, label }: { pending: boolean; full?: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60 ${full ? "w-full" : ""}`}
    >
      {pending ? "Saving…" : label ?? "Save"}
    </button>
  );
}
