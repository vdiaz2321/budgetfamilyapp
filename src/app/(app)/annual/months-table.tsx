"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { MoneyCell, periodHeaderClass } from "./annual-cell";
import { ClearSelectionButton } from "./clear-selection-button";
import { YearBand } from "./category-months-table";
import {
  KIND_COLOR,
  monthsCellKey,
  type Selection,
  type SelectedCell,
} from "./annual-selection";

export type MonthRow = {
  idx: number;
  name: string;
  values: Record<CategoryKind, number>;
  net: number;
  status: "past" | "current" | "future";
  hasData: boolean;
};

type Props = {
  columns: { kind: CategoryKind; label: string }[];
  rows: MonthRow[];
  totals: Record<CategoryKind, number>;
  totalNet: number;
  currency: string;
  /** Cells currently driving the hero cards, across both tables. */
  selected: Selection;
  onToggleCell: (key: string, cell: SelectedCell) => void;
  onClearSelection: () => void;
};

export function MonthsTable({
  columns,
  rows,
  totals,
  totalNet,
  currency,
  selected,
  onToggleCell,
  onClearSelection,
}: Props) {
  // Default expanded on fresh login; toggle state survives within-session nav.
  const [collapse, setCollapse] = useSessionCollapse("annual-months", () => ({ open: true }));
  const open = collapse.open;
  const setOpen = (v: boolean) => setCollapse({ open: v });
  const shareOfIncome = (value: number) =>
    totals.income === 0 ? null : (value / totals.income) * 100;

  // Same shape as Category by Months below: one row per kind, months across,
  // newest first, stopping at the last month with anything logged.
  const lastActive = rows.reduce((acc, r) => (r.hasData ? r.idx : acc), -1);
  const monthCount = lastActive >= 0 ? lastActive + 1 : rows.length;
  const months = rows.slice(0, monthCount).reverse();
  // Category by Months sits 12px in from the panel edge (its p-3 wrapper), so
  // the label column and right padding each take 12px more here — that
  // lines the month columns up exactly with the tables below.
  const grid = {
    gridTemplateColumns: `calc(13rem + 12px) minmax(8rem,1fr) repeat(${monthCount},minmax(7rem,1fr))`,
  };
  const track = { minWidth: `calc(${14 + 8 + 7 * monthCount}rem + 24px)` };

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="font-semibold">Months</span>
        {selected.size > 0 ? <ClearSelectionButton onClear={onClearSelection} /> : null}
      </button>

      {open ? (
        <div className="scroll-handle overflow-x-auto border-t border-line">
          <div style={track}>
            {/* Header */}
            <div className="grid items-center gap-2 border-b border-line py-2 pr-7" style={grid}>
              <span className="sticky left-0 z-10 bg-surface pl-7 text-[15px] font-bold uppercase tracking-wide text-foreground">
                Category
              </span>
              <YearBand pad="-my-2">
                <span className="w-full text-center text-[15px] font-bold uppercase tracking-wide text-foreground">
                  Year total
                </span>
              </YearBand>
              {months.map((m) => (
                <span
                  key={m.idx}
                  className={periodHeaderClass(m.status === "current")}
                >
                  {m.name.slice(0, 3)}
                </span>
              ))}
            </div>

            <ul className="divide-y divide-line">
              {columns.map((c) => {
                const percent = shareOfIncome(totals[c.kind]);
                return (
                  <li key={c.kind} className="grid items-center gap-2 py-2 pr-7" style={grid}>
                    <span className="sticky left-0 z-10 bg-surface pl-7 text-[18px] font-medium">
                      {c.label}
                    </span>
                    <YearBand pad="-my-2">
                      <span className="flex w-full flex-col items-center py-1">
                        <span className="text-[18px] font-bold tabular-nums">
                          {formatMoney(totals[c.kind], currency)}
                        </span>
                        {c.kind === "income" ? null : (
                          <span className="text-[11px] font-semibold" style={{ color: KIND_COLOR[c.kind] }}>
                            {percent === null ? "—" : `${percent.toFixed(1)}% of income`}
                          </span>
                        )}
                      </span>
                    </YearBand>
                    {months.map((m) => (
                      <MoneyCell
                        key={m.idx}
                        empty={m.values[c.kind] === 0}
                        color={KIND_COLOR[c.kind]}
                        active={selected.has(monthsCellKey(m.idx, c.kind))}
                        onToggle={() =>
                          onToggleCell(monthsCellKey(m.idx, c.kind), {
                            kind: c.kind,
                            amountCents: m.values[c.kind],
                            monthIdx: m.idx,
                            source: "months",
                          })
                        }
                      >
                        {formatMoney(m.values[c.kind], currency)}
                      </MoneyCell>
                    ))}
                  </li>
                );
              })}
            </ul>

            {/* Net */}
            <div className="grid items-center gap-2 border-t border-line py-2 pr-7" style={grid}>
              <span className="sticky left-0 z-10 bg-surface pl-7 text-[18px] font-bold">Net</span>
              <YearBand pad="-my-2">
                <span
                  className={`flex w-full flex-col items-center py-1 ${
                    totalNet >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  <span className="text-[18px] font-bold tabular-nums">
                    {formatMoney(totalNet, currency)}
                  </span>
                  <span className="text-[11px] font-semibold">
                    {shareOfIncome(totalNet) === null
                      ? "—"
                      : `${shareOfIncome(totalNet)!.toFixed(1)}% of income`}
                  </span>
                </span>
              </YearBand>
              {months.map((m) => (
                <MoneyCell
                  key={m.idx}
                  empty={!m.hasData}
                  color={m.net >= 0 ? "var(--positive)" : "var(--negative)"}
                  className={`font-bold ${m.net >= 0 ? "text-positive" : "text-negative"}`}
                  active={selected.has(monthsCellKey(m.idx, "net"))}
                  onToggle={() =>
                    onToggleCell(monthsCellKey(m.idx, "net"), {
                      kind: "net",
                      amountCents: m.net,
                      monthIdx: m.idx,
                      source: "months",
                    })
                  }
                >
                  {formatMoney(m.net, currency)}
                </MoneyCell>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
