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
  // The Travel Log spending row this item's trip-tagged purchases count in.
  travelCategory: string | null;
  plannedCents: number;
  // The part of plannedCents that comes from future trips in the Travel Log
  // (Restaurant Travel / Traveling/Trips only), and those trips' names. The
  // rest is what was typed on the Budget.
  tripPlannedCents?: number;
  tripNames?: string[];
  spentCents: number;
  // What this item actually cost last month. Drives the "Prev Mo Spent"
  // prefill; 0 when the item had no activity (the chip stays hidden).
  prevSpentCents: number;
  // Account and payee from last month's most recent transaction on this item,
  // copied forward by the same prefill. Null when the item had no transaction
  // last month, or when that transaction predates the app and never had them.
  prevAccountId: string | null;
  prevPayee: string | null;
  // Marked as a same-amount-every-month item (utilities, paycheck
  // deductions). Only these get the prefill chip — groceries shouldn't.
  isRecurring: boolean;
  // When true the planned amount is derived from subscriptions/irregular-bills
  // data and cannot be edited directly from the budget row.
  autoPlanned?: boolean;
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
  // How much of this item's STORED plan can actually be given back:
  // budget_plans.planned_cents − spent, floored at zero. Deliberately not the
  // same as `remainingCents`: for auto-calculated rows (Subscriptions,
  // Irregular Bills) the displayed plan comes from their own live totals, so a
  // row can show money "left" while its stored plan is fully spent and cannot
  // be trimmed at all.
  trimmableCents?: number;
  // The Travel Log row this item's trip purchases count in
  // (subcategories.travel_category). "other" marks the catch-all item, whose
  // purchases can pick a more exact row on the transaction form.
  travelCategory?: string | null;
  // Restaurant Travel / Traveling/Trips: the items that take trip plans and
  // trip spending. A trip purchase on any other travel item is moved to one.
  receivesTripPlans?: boolean;
};

// An account option for the add-transaction form.
export type AccountOption = {
  id: string;
  name: string;
  group?: string;
  // Shown in the transaction modal's account picker: what a card owes, or
  // what a bank account holds.
  balanceCents?: number;
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
  // Recurring subscriptions carry what they actually cost last month, so the
  // row can offer a one-click prefill at that figure rather than the planned
  // amount. 0 (or absent) means there was nothing to copy and no chip shows.
  prevSpentCents?: number;
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
  // The property this row is attributed to (accounts.kind = 'property').
  propertyId: string | null;
  // The trip this purchase is tagged to (travel_trips.id).
  tripId: string | null;
  // The booking it pays for, as "stay:<id>" / "flight:<id>" / "car:<id>".
  bookingRef: string | null;
  // The Travel Log row picked on the purchase itself, when it overrides the
  // item's (only on the catch-all travel item).
  travelCategory: string | null;
  toAccountId: string | null;
  fromBucketId: string | null;
  toBucketId: string | null;
  kind: CategoryKind | null;
  movementType: "account_transfer" | "card_payment" | "investment_transfer" | null;
  // A payment from a cash account toward a credit-card account. It affects
  // account balances, but is not new budget spending.
  isCardPayment: boolean;
  isTransfer: boolean;
  isInvestmentTransfer: boolean;
  cleared: boolean;
  isWithdrawal: boolean;
  // Every part of a split purchase shares this id (null on a plain one), and
  // each part carries the whole split so the modal can open it as one.
  splitGroupId?: string | null;
  splitParts?: { subId: string; amountCents: number }[];
};

// What the item panel's "Prev Mo Spent" chip hands the transaction modal:
// last month's amount plus, when the history has them, the account and payee
// to copy forward. Undefined instead of a TxPrefill means a blank quick-add.
export type TxPrefill = {
  cents: number;
  accountId: string | null;
  payee: string | null;
  // Subscriptions and irregular bills know their own budget item, so a payment
  // logged from their card can land in the right subcategory without waiting
  // for the payee autocomplete to guess it.
  subId?: string | null;
  kind?: CategoryKind;
};

// The transaction modal's trip pickers: taggable trips and each one's live
// bookings (for "Pays for"), keyed by trip id. See listTripTagging().
export type TripBookingOption = {
  ref: string;
  label: string;
  pocketCents: number;
  isEstimate: boolean;
  pointsCost: number;
  pointsUsed: boolean;
  hasCard: boolean;
};
export type TripTagging = {
  trips: { id: string; name: string; startOn: string | null; endOn: string | null }[];
  bookingsByTrip: Record<string, TripBookingOption[]>;
};

/**
 * A paid-off debt drops out of the Budget — but only in months it has nothing
 * in. The balance is today's, so testing it alone hid a debt from every month,
 * including the ones it was still being paid in: January's Debt read $580.00
 * while Annual, Insights and Debt/Loans all counted $1,532.80.
 */
export function isHiddenPaidOffDebt(kind: string, r: { plannedCents: number; spentCents: number; debt?: { balanceCents: number } | null }): boolean {
  return kind === "debt" && r.debt != null && r.debt.balanceCents <= 0 && r.plannedCents === 0 && r.spentCents === 0;
}
