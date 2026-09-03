import type { CategoryKind } from "@/lib/categories";

/**
 * A cell in the Months table is addressed by its month index (0-11) and the
 * column it sits under. "net" is the trailing Net column, which maps to the
 * Net hero card rather than to any one kind.
 */
export type CellKind = CategoryKind | "net";
export type CellKey = `${number}:${CellKind}`;

export const cellKey = (monthIdx: number, kind: CellKind): CellKey =>
  `${monthIdx}:${kind}`;

export const parseCellKey = (key: string): { monthIdx: number; kind: CellKind } => {
  const [idx, kind] = key.split(":");
  return { monthIdx: Number(idx), kind: kind as CellKind };
};

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
