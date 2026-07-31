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
};

export type IrregularBillRow = {
  id: string;
  name: string;
  typicalAmountCents: number;
  subcategoryId: string | null;
  accountId: string | null;
  notes: string | null;
  sortOrder: number;
};
