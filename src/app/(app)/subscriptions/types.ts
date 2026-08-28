export type SubscriptionRow = {
  id: string;
  name: string;
  amountCents: number;
  billingCycle: "monthly" | "annual" | "quarterly" | "weekly";
  nextRenewalDate: string | null; // YYYY-MM-DD
  isActive: boolean;
  updatedAt: string | null; // ISO timestamp — used to keep deactivated rows visible until year-end
  subcategoryId: string | null;
  accountId: string | null;
  notes: string | null;
  sortOrder: number;
  // Derived on the Budget page for this month only, so the card can show
  // Plan / Spent / Left per row. `monthPlannedCents` is cycle-aware: a monthly
  // sub plans every month, an annual one only in its renewal month.
  monthPlannedCents?: number;
  monthSpentCents?: number;
};

export type IrregularBillRow = {
  id: string;
  name: string;
  typicalAmountCents: number;
  subcategoryId: string | null;
  accountId: string | null;
  notes: string | null;
  sortOrder: number;
  // Derived from this month's logged transactions. These values are display
  // detail only; the shared Budget "Irregular Bills" row remains the source
  // that rolls into Bills and the Annual Overview.
  monthSpentCents?: number;
  monthAccountNames?: string[];
};
