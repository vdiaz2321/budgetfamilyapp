// The pure half of the Transactions CSV import: which file column feeds which
// field, and what each row becomes. The modal and the server actions share it,
// so what the preview promises is what the import does.

export type ImportField = "date" | "amount" | "type" | "category" | "payee" | "account" | "remarks";

// Column position per field, -1 when the file doesn't have it. Positions, not
// header names: a sheet can repeat a header or leave one blank.
export type ColumnMapping = Record<ImportField, number>;

export type DateOrder = "mdy" | "dmy";

// Named after the Transactions table's own columns, which is what the user
// knows. In the database Type is `categories` and Category is `subcategories`.
export const IMPORT_FIELDS: { field: ImportField; label: string; required: boolean }[] = [
  { field: "date", label: "Date", required: true },
  { field: "amount", label: "Amount", required: true },
  { field: "type", label: "Type", required: false },
  { field: "category", label: "Category", required: true },
  { field: "payee", label: "Payee", required: false },
  { field: "account", label: "Account", required: false },
  { field: "remarks", label: "Remarks", required: false },
];

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_/-]+/g, " ");

// Victor's Google Sheet log: Date, $, Debted $, Category, Subcategory, Payee,
// Credit Card, Memo_Remarks. The rules below that name his own debts and cards
// only ever apply to this layout, never to another household's file.
export function isSheetLayout(headers: string[]): boolean {
  const names = new Set(headers.map(normalizeHeader));
  return names.has("debted $") && names.has("subcategory") && names.has("credit card");
}

const GUESSES: Record<ImportField, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date", "trans date"],
  amount: ["debted $", "amount", "debit", "transaction amount", "$"],
  type: ["type", "group", "category group", "master category"],
  category: ["subcategory", "sub category", "category", "budget category", "item"],
  payee: ["payee", "merchant", "description", "name", "vendor"],
  account: ["account", "credit card", "card", "account name"],
  remarks: ["remarks", "memo remarks", "memo", "notes", "note"],
};

export function guessMapping(headers: string[]): ColumnMapping {
  const names = headers.map(normalizeHeader);
  const used = new Set<number>();
  const pick = (aliases: string[]) => {
    for (const alias of aliases) {
      const at = names.findIndex((name, i) => name === alias && !used.has(i));
      if (at >= 0) {
        used.add(at);
        return at;
      }
    }
    return -1;
  };
  const mapping = {} as ColumnMapping;
  // Category before Type: a sheet with both Category and Subcategory uses
  // "Category" for what this app calls Type.
  for (const field of ["date", "amount", "category", "type", "payee", "account", "remarks"] as ImportField[]) {
    mapping[field] = pick(GUESSES[field]);
  }
  if (mapping.category >= 0 && normalizeHeader(headers[mapping.category]).includes("sub") && mapping.type < 0) {
    mapping.type = pick(["category"]);
  }
  return mapping;
}

// What stops this mapping from being used, in words for the user. Runs on the
// server too: the mapping arrives from the browser.
export function mappingProblem(mapping: ColumnMapping, headers: string[]): string | null {
  for (const { field, label, required } of IMPORT_FIELDS) {
    const at = mapping[field];
    if (!Number.isInteger(at) || at < -1 || at >= headers.length) return `${label} points at a column this file doesn't have.`;
    if (required && at < 0) return `Choose the column for ${label}.`;
  }
  for (let i = 0; i < IMPORT_FIELDS.length; i++) {
    for (let j = i + 1; j < IMPORT_FIELDS.length; j++) {
      const a = IMPORT_FIELDS[i];
      const b = IMPORT_FIELDS[j];
      if (mapping[a.field] >= 0 && mapping[a.field] === mapping[b.field]) {
        return `${a.label} and ${b.label} use the same column.`;
      }
    }
  }
  return null;
}

const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// `null` no numeric dates, so no order is needed. "ask" every one of them reads
// both ways (03/04/26): guessing would quietly file a year of rows in the wrong
// month, so the user picks.
export function detectDateOrder(values: string[]): DateOrder | "ask" | null {
  let numeric = false;
  let firstOver12 = false;
  let secondOver12 = false;
  for (const value of values) {
    const m = value.trim().match(NUMERIC_DATE);
    if (!m) continue;
    numeric = true;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (!numeric) return null;
  if (firstOver12 && !secondOver12) return "dmy";
  if (secondOver12 && !firstOver12) return "mdy";
  return "ask";
}

function isoDate(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(y, month, 0)).getUTCDate()) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseImportDate(raw: string, order: DateOrder | null): string | null {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(NUMERIC_DATE);
  if (m) {
    if (!order) return null;
    const [month, day] = order === "mdy" ? [m[1], m[2]] : [m[2], m[1]];
    return isoDate(Number(m[3]), Number(month), Number(day));
  }
  // 1-Nov-26, 1 November 2026
  m = s.match(/^(\d{1,2})[^a-z0-9]+([a-z]+)[^a-z0-9]+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3)];
    return month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
  }
  // Nov 1, 2026
  m = s.match(/^([a-z]+)[^a-z0-9]+(\d{1,2})[^a-z0-9]+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3)];
    return month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

