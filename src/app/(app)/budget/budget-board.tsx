"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { setRollover } from "./actions";
import { BudgetGroup } from "./budget-group";
import { MonthPicker } from "./month-picker";
import { ItemPanel } from "./item-panel";
import { TransactionsPanel } from "./transactions-panel";
import { TransactionModal } from "./transaction-modal";
import { SummaryPanel } from "./summary-panel";
import type {
  AccountOption,
  BucketOption,
  GroupData,
  MonthNav,
  RowData,
  SubOption,
  TxData,
} from "./types";

type Props = {
  month: MonthNav;
  currency: string;
  groups: GroupData[];
  incomePlanned: number;
  outflowPlanned: number;
  leftToBudget: number;
  rollover: {
    inCents: number; // amount actually rolled in this month (0 if excluded)
    availableCents: number; // last month's leftover, regardless of the toggle
    enabled: boolean; // is last month's leftover included in this month?
    prevMonthLabel: string;
  };
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  debtAccountOptions: AccountOption[];
  bucketOptions: BucketOption[];
  snowballExtraCents: number;
  snowballFocusSubId: string | null;
  transactions: TxData[];
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
  snowballExtraCents,
  snowballFocusSubId,
  transactions,
}: Props) {
  const [railTab, setRailTab] = useState<"summary" | "transactions">("transactions");
  const [selected, setSelected] = useState<{ subId: string; kind: CategoryKind } | null>(null);
  // Set from the item panel's "+ Add transaction" button so it doesn't
  // require switching to the Log tab first.
  const [quickAdd, setQuickAdd] = useState(false);

  // Waterfall: assignments spend this month's own income first; any shortfall
  // then draws down the rolled-in buffer, and only once that's exhausted does
  // "left to budget" actually go negative. Keeps the two numbers split while
  // making the rollover real spendable money.
  const rolledIn = rollover.inCents;
  const ownLeft = leftToBudget; // incomePlanned − outflowPlanned
  const rolloverDrawn = Math.min(Math.max(0, -ownLeft), rolledIn);
  const rolloverRemaining = rolledIn - rolloverDrawn;
  const displayLeft = ownLeft + rolloverDrawn; // 0 while the buffer covers it
  const positive = displayLeft >= 0;

  // Actuals for the pill: what's actually been received vs actually spent so
  // far this month (income group's spent = money received).
  const actualIncome = groups
    .filter((g) => g.kind === "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);
  const actualSpent = groups
    .filter((g) => g.kind !== "income")
    .reduce((sum, g) => sum + g.spentTotal, 0);
  // What's really left of the cash you've actually received this month.
  const actualLeft = actualIncome - actualSpent;

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
        debtAccountOptions={debtAccountOptions}
        bucketOptions={bucketOptions}
        snowballExtraCents={snowballExtraCents}
        isSnowballFocus={selected.subId === snowballFocusSubId}
        onClose={() => setSelected(null)}
        onAddTransaction={() => setQuickAdd(true)}
      />
    ) : null;

  return (
    <div className="mx-auto flex max-w-5xl items-start justify-center gap-6">
      {/* Budget column */}
      <div className="w-full min-w-0 max-w-[620px] space-y-4">
        <MonthPicker monthKey={month.key} />

        {/* Left-to-budget pill */}
        <div className="rounded-2xl bg-surface px-6 py-3.5 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-base">
            <span className={`font-bold tabular-nums ${positive ? "text-positive" : "text-negative"}`}>
              {formatMoney(displayLeft, currency)}
            </span>{" "}
            <span className="text-muted">left to budget planned</span>
          </p>
          <p className="text-base">
            <span className={`font-bold tabular-nums ${actualLeft >= 0 ? "text-positive" : "text-negative"}`}>
              {formatMoney(actualLeft, currency)}
            </span>{" "}
            <span className="text-muted">actual left to spend</span>
          </p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {formatMoney(incomePlanned, currency)} income planned −{" "}
            {formatMoney(outflowPlanned, currency)} planned expenses
          </p>
          <p className="text-xs text-muted tabular-nums">
            {formatMoney(actualIncome, currency)} actual income received −{" "}
            {formatMoney(actualSpent, currency)} actual spent
          </p>
          {rolledIn !== 0 ? (
            <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-muted tabular-nums">
              <span className="font-semibold text-brand">
                {formatMoney(rolloverRemaining, currency)}
              </span>{" "}
              {rolloverDrawn > 0 ? (
                <>
                  left of {formatMoney(rolledIn, currency)} rolled in from{" "}
                  {rollover.prevMonthLabel}
                </>
              ) : (
                <>rolled in from {rollover.prevMonthLabel}, available to spend</>
              )}
            </p>
          ) : null}
        </div>

        {/* Rollover: include last month's leftover cash in this month */}
        <RolloverBar
          monthFirstOfMonth={month.firstOfMonth}
          rollover={rollover}
          currency={currency}
        />

        {/* Groups */}
        <div className="space-y-3">
          {groups.map((group) => (
            <BudgetGroup
              key={group.categoryId}
              group={group}
              currency={currency}
              monthKey={month.firstOfMonth}
              selectedSubId={selected?.subId ?? null}
              onSelectRow={(row, kind) => setSelected({ subId: row.subId, kind })}
            />
          ))}
        </div>
      </div>

      {/* Right rail: item detail when selected, otherwise Summary / Log */}
      <aside className="hidden w-[360px] shrink-0 lg:block">
        <div className="sticky top-20 space-y-3">
          {itemPanel ?? (
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
                  onClick={() => setRailTab("transactions")}
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
                <SummaryPanel groups={groups} currency={currency} />
              ) : (
                <TransactionsPanel
                  monthKey={month.key}
                  monthLabel={month.label}
                  firstOfMonth={month.firstOfMonth}
                  currency={currency}
                  transactions={transactions}
                  subOptions={subOptions}
                  accountOptions={accountOptions}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* Mobile: item detail slides over */}
      {itemPanel ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[380px] overflow-y-auto bg-background p-2">
            {itemPanel}
          </div>
        </div>
      ) : null}

      {quickAdd && selected ? (
        <TransactionModal
          editTx={null}
          monthKey={month.key}
          firstOfMonth={month.firstOfMonth}
          subOptions={subOptions}
          accountOptions={accountOptions}
          initialKind={selected.kind}
          initialSubId={selected.subId}
          onClose={() => setQuickAdd(false)}
        />
      ) : null}
    </div>
  );
}

