"use client";

import { useRef, useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import {
  deleteSubcategory,
  deleteTransaction,
  updateSubcategory,
  upsertDebtAndPlan,
  upsertPlan,
  upsertSavingsGoalAndLink,
} from "./actions";
import type { AccountOption, BucketOption, RowData, TxData } from "./types";
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
  onAddTransaction: () => void;
  onEditTransaction: (tx: TxData) => void;
};

export function ItemPanel({
  row,
  kind,
  currency,
  monthKey,
  debtAccountOptions,
  bucketOptions,
  snowballExtraCents,
  isSnowballFocus,
  transactions,
  accountNameById,
  onClose,
  onAddTransaction,
  onEditTransaction,
}: Props) {
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

      {(() => {
        const body =
          kind === "debt" && row.debt ? (
            <DebtForm
              key={row.subId}
              row={row}
              currency={currency}
              monthKey={monthKey}
              accountOptions={debtAccountOptions}
              bucketOptions={bucketOptions}
              snowballExtraCents={snowballExtraCents}
              isSnowballFocus={isSnowballFocus}
              onAddTransaction={onAddTransaction}
            />
          ) : kind === "savings" && row.savings ? (
            <SavingsForm key={row.subId} row={row} bucketOptions={bucketOptions} monthKey={monthKey} onAddTransaction={onAddTransaction} />
          ) : (
            <PlannedForm subId={row.subId} monthKey={monthKey} plannedCents={row.plannedCents} dueDay={row.dueDay} hasDue={kind !== "debt" && KINDS_WITH_DUE.includes(kind)} onAddTransaction={onAddTransaction} />
          );
        return body ? <div className="space-y-4 px-5 pb-4 pt-4">{body}</div> : null;
      })()}

      <MonthTransactions
        txs={monthTxs}
        currency={currency}
        accountNameById={accountNameById}
        onEdit={onEditTransaction}
      />

      <DeleteFooter subId={row.subId} onDeleted={onClose} onAddTransaction={onAddTransaction} />
    </div>
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

function DeleteFooter({
  subId,
  onDeleted,
  onAddTransaction,
}: {
  subId: string;
  onDeleted: () => void;
  onAddTransaction: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2 border-t border-line/70 px-5 py-2">
      <button
        type="button"
        onClick={onAddTransaction}
        className="flex-1 rounded bg-brand-soft py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20"
      >
        +Transaction
      </button>
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
          startDel(() => deleteTransaction(fd));
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
  dueDay,
  hasDue,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
  dueDay?: number | null;
  hasDue?: boolean;
  onAddTransaction: () => void;
}) {
  const [, startDue] = useTransition();
  if (!hasDue) return null;
  return (
    <Section title="Due day (day of month)">
      <form action={(fd) => startDue(() => updateSubcategory(fd))} className="flex items-center gap-2">
        <input type="hidden" name="id" value={subId} />
        <input
          key={dueDay ?? ""}
          name="dueDay"
          type="number"
          min={1}
          max={31}
          placeholder="—"
          defaultValue={dueDay ?? ""}
          className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </form>
    </Section>
  );
}

function DebtForm({
  row,
  currency,
  monthKey,
  accountOptions,
  bucketOptions,
  snowballExtraCents,
  isSnowballFocus,
  onAddTransaction,
}: {
  row: RowData;
  currency: string;
  monthKey: string;
  accountOptions: AccountOption[];
  bucketOptions: BucketOption[];
  snowballExtraCents: number;
  isSnowballFocus: boolean;
  onAddTransaction: () => void;
}) {
  const [pending, start] = useTransition();
  const plannedRef = useRef<HTMLInputElement>(null);
  const d = row.debt!;
  // What the Snowball page currently schedules for this debt this month —
  // its min payment, plus the snowball extra if it's the focus debt. This is
  // just informational: "Planned this month" is what YOU'RE budgeting to pay
  // and can differ from the contractual "Min. payment" below it.
  const scheduledCents = d.minCents + (isSnowballFocus ? snowballExtraCents : 0);
  return (
    <Section title="Debt details">
      <form action={(fd) => start(() => upsertDebtAndPlan(fd))} className="space-y-2">
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
        {bucketOptions.length > 0 ? (
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
              Linked bucket
            </span>
            <select
              key={d.linkedBucketId ?? "none"}
              name="bucketId"
              defaultValue={d.linkedBucketId ?? ""}
              className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Not linked</option>
              {(() => {
                const family = bucketOptions.filter((b) => !b.isKids);
                const seen: string[] = [];
                const byAcct = new Map<string, typeof bucketOptions>();
                for (const b of family) {
                  if (!byAcct.has(b.accountName)) { seen.push(b.accountName); byAcct.set(b.accountName, []); }
                  byAcct.get(b.accountName)!.push(b);
                }
                return seen.map((acct) =>
                  <optgroup key={acct} label={acct}>
                    {byAcct.get(acct)!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                );
              })()}
            </select>
            <span className="mt-0.5 block text-[10px] text-muted">
              Pick the sinking-fund bucket you use for this debt (e.g. &quot;Sapphire Payments&quot; on Amex Savings).
              Payments logged here debit that bucket automatically.
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
        <SaveBtn pending={pending} full />
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

function SavingsForm({ row, bucketOptions, monthKey, onAddTransaction }: { row: RowData; bucketOptions: BucketOption[]; monthKey: string; onAddTransaction: () => void }) {
  const [pending, start] = useTransition();
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
      <form action={(fd) => start(() => upsertSavingsGoalAndLink(fd))} className="space-y-2">
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

function AddTxBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft/70"
    >
      +Transaction
    </button>
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
