// Seed data for a new household — mirrors the "2026 Budget Tracker_Career Goals"
// Google Sheet exactly. Preserve spellings (e.g. "Genrerous"), spouse names,
// and card suffixes (V = Victor, J = Johana).

export type SeedCategory = {
  name: string;
  kind: "bills" | "expenses" | "savings" | "debt" | "income";
  subcategories: string[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: "Bills",
    kind: "bills",
    subcategories: [
      "Tithes",
      "Internet",
      "Mobile",
      "Sales Taxes",
      "Haircut Boys",
      "Term Life Ins",
      "Renters Ins",
      "Vehicle Ins",
      "Nutrition/Sports",
      "JuicePlus",
      "Federal Taxes",
      "SGLV",
      "Dental Tricare",
      "Social Security",
      "Medicare",
      "School Tuition/Books",
      "School Lunch",
      "Haircut Girls",
      "Talkatone/Phone",
      "Cash",
      "Moms",
      "Subscriptions",
      "Irregular Bills",
    ],
  },
  {
    name: "Expenses",
    kind: "expenses",
    subcategories: [
      "Fuel",
      "Groceries",
      "Hygienes",
      "Household Cleaning",
      "Genrerous Giving/Offering",
      "Restaurants",
      "Johana's Clothing",
      "Victor's Clothing",
      "Boy's Clothing",
      "Hannah's Clothing",
      "Home Improvement",
      "Medicine/Pharmacy",
      "Child Development/CYS",
      "Entertainment",
      "Military Events/clothing",
      "Gifts Expenses",
      "Kids Purchase/Toys",
      "Birthday/Holiday Parties",
      "School Supplies",
      "Farewell/Ministry",
      "Makeup/Beauty Care/Wax/Pedicure",
      "Car Repair Expenses",
      "Electronics/Computer",
      "Travel Restaurants",
      "Traveling Expenses",
    ],
  },
  {
    name: "Savings",
    kind: "savings",
    subcategories: [
      "Fidelity (Taxable)",
      "Roth IRA (Vic)",
      "Roth IRA (Jo)",
      "Crypto",
      "Leo 529",
      "Hannah 529",
      "Ben 529",
      "TSP",
      "M1",
    ],
  },
  {
    name: "Debt",
    kind: "debt",
    subcategories: [
      "Sante Fe 2020 (APR26)",
      "Venture3191J (Jan27)",
      "QuickSil7906V (Jun26)",
      "Savor2946J (Mar26)",
      "Venture1 1163V(Feb27)",
    ],
  },
  {
    name: "Income",
    kind: "income",
    subcategories: [],
  },
];

export type SeedAccount = {
  name: string;
  kind: "credit_card" | "cash" | "checking" | "savings_bucket" | "debt_loan";
  holder?: "V" | "J";
};

export const SEED_ACCOUNTS: SeedAccount[] = [
  { name: "1175 Sapphire V", kind: "credit_card", holder: "V" },
  { name: "3191 VentureJ", kind: "credit_card", holder: "J" },
  { name: "1004Plat Amex V", kind: "credit_card", holder: "V" },
  { name: "1009 Gold Amex V", kind: "credit_card", holder: "V" },
  { name: "1002 Hilton Aspire Amex V", kind: "credit_card", holder: "V" },
  { name: "1003 Delta Amex V", kind: "credit_card", holder: "V" },
  { name: "2004 Bonvoy Amex V", kind: "credit_card", holder: "V" },
  { name: "1007 Brilliant Amex V", kind: "credit_card", holder: "V" },
  { name: "1005 Reserve Delta Amex V", kind: "credit_card", holder: "V" },
  { name: "0809 Hyatt Chase V", kind: "credit_card", holder: "V" },
  { name: "4569 IHG Chase V", kind: "credit_card", holder: "V" },
  { name: "8864 IHG Chase J", kind: "credit_card", holder: "J" },
  { name: "7906 QuickSilver V", kind: "credit_card", holder: "V" },
  { name: "Cash", kind: "cash" },
];
