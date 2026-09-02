"use client";

import { CategoryMonthsTable, type CatMonthGroup } from "./category-months-table";
import { AnnualBreakdownHistory, type BreakdownKind } from "./annual-breakdown-history";

type Props = {
  groups: CatMonthGroup[];
  monthLabels: string[];
  kinds: BreakdownKind[];
  years: number[];
  netByYear: Record<number, number>;
  currency: string;
};

/**
 * The year's two big drill-down panels, side by side from `lg` up whether
 * they're open or shut — opening one must never push the other off the bottom
 * of the page. Each keeps its own horizontal scroller for the columns that
 * don't fit in half a screen, newest period first so what's in view is what's
 * worth reading.
 */
export function AnnualPanels({ groups, monthLabels, kinds, years, netByYear, currency }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0">
        <CategoryMonthsTable groups={groups} monthLabels={monthLabels} currency={currency} />
      </div>
      <div className="min-w-0">
        <AnnualBreakdownHistory
          kinds={kinds}
          years={years}
          netByYear={netByYear}
          currency={currency}
        />
      </div>
    </div>
  );
}
