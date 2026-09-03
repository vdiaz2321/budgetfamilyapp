"use client";

import { useMemo, useState } from "react";
import type { CategoryKind } from "@/lib/categories";
import { AnnualHero, type HeroFilter } from "./annual-hero";
import { MonthsTable, type MonthRow } from "./months-table";
import { CategoryMonthsTable, type CatMonthGroup } from "./category-months-table";
import { AnnualBreakdownHistory, type BreakdownKind } from "./annual-breakdown-history";
import { PropertyRollupPanel, type PropertyRollup } from "./property-rollup";
import {
  CARD_FOR_KIND,
  cellKey,
  parseCellKey,
  type CardId,
  type CellKind,
} from "./annual-selection";

type Props = {
  year: number;
  outflowKinds: CategoryKind[];
  columns: { kind: CategoryKind; label: string }[];
  monthRows: MonthRow[];
  totals: Record<CategoryKind, number>;
  totalNet: number;
  gridCols: string;
  groups: CatMonthGroup[];
  monthLabels: string[];
  properties: PropertyRollup[];
  kinds: BreakdownKind[];
  years: number[];
  netByYear: Record<number, number>;
  currency: string;
};

const CARD_ORDER: CardId[] = ["income", "spending", "savings", "debt", "net"];

/**
 * The year's drill-downs, plus the hero cards they drive.
 *
 * The hero is `sticky` inside the block that holds Months, Category by Months
 * and Properties — every panel whose figures it summarises — so it rides down
 * the page with them and releases exactly when Annual Breakdown (a different
 * question: nine years, not this one) reaches the top.
 *
 * Clicking money cells in Months filters the hero: only the cards those cells
 * feed stay, each showing the selected cells' sum. Bills and Expenses both
 * feed Spending, which is how the unfiltered card is built too.
 */
export function AnnualPanels({
  year, outflowKinds, columns, monthRows, totals, totalNet, gridCols,
  groups, monthLabels, properties, kinds, years, netByYear, currency,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleCell = (monthIdx: number, kind: CellKind) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = cellKey(monthIdx, kind);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const clear = () => setSelected(new Set());

  const filter = useMemo<HeroFilter | null>(() => {
    if (selected.size === 0) return null;

    const sums = { income: 0, spending: 0, savings: 0, debt: 0, net: 0 } as Record<CardId, number>;
    // Months per card, kept as indexes so the caption reads in calendar order
    // rather than click order.
    const months: Record<CardId, Set<number>> = {
      income: new Set(), spending: new Set(), savings: new Set(),
      debt: new Set(), net: new Set(),
    };
    const kindsUsed: Record<CardId, Set<CellKind>> = {
      income: new Set(), spending: new Set(), savings: new Set(),
      debt: new Set(), net: new Set(),
    };
    const rowByIdx = new Map(monthRows.map((r) => [r.idx, r]));

    for (const key of selected) {
      const { monthIdx, kind } = parseCellKey(key);
      const row = rowByIdx.get(monthIdx);
      if (!row) continue;
      const card = CARD_FOR_KIND[kind];
      sums[card] += kind === "net" ? row.net : row.values[kind];
      months[card].add(monthIdx);
      kindsUsed[card].add(kind);
    }

    // Net is the point of the selection, not another column of it: whatever
    // cells are chosen, the card answers "what does this leave me". Income
    // less the outflows, exactly as the year's own Net card is built. A Net
    // cell picked directly is already that month's income less its outflows,
    // so it folds into the same sum rather than competing with it.
    sums.net += sums.income - sums.spending - sums.savings - sums.debt;

    const captions = {} as Record<CardId, string>;
    for (const card of CARD_ORDER) {
      const monthPart = [...months[card]]
        .sort((a, b) => a - b)
        .map((i) => rowByIdx.get(i)?.name.slice(0, 3) ?? "")
        .join(", ");
      // Spending is the only card fed by two columns, so it is the only one
      // that has to say which of them a total came from.
      const kindPart =
        card === "spending" && kindsUsed[card].size > 0
          ? ` · ${[...kindsUsed[card]].sort().join(" + ")}`
          : "";
      captions[card] = monthPart ? `${monthPart}${kindPart}` : "";
    }

    captions.net = `net of ${selected.size} selected cell${selected.size === 1 ? "" : "s"}`;

    // Net earns its slot once the selection spans more than one card, where
    // "what does this leave me" is a real question. Against a single card it
    // would only restate that card with the sign flipped.
    const filled = CARD_ORDER.filter((c) => c !== "net" && months[c].size > 0);
    const showNet = filled.length > 1 || months.net.size > 0;

    return {
      cards: CARD_ORDER.filter((c) => (c === "net" ? showNet : months[c].size > 0)),
      sums,
      captions,
    };
  }, [selected, monthRows]);

  return (
    <div className="space-y-4">
      {/* Sticky scope for the hero: it stays pinned across these three panels
          and scrolls away with the last of them. */}
      <div className="space-y-4">
        <div className="sticky top-0 z-30 bg-background pb-3 pt-2">
          <AnnualHero
            year={year}
            outflowKinds={outflowKinds}
            totals={totals}
            currency={currency}
            filter={filter}
            onClear={clear}
          />
        </div>

        {/* One panel per row. Side by side, Months' deliberately fixed columns
            (see gridCols in page.tsx) left it a small island in half an empty
            panel, and neither table got the width its figures wanted. Stacked,
            each one gets the whole page. */}
        <div className="min-w-0">
          <MonthsTable
            columns={columns}
            rows={monthRows}
            totals={totals}
            totalNet={totalNet}
            currency={currency}
            gridCols={gridCols}
            selected={selected}
            onToggleCell={toggleCell}
            onClearSelection={clear}
          />
        </div>
        <div className="min-w-0">
          <CategoryMonthsTable groups={groups} monthLabels={monthLabels} currency={currency} />
        </div>

        {properties.length > 0 ? (
          <PropertyRollupPanel
            properties={properties}
            monthLabels={monthLabels}
            currency={currency}
          />
        ) : null}
      </div>

      <AnnualBreakdownHistory
        kinds={kinds}
        years={years}
        netByYear={netByYear}
        currency={currency}
      />
    </div>
  );
}