// Signed cents, NaN when it isn't a number. Handles $1,200.00, (75.82), 75.82-,
// and the decimal comma of a European bank file — "75,82" must not read as
// $7,582.
export function parseImportAmount(raw: string): number {
  let s = raw.replace(/[$€£\s]/g, "");
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (/^(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

const SHEET_SKIP = new Set([
  "Savings|Crypto debt",
  "Savings|Fidelity (Taxable) debt",
  "Income|Johana Income",
  "Income|Side Income",
]);

const SHEET_ALIASES: Record<string, string> = {
  "Expenses|Children's Clothing": "Expenses|Boy's Clothing",
  "Income|Military Pay Deduc.": "Income|Military Pay Deductions",
  "Debt|Venture3191J (Jan27)": "Debt|Venture J (Jan27)",
  "Savings|Roth IRA (Vic)": "Savings|Fidelity Roth Vic",
};

export const SHEET_AUTO_CREATE: { category: string; name: string; asPaidOffDebt?: boolean }[] = [
  { category: "Bills", name: "Irregular Bills" },
  { category: "Income", name: "Income Taxes" },
  { category: "Debt", name: "QuickSil7906V (Jun26)", asPaidOffDebt: true },
  { category: "Debt", name: "Sante Fe 2020 (APR26)", asPaidOffDebt: true },
  { category: "Debt", name: "Savor2946J (Mar26)", asPaidOffDebt: true },
  { category: "Debt", name: "Venture1 1163V(Feb27)", asPaidOffDebt: true },
];

const SHEET_CARD_TOKENS: { token: string; accountName: string }[] = [
  { token: "venture v", accountName: "1163 Venture V" },
  { token: "venturej", accountName: "3191 VentureJ" },
  { token: "venture j", accountName: "3191 VentureJ" },
  { token: "sapphire", accountName: "1175 Sapphire V" },
  { token: "ihg chase j", accountName: "8864 IHG Rewards J" },
  { token: "hilton aspire", accountName: "1002 Hilton Aspire Amex V" },
  { token: "plat amex", accountName: "1004 Plat Amex V" },
  { token: "1004plat", accountName: "1004 Plat Amex V" },
];

export type ImportSub = { id: string; name: string; categoryId: string; categoryName: string };
export type ImportAccount = { id: string; name: string };

// Exact name first, then a name that contains the cell or the other way round
// ("Sapphire" → "1175 Sapphire V") — only when exactly one account fits.
export function matchImportAccount(cell: string, accounts: ImportAccount[], sheet: boolean): ImportAccount | null {
  const value = cell.trim().toLowerCase();
  if (!value) return null;
  if (sheet) {
    for (const { token, accountName } of SHEET_CARD_TOKENS) {
      if (!value.includes(token)) continue;
      const hit = accounts.find((a) => a.name === accountName);
      if (hit) return hit;
    }
  }
  const exact = accounts.filter((a) => a.name.trim().toLowerCase() === value);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null;
  const partial = accounts.filter((a) => {
    const name = a.name.trim().toLowerCase();
    return name.includes(value) || value.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}

export type PlannedRow = {
  rowIndex: number;
  occurredOn: string;
  amountCents: number;
  typeName: string;
  categoryName: string;
  // The Type's id and the Category's id. A Category the import has to create
  // first has `subcategoryId` null and `autoCreateKey` set.
  categoryId: string;
  subcategoryId: string | null;
  autoCreateKey: string | null;
  payee: string;
  card: string;
  memo: string;
  account: ImportAccount | null;
};

export type ImportPlan = {
  rows: PlannedRow[];
  skipped: { rowIndex: number; reason: string }[];
  unknown: { key: string; rowCount: number }[];
  autoCreate: string[]; // "Type|Category" this file needs created
  cards: { csvValue: string; matchedAccount: string | null; rowCount: number }[];
  bothSigns: boolean; // the file mixes plus and minus amounts
};

export function planImport(input: {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  dateOrder: DateOrder | null;
  subs: ImportSub[];
  categories: { id: string; name: string }[];
  accounts: ImportAccount[];
}): ImportPlan {
  const { headers, rows, mapping, dateOrder, subs, categories, accounts } = input;
  const sheet = isSheetLayout(headers);
  const lower = (s: string) => s.trim().toLowerCase();
  const cell = (row: string[], field: ImportField) => (mapping[field] >= 0 ? (row[mapping[field]] ?? "").trim() : "");

  const subByKey = new Map(subs.map((s) => [`${lower(s.categoryName)}|${lower(s.name)}`, s]));
  const subsByName = new Map<string, ImportSub[]>();
  for (const s of subs) subsByName.set(lower(s.name), [...(subsByName.get(lower(s.name)) ?? []), s]);
  const categoryByName = new Map(categories.map((c) => [lower(c.name), c]));
  const sheetAuto = new Map(SHEET_AUTO_CREATE.map((a) => [`${a.category}|${a.name}`, a]));

  const planned: PlannedRow[] = [];
  const skipped: ImportPlan["skipped"] = [];
  const unknown = new Map<string, number>();
  const autoCreate = new Set<string>();
  const cards = new Map<string, { matched: string | null; count: number }>();
  const seen = new Set<string>();
  let plus = false;
  let minus = false;

  rows.forEach((row, i) => {
    const rowIndex = i + 1;
    const type = cell(row, "type");
    const name = cell(row, "category");
    const rawKey = `${type}|${name}`;
    if (sheet && SHEET_SKIP.has(rawKey)) {
      skipped.push({ rowIndex, reason: `skip rule: ${rawKey}` });
      return;
    }
    const key = sheet ? (SHEET_ALIASES[rawKey] ?? rawKey) : rawKey;
    const [keyType, keyName] = key.split("|");

    // Type and Category together win; a Category name that only exists once
    // doesn't need the Type to agree, since a Type column often holds the broad
    // kind ("Bills") while the budget files that item under "Taxes".
    const onlyByName = subsByName.get(lower(keyName)) ?? [];
    const sub = subByKey.get(`${lower(keyType)}|${lower(keyName)}`) ?? (onlyByName.length === 1 ? onlyByName[0] : null);
    const auto = !sub && sheet ? sheetAuto.get(key) : undefined;
    const autoCategory = auto ? categoryByName.get(lower(auto.category)) : undefined;
    if (!sub && !autoCategory) {
      const label = type && name ? `${type} / ${name}` : name || "(blank)";
      unknown.set(label, (unknown.get(label) ?? 0) + 1);
      return;
    }

    const dateCell = cell(row, "date");
    const occurredOn = parseImportDate(dateCell, dateOrder);
    if (!occurredOn) {
      skipped.push({ rowIndex, reason: `can't read the date "${dateCell}"` });
      return;
    }
    const amountCell = cell(row, "amount");
    const signed = parseImportAmount(amountCell);
    // In Victor's sheet a minus has always meant a bad row. Elsewhere it's how
    // banks write spending; the amount is stored unsigned and the Type sets its
    // direction, so only its size is kept.
    if (!Number.isFinite(signed) || signed === 0 || (sheet && signed < 0)) {
      skipped.push({ rowIndex, reason: `can't read the amount "${amountCell}"` });
      return;
    }
    if (signed < 0) minus = true;
    else plus = true;
    const amountCents = Math.abs(signed);

    const payee = cell(row, "payee");
    const card = cell(row, "account");
    const memo = cell(row, "remarks");
    const dedupe = [occurredOn, amountCents, sub?.id ?? key, payee, memo, card].join("|");
    if (seen.has(dedupe)) {
      skipped.push({ rowIndex, reason: "same as an earlier row in this file" });
      return;
    }
    seen.add(dedupe);

    const account = matchImportAccount(card, accounts, sheet);
    const cardLabel = card || "(none)";
    const counted = cards.get(cardLabel);
    if (counted) counted.count++;
    else cards.set(cardLabel, { matched: account?.name ?? null, count: 1 });

    if (!sub) autoCreate.add(key);
    planned.push({
      rowIndex,
      occurredOn,
      amountCents,
      typeName: sub ? sub.categoryName : auto!.category,
      categoryName: sub ? sub.name : auto!.name,
      categoryId: sub ? sub.categoryId : autoCategory!.id,
      subcategoryId: sub ? sub.id : null,
      autoCreateKey: sub ? null : key,
      payee,
      card,
      memo,
      account,
    });
  });

  return {
    rows: planned,
    skipped,
    unknown: [...unknown.entries()].map(([key, rowCount]) => ({ key, rowCount })).sort((a, b) => b.rowCount - a.rowCount),
    autoCreate: [...autoCreate],
    cards: [...cards.entries()]
      .map(([csvValue, { matched, count }]) => ({ csvValue, matchedAccount: matched, rowCount: count }))
      .sort((a, b) => b.rowCount - a.rowCount),
    bothSigns: plus && minus,
  };
}
