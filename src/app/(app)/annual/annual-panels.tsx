"use client";

import type { CategoryKind } from "@/lib/categories";
import { MonthsTable, type MonthRow } from "./months-table";
import { CategoryMonthsTable, type CatMonthGroup } from "./category-months-table";
import { AnnualBreakdownHistory, type BreakdownKind } from "./annual-breakdown-history";

type Props = {
  columns: { kind: CategoryKind; label: string }[];
  monthRows: MonthRow[];
  totals: Record<CategoryKind, number>;
  totalNet: number;
  gridCols: string;
  groups: CatMonthGroup[];
  monthLabels: string[];
  kinds: BreakdownKind[];
  years: number[];
  netByYear: Record<number, number>;
  currency: string;
};

/**
 * The year's drill-downs. Months and Category by Months share the top row from
 * `lg` up — both are this-year tables, and opening one must never push the
 * other off the bottom of the page. Annual Breakdown sits below them at full
 * width: its nine year columns and two-column section layout need the room.
 */
export function AnnualPanels({
  columns, monthRows, totals, totalNet, gridCols,
  groups, monthLabels, kinds, years, netByYear, currency,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <MonthsTable
            columns={columns}
            rows={monthRows}
            totals={totals}
            totalNet={totalNet}
            currency={currency}
            gridCols={gridCols}
          />
        </div>
        <div className="min-w-0">
          <CategoryMonthsTable groups={groups} monthLabels={monthLabels} currency={currency} />
        </div>
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
