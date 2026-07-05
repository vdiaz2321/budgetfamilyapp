// Universal starter data for a new household — a small, generic set that any
// family can begin with and edit in Settings. Users who already track their
// finances in a spreadsheet should skip the seed and use the importer (Log tab
// → transactions) to bring in their exact vocabulary.

export type SeedCategory = {
  name: string;
  kind: "bills" | "expenses" | "savings" | "debt" | "income";
  subcategories: string[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: "Income",
    kind: "income",
    subcategories: ["Paycheck", "Side income", "Other"],
  },
  {
    name: "Bills",
    kind: "bills",
    subcategories: [
      "Rent / Mortgage",
      "Utilities",
      "Internet",
      "Mobile",
      "Insurance",
      "Subscriptions",
    ],
  },
  {
    name: "Expenses",
    kind: "expenses",
    subcategories: [
      "Groceries",
      "Fuel",
      "Restaurants",
      "Household",
      "Personal care",
      "Entertainment",
      "Clothing",
      "Medical",
      "Travel",
      "Gifts",
    ],
  },
  {
    name: "Savings",
    kind: "savings",
    subcategories: ["Emergency fund", "Retirement", "Investments"],
  },
  {
    name: "Debt",
    kind: "debt",
    subcategories: [],
  },
];

export type SeedAccount = {
  name: string;
  kind: "credit_card" | "cash" | "checking" | "savings_bucket" | "debt_loan";
  holder?: string;
};

export const SEED_ACCOUNTS: SeedAccount[] = [
  { name: "Cash", kind: "cash" },
  { name: "Checking", kind: "checking" },
];
