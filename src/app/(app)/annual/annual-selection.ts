import type { CategoryKind } from "@/lib/categories";

/**
 * The trailing Net column of the Months table is selectable too; it maps to
 * the Net card rather than to any one kind.
 */
export type CellKind = CategoryKind | "net";

/**
 * Which hero card a column feeds. Bills and Expenses both roll into the one
 * Spending card, exactly as the unfiltered hero already sums them.
 */
export type CardId = "income" | "spending" | "savings" | "debt" | "net";

export const CARD_FOR_KIND: Record<CellKind, CardId> = {
  income: "income",
  savings: "savings",
  bills: "spending",
  expenses: "spending",
  debt: "debt",
  net: "net",
};

// Color per category kind — matches the hero cards' value color so a reader
// can scan a column and its total tint reads as one thing. Uses the --viz-*
// tokens (never --brand, which is purple) per the app-wide chart color rule.
export const KIND_COLOR: Record<CategoryKind, string> = {
  income: "var(--positive)",
  savings: "var(--viz-savings)",
  bills: "var(--negative)",
  expenses: "var(--negative)",
  debt: "var(--negative)",
};

/**
 * A selected cell carries its own money and provenance. Both tables put the
 * same shape in, so the hero can aggregate a selection without knowing which
 * table it came from — or having to look the figure up again.
 */
export type SelectedCell = {
  kind: CellKind;
  amountCents: number;
  /** null for a whole-year Total cell, which spans every month. */
  monthIdx: number | null;
  /** Which table it was clicked in. Selections don't mix across the two: a
   *  Months cell and a Category row cell can cover the same money, and
   *  summing both would count it twice. */
  source: "months" | "category";
};

export type Selection = Map<string, SelectedCell>;

export const monthsCellKey = (monthIdx: number, kind: CellKind) =>
  `m:${monthIdx}:${kind}`;

export const categoryCellKey = (subId: string, monthIdx: number | null) =>
  `c:${subId}:${monthIdx ?? "year"}`;