function RolloverBar({
  monthFirstOfMonth,
  rollover,
  currency,
}: {
  monthFirstOfMonth: string;
  rollover: Props["rollover"];
  currency: string;
}) {
  const [pending, start] = useTransition();
  const { availableCents, enabled, prevMonthLabel } = rollover;

  // Nothing left over from last month, and it isn't already on → no control.
  if (availableCents <= 0 && !enabled) return null;

  const amount = formatMoney(Math.max(0, availableCents), currency);

  return (
    <form
      action={(fd) => start(() => setRollover(fd))}
      className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-sm ring-1 ${
        enabled
          ? "bg-brand-soft/50 ring-brand/30"
          : "bg-surface ring-black/5 dark:ring-white/10"
      }`}
    >
      <input type="hidden" name="month" value={monthFirstOfMonth} />
      {/* Toggling: submit the opposite of the current state. */}
      <input type="hidden" name="enable" value={enabled ? "" : "on"} />
      <span className={enabled ? "text-brand" : "text-muted"}>
        {enabled ? (
          <>
            Including <span className="font-semibold tabular-nums">{amount}</span> rolled in from{" "}
            {prevMonthLabel}
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{amount}</span> left unspent in {prevMonthLabel}
          </>
        )}
      </span>
      <button
        type="submit"
        disabled={pending}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
          enabled
            ? "text-brand hover:bg-white/40 dark:hover:bg-white/10"
            : "bg-brand text-white hover:bg-brand-strong"
        }`}
      >
        {pending ? "Saving…" : enabled ? "Undo" : "Roll in"}
      </button>
    </form>
  );
}
