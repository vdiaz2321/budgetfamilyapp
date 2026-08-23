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
  // Same idea, but for a bare investment account (TSP, M1, etc.) that has no
  // buckets. Only one of linkedBucketId/linkedAccountId can be set.
  linkedAccountId: string | null;
};

// A target a Savings item can link to. Usually a bucket (with parent account
// label), but bare investment accounts (no buckets) also appear here with
// isBareAccount=true and accountId set — the form encodes their value as
// `account:<uuid>` so the action knows which column to write.
export type BucketOption = {
  id: string;
  name: string;
  accountName: string;
  isKids?: boolean;
  isBareAccount?: boolean;
  accountId?: string;
};

export const DEBT_KINDS = [
  { value: "credit_card", label: "Credit Card Debt" },
  { value: "auto", label: "Auto Loan" },
  { value: "student_loan", label: "Student Loan" },
  { value: "bank_loan", label: "Bank Loan" },
  { value: "real_estate_loan", label: "Mortgage / Real Estate Loan" },
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
  // Linked bucket (e.g. "Sapphire Payments" bucket on Amex Savings) — payments
  // hit that specific bucket instead of the whole account, so sinking-fund
  // tracking stays accurate. Reused from the savings-goal mechanism.
  linkedBucketId: string | null;
};

export type RowData = {
  subId: string;
  categoryId: string;
  name: string;
  dueDay: number | null;
  // Optional account used when the item is manually marked Paid from the
  // upcoming-due card. This is deliberately separate from a Savings link.
  paymentAccountId: string | null;
  plannedCents: number;
  spentCents: number;
  // When true the planned amount is derived from subscriptions/irregular-bills
  // data and cannot be edited directly from the budget row.
  autoPlanned?: boolean;
  // Average actual over the last 3 complete months, or null when this item
  // has no history in that window. Used to sanity-check the planned amount.
  avg3Cents?: number | null;
  savings: SavingsDetail | null;
  debt: DebtDetail | null;
  // True when this row's linked bucket/account belongs to a kids-marked
  // account. Used only to visually subgroup Savings rows on Budget.
  isKids?: boolean;
};

export type GroupData = {
  categoryId: string;
  kind: CategoryKind;
  name: string;
  isSystem: boolean;
  sortOrder: number;
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
  // Budget remaining for this item this month (planned − spent). Shown in
  // the multi-select picker so the user can see how much is left per item.
  remainingCents?: number;
};

// An account option for the add-transaction form.
export type AccountOption = {
  id: string;
  name: string;
  group?: string;
};

// A bucket the transaction modal can attribute an investment contribution to,
// e.g. Fidelity → "Roth IRA Vic". Keyed by parent account_id.
export type InvestBucketOption = {
  id: string;
  name: string;
};
export type BucketsByAccount = Record<string, InvestBucketOption[]>;

// A managed Subscription or Irregular Bill, offered in the transaction
// Payee autocomplete. Selecting one auto-fills the linked budget item (and,
// for subscriptions, the amount) so nothing has to be mapped by hand.
export type PayeeLineItem = {
  name: string;
  amountCents: number | null; // null for irregular bills (only a hint exists)
  subcategoryId: string | null;
  kind: "subscription" | "irregular";
};

// A bill or subscription that is due soon. Pressing Paid opens the normal
// transaction form; it never creates a transaction by itself.
export type DueItem = {
  id: string;
  name: string;
  kind: CategoryKind;
  subId: string;
  dueDate: string; // YYYY-MM-DD
  amountCents: number;
  accountId: string | null;
  accountName: string | null;
  source: "budget" | "subscription";
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
  // A payment from a cash account toward a credit-card account. It affects
  // account balances, but is not new budget spending.
  isCardPayment: boolean;
  cleared: boolean;
  isWithdrawal: boolean;
};
