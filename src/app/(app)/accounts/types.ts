// Shared account shapes.
//
// These live outside accounts-board.tsx because the Travel & Credit Card
// Rewards section moved to /travel: both boards now speak the same account
// vocabulary, and a type file is the one place neither has to import the
// other's 2,000 lines to get it.

export type BucketData = {
  id: string;
  accountId: string;
  name: string;
  balanceCents: number;
  // Its own Checking/Savings tag — accounts with a mix of both (e.g. a
  // "Checking" bucket and a "Savings" bucket under one bank account) no
  // longer have to force the whole account into one type.
  bankGroup: "savings" | "spending" | null;
  taxTreatment: string | null;
  // Which contribution limit governs this bucket, and whose money it is. Both
  // live on the bucket as well as the account because one brokerage can hold a
  // Roth for each spouse alongside a taxable bucket.
  retirementKind: string | null;
  holder: string | null;
  // Every recorded month of bucket_snapshots, keyed "YYYY-MM-01" (a missing
  // month = never recorded). Lets a bucket row follow the header's period
  // picker instead of being pinned to the last three months.
  balancesByMonth: Record<string, number>;
};

export type CardDetails = {
  rewardsCategory: "travel" | "hotel" | null;
  rewardsProgram: string | null;
  pointsValueMicros: number | null;
  five24Countable: boolean;
  bank: string | null;
  authUser: string | null;
  charging: string | null;
  bonusInfo: string | null;
  bonusSpendCents: number | null;
  bonusSpendDeadline: string | null;
  bonusEarned: boolean;
  currentPoints: number;
  feesPaidCents: number;
  freeNightCreditCents: number | null;
  freeNightExpiresOn: string | null;
  freeNightPointsLimit: number | null;
  benefitUsedOn: string | null;
  spendingLimitCents: number | null;
  remarks: string | null;
  isRevolvingDebt: boolean;
  debtSubcategoryId: string | null;
  cardUrl: string | null;
  benefitCadence: string | null;
  payoffBalanceCents: number;
  payoffMinimumCents: number;
  payoffPlannedCents: number;
  payoffApr: number;
  payoffDueDay: number | null;
  promoAprEndsOn: string | null;
};

// What a user can log by hand: points out (a redemption) and points in (what
// everyday spending earned). Hotel credit and free nights are logged on the
// stay itself; refunds are written by the Travel Log when a stay is edited
// down, cancelled or deleted.
export type RewardLogType =
  | "points_redemption"
  | "points_earned"
  | "hotel_credit_redemption"
  | "free_night_booking";

export type RewardActivity = {
  id: string;
  type: RewardLogType | "reward_refund";
  occurredOn: string;
  pointsDelta: number;
  hotelCreditDeltaCents: number;
  bookedOn: string | null;
  note: string | null;
};

export type AccountData = {
  id: string;
  name: string;
  kind: string; // account_kind enum value
  subtype: string | null; // free-text label, e.g. "Roth IRA", "Trump Account", "UTMA"
  holder: string | null;
  institution: string | null;
  accountNumber: string | null;
  ownership: "sole" | "joint";
  debtTrackingMode: "budget" | "account";
  active: boolean;
  isKidsAccount: boolean;
  bankGroup: "savings" | "spending" | null;
  taxTreatment: string | null;
  retirementKind: string | null;
  balanceCents: number;
  annualFeeCents: number | null;
  feeWaived: boolean;
  dateOpened: string | null;
  dateClosed: string | null;
  // Credit-card only. Auto-computed on the server for CCs.
  cardDetails?: CardDetails | null;
  rewardActivities: RewardActivity[];
  owedCents?: number;
  monthSpendCents?: number;
  // Prior-month account_snapshots (null = never recorded yet for that month).
  // For bucketed accounts these are derived server-side from bucket_snapshots.
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
  // Every snapshot the server has for this account, keyed by "YYYY-MM-01".
  // Lets the header's period picker resolve the section total to a chosen
  // historical month/quarter/year without another round trip.
  balancesByMonth?: Record<string, number>;
  buckets: BucketData[];
};

// Non-CC accounts, passed in for the Pay Card modal's "From" dropdown.
export type NonCardAccount = {
  id: string;
  name: string;
  kind: string;
  hasBuckets: boolean;
};


// A debt from the Budget Debt group — shown here read-only (Budget is the
// single source of truth for debts).
export type BudgetDebt = {
  subcategoryId: string;
  name: string;
  balanceCents: number;
  prevMonthCents: number | null;
  prev2MonthCents: number | null;
  // Every snapshot recorded for this debt subcategory, keyed by "YYYY-MM-01".
  // Powers the header period picker's Debts / Net Worth totals + deltas.
  balancesByMonth?: Record<string, number>;
  debtKind: string | null;
  accountId: string | null;
};

// The plan's account types, mapped onto the account_kind enum. debt_loan is
// legacy/managed from Budget → shown only if rows exist. Kids Funding is its
// own group by the is_kids_account flag, not by kind — it can hold checking,
// savings, or investment accounts (Fidelity, Capital One, a Trump Account…).
export type Section = {
  key: string;
  label: string;
  dot: string;
  liability: boolean;
  // Which accounts belong here.
  match: (a: AccountData) => boolean;
  // Sub-kind choices offered by the add form (label per kind).
  kindLabels: Record<string, string>;
  fixedKind?: string;
  // Free-text "Type" field (e.g. Retirement, Roth IRA, 529, Trump Account).
  offerSubtype?: boolean;
  // A fixed Type vocabulary for this section, in place of free text.
  subtypeOptions?: string[];
  kidsGroup?: boolean;
  creditCard?: boolean;
};


// The three credit-card sections. Defined here (rather than inline in
// SECTIONS) because the rewards board on /travel renders the very same
// groups — one definition, so "what counts as a closed card" can't drift
// between the two pages.
export const CREDIT_SECTIONS: Section[] = [
  {
    key: "credit",
    label: "Credit Cards",
    dot: "bg-negative",
    liability: false,
    match: (a) => a.kind === "credit_card" && !a.dateClosed,
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
  {
    key: "credit_closed",
    label: `Closed cards · ${new Date().getFullYear()}`,
    dot: "bg-negative",
    liability: false,
    match: (a) => {
      if (a.kind !== "credit_card" || !a.dateClosed) return false;
      const closedYear = new Date(a.dateClosed).getFullYear();
      return closedYear === new Date().getFullYear();
    },
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
  {
    key: "credit_archived",
    label: "Closed cards archive",
    dot: "bg-muted",
    liability: false,
    match: (a) => {
      if (a.kind !== "credit_card" || !a.dateClosed) return false;
      const closedYear = new Date(a.dateClosed).getFullYear();
      return closedYear < new Date().getFullYear();
    },
    kindLabels: { credit_card: "Credit card" },
    offerSubtype: true,
    creditCard: true,
  },
];
