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
  // Charges the same amount on the same card every cycle. Turns on the one-click
  // "Prev Mo Spent" prefill on this subscription's Due-this-week entry.
  isRecurring: boolean;
  // Derived on the Budget page for this month only, so the card can show
  // Plan / Spent / Left per row. `monthPlannedCents` is cycle-aware: a monthly
  // sub plans every month, an annual one only in its renewal month.
  monthPlannedCents?: number;
  monthSpentCents?: number;
  /**
   * Whether this subscription actually bills in the month being viewed. When
   * it does, its Plan cell edits `amount_cents`; when it doesn't, the cell
   * edits that one month's override (subscription_plans).
   */
  chargesThisMonth?: boolean;
  // What this subscription actually cost last month, matched by payee the same
  // way monthSpentCents is. Feeds the Prev Mo Spent prefill on recurring rows.
  prevSpentCents?: number;
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
  /** Planned for the month being viewed. Absent/0 = nothing budgeted then. */
  plannedCents?: number;
};
