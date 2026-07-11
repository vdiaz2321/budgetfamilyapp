import type { CategoryKind } from "@/lib/categories";

export type SavingsDetail = {
  goalCents: number;
  startCents: number;
  monthlyCents: number;
};

export type DebtDetail = {
  balanceCents: number;
  minCents: number;
  apr: number;
  dueDay: number | null;
};

export type RowData = {
  subId: string;
  name: string;
  dueDay: number | null;
  plannedCents: number;
  spentCents: number;
  savings: SavingsDetail | null;
  debt: DebtDetail | null;
};

export type GroupData = {
  categoryId: string;
  kind: CategoryKind;
  name: string;
  rows: RowData[];
  plannedTotal: number;
  spentTotal: number;
};

export type MonthNav = {
  key: string;
  label: string;
  prevKey: string;
  nextKey: string;
  firstOfMonth: string;
};

export type ViewMode = "remaining" | "spent";

// A budget item option for the add-transaction form.
export type SubOption = {
  id: string;
  name: string;
  kind: CategoryKind;
};

// An account option for the add-transaction form.
export type AccountOption = {
  id: string;
  name: string;
};

// A transaction shown in the right-rail Log.
export type TxData = {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
  memo: string | null;
  payee: string | null;
  subId: string | null;
  subName: string;
  accountId: string | null;
  kind: CategoryKind | null;
};
