import type { CategoryKind } from "@/lib/categories";

export type SavingsDetail = {
  goalCents: number;
  startCents: number;
  monthlyCents: number;
  // When set, the dashboard checks whether the Monthly amount is on pace to
  // reach the Goal by this date instead of just tracking raw progress.
  targetDate: string | null; // YYYY-MM-DD
  // The bucket (over on Accounts) this savings item contributes to — once
  // linked, logged transactions add/subtract from its balance automatically.
  linkedBucketId: string | null;
};

// A bucket a Savings item can link to, labeled with its parent account.
export type BucketOption = {
  id: string;
  name: string;
  accountName: string;
  isKids?: boolean;
};

export const DEBT_KINDS = [
  { value: "credit_card", label: "Credit Card" },
  { value: "auto", label: "Auto" },
  { value: "student_loan", label: "Student Loan" },
  { value: "bank_loan", label: "Bank Loan" },
  { value: "real_estate_loan", label: "Real Estate Loan" },
  { value: "medical", label: "Medical" },
  { value: "family", label: "Family" },
  { value: "other", label: "Other" },
] as const;

export type DebtDetail = {
  balanceCents: number;
  minCents: number;
  apr: number;
  dueDay: number | null;
  debtKind: string | null;
  notes: string | null;
  promoAprEndsOn: string | null; // YYYY-MM-DD
  // Linked account (e.g. the credit card this debt represents) — Networth
  // skips the account's balance so it isn't counted twice.
  accountId: string | null;
};

export type RowData = {
  subId: string;
  name: string;
  dueDay: number | null;
  plannedCents: number;
  spentCents: number;
  // Up to the last 6 months of actuals for this subcategory, chronological,
  // sparse (no zero-fill) — the row hides its sparkline below 2 points.
  sparkline: number[];
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
  // Set only for Savings items linked to a bucket — lets the transaction
  // form offer the withdrawal toggle for those.
  linkedBucketId?: string | null;
};

// An account option for the add-transaction form.
export type AccountOption = {
  id: string;
  name: string;
  group?: string;
};

// A managed Subscription or Irregular Bill, offered in the transaction
// Payee autocomplete. Selecting one auto-fills the linked budget item (and,
// for subscriptions, the amount) so nothing has to be mapped by hand.
export type PayeeLineItem = {
  name: string;
  amountCents: number | null; // null for irregular bills (only a hint exists)
  subcategoryId: string | null;
  kind: "subscription" | "irregular";
};

// A transaction shown in the right-rail Log and the Transactions page.
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
  cleared: boolean;
  isWithdrawal: boolean;
};
