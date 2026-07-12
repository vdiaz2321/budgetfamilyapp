"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { BudgetGroup } from "./budget-group";
import { MonthPicker } from "./month-picker";
import { ItemPanel } from "./item-panel";
import { TransactionsPanel } from "./transactions-panel";
import { SummaryPanel } from "./summary-panel";
import type {
  AccountOption,
  GroupData,
  MonthNav,
  RowData,
  SubOption,
  TxData,
  ViewMode,
} from "./types";

type Props = {
  month: MonthNav;
  currency: string;
  groups: GroupData[];
  incomePlanned: number;
  outflowPlanned: number;
  leftToBudget: number;
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  debtAccountOptions: AccountOption[];
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
  subOptions,
  accountOptions,
  debtAccountOptions,
  snowballExtraCents,
  snowballFocusSubId,
  transactions,
}: Props) {
  const [mode, setMode] = useState<ViewMode>("remaining");
  const [railTab, setRailTab] = useState<"summary" | "transactions">("transactions");
  const [selected, setSelected] = useState<{ subId: string; kind: CategoryKind } | null>(null);
  const toggleMode = () => setMode((m) => (m === "remaining" ? "spent" : "remaining"));
  const positive = leftToBudget >= 0;

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
        snowballExtraCents={snowballExtraCents}
        isSnowballFocus={selected.subId === snowballFocusSubId}
        onClose={() => setSelected(null)}
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
              {formatMoney(leftToBudget, currency)}
            </span>{" "}
            <span className="text-muted">left to budget</span>
          </p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {formatMoney(incomePlanned, currency)} income −{" "}
            {formatMoney(outflowPlanned, currency)} planned
          </p>
        </div>

        {/* Groups */}
        <div className="space-y-3">
          {groups.map((group) => (
            <BudgetGroup
              key={group.categoryId}
              group={group}
              mode={mode}
              onToggleMode={toggleMode}
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
                <SummaryPanel groups={groups} currency={currency} mode={mode} />
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
    </div>
  );
}
