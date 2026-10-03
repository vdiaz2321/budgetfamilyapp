"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryKind } from "@/lib/categories";
import { AnnualHero, type HeroFilter } from "./annual-hero";
import { MonthsTable, type MonthRow } from "./months-table";
import { CategoryMonthsTable, type CatMonthGroup } from "./category-months-table";
import { AnnualBreakdownHistory, type BreakdownKind } from "./annual-breakdown-history";
import { PropertyRollupPanel, type PropertyRollup } from "./property-rollup";
import {
  CARD_FOR_KIND,
  type CardId,
  type Selection,
  type SelectedCell,
} from "./annual-selection";

type Props = {
  year: number;
  outflowKinds: CategoryKind[];
  columns: { kind: CategoryKind; label: string }[];
  monthRows: MonthRow[];
  totals: Record<CategoryKind, number>;
  totalNet: number;
  groups: CatMonthGroup[];
  monthLabels: string[];
  properties: PropertyRollup[];
  kinds: BreakdownKind[];
  years: number[];
  netByYear: Record<number, number>;
  currency: string;
};

const CARD_ORDER: CardId[] = ["income", "spending", "savings", "debt", "net"];
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
  year, outflowKinds, columns, monthRows, totals, totalNet,
  groups, monthLabels, properties, kinds, years, netByYear, currency,
}: Props) {
  const currentMonthIdx = monthRows.find((r) => r.status === "current")?.idx;
  const currentMonthLabel = currentMonthIdx === undefined ? null : monthLabels[currentMonthIdx];
  const [selected, setSelected] = useState<Selection>(() => new Map());

  const toggleCell = (key: string, cell: SelectedCell) => {
    setSelected((prev) => {
      // A selection lives in one table at a time. Months' "Aug bills" and
      // Category's "Groceries, Aug" describe the same money from different
      // angles; adding them together would count it twice, so starting a
      // selection in one table drops the other's.
      const sameSource =
        prev.size === 0 || prev.values().next().value?.source === cell.source;
      const next = sameSource ? new Map(prev) : new Map<string, SelectedCell>();
      if (next.has(key)) next.delete(key);
      else next.set(key, cell);
      return next;
    });
  };
  const clear = () => setSelected(new Map());

  // The hero is pinned at the top, so anything else that sticks (the month
  // headers in Category by Months) has to stick just below it. Its height
  // changes with the filter and with screen width, so it is measured.
  const scopeRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    const scope = scopeRef.current;
    if (!hero || !scope) return;
    const observer = new ResizeObserver(() => {
      scope.style.setProperty("--annual-hero-h", `${hero.offsetHeight}px`);
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const filter = useMemo<HeroFilter | null>(() => {
    if (selected.size === 0) return null;

    const sums = { income: 0, spending: 0, savings: 0, debt: 0, net: 0 } as Record<CardId, number>;
    // Distinct months per card, for the "N months selected" caption.
    const months: Record<CardId, Set<number>> = {
      income: new Set(), spending: new Set(), savings: new Set(),
      debt: new Set(), net: new Set(),
    };
    // Whole-year Total cells belong to no single month; they caption as
    // "full year" instead of counting as a month.
    const wholeYear = new Set<CardId>();
    const touched = new Set<CardId>();

    for (const cell of selected.values()) {
      const card = CARD_FOR_KIND[cell.kind];
      sums[card] += cell.amountCents;
      touched.add(card);
      if (cell.monthIdx === null) wholeYear.add(card);
      else months[card].add(cell.monthIdx);
    }

    // Net is the point of the selection, not another column of it: whatever
    // cells are chosen, the card answers "what does this leave me". Income
    // less the outflows, exactly as the year's own Net card is built. A Net
    // cell picked directly is already that month's income less its outflows,
    // so it folds into the same sum rather than competing with it.
    sums.net += sums.income - sums.spending - sums.savings - sums.debt;

    // A count, not a list: "Apr, May, Jun, Jul, Aug, Sep" wrapped the card to
    // three lines, and the outlined cells already show which months they are.
    const captions = {} as Record<CardId, string>;
    for (const card of CARD_ORDER) {
      const n = months[card].size;
      const parts = [
        wholeYear.has(card) ? "full year" : "",
        n ? `${n} month${n === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      captions[card] = parts.length ? `${parts.join(" + ")} selected` : "";
    }
    captions.net = `net of ${selected.size} selected cell${selected.size === 1 ? "" : "s"}`;

    // Net earns its slot once the selection spans more than one card, where
    // "what does this leave me" is a real question. Against a single card it
    // would only restate that card with the sign flipped.
    const filled = CARD_ORDER.filter((c) => c !== "net" && touched.has(c));
    const showNet = filled.length > 1 || touched.has("net");

    // Difference: when one card's cells cover two or more months, the newest
    // month less the oldest ("Sep vs Aug"). Only for a single card — across
    // cards the Net card already answers the question, and subtracting Aug
    // income from Sep groceries means nothing. Whole-year cells have no month
    // to stand in, so they sit out.
    let difference: HeroFilter["difference"] = null;
    if (touched.size === 1) {
      const [card] = touched;
      const byMonth = new Map<number, number>();
      for (const cell of selected.values()) {
        if (cell.monthIdx === null) continue;
        byMonth.set(cell.monthIdx, (byMonth.get(cell.monthIdx) ?? 0) + cell.amountCents);
      }
      if (byMonth.size >= 2) {
        const ordered = [...byMonth.keys()].sort((a, b) => a - b);
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        difference = {
          cents: byMonth.get(last)! - byMonth.get(first)!,
          caption: `${MONTH_ABBR[last]} vs ${MONTH_ABBR[first]}`,
          upIsGood: card === "income" || card === "savings" || card === "net",
        };
      }
    }

    return {
      cards: CARD_ORDER.filter((c) => (c === "net" ? showNet : touched.has(c))),
      sums,
      captions,
      difference,
    };
  }, [selected]);

  return (
    <div className="space-y-4">
      {/* Sticky scope for the hero: it stays pinned across these three panels
          and scrolls away with the last of them. */}
      <div ref={scopeRef} className="space-y-4">
        <div ref={heroRef} className="sticky top-0 z-30 bg-background pb-3 pt-2">
          <AnnualHero
            year={year}
            outflowKinds={outflowKinds}
            totals={totals}
            currency={currency}
            filter={filter}
            onClear={clear}
          />
        </div>

        {/* One panel per row. Side by side, Months' old fixed columns left
            it a small island in half an empty
            panel, and neither table got the width its figures wanted. Stacked,
            each one gets the whole page. */}
        <div className="min-w-0">
          <MonthsTable
            columns={columns}
            rows={monthRows}
            totals={totals}
            totalNet={totalNet}
            currency={currency}
            selected={selected}
            onToggleCell={toggleCell}
          />
        </div>
        <div className="min-w-0">
          <CategoryMonthsTable
            groups={groups}
            monthLabels={monthLabels}
            currentMonthLabel={currentMonthLabel}
            currency={currency}
            selected={selected}
            onToggleCell={toggleCell}
          />
        </div>

        {properties.length > 0 ? (
          <PropertyRollupPanel
            properties={properties}
            monthLabels={monthLabels}
            currentMonthLabel={currentMonthLabel}
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
