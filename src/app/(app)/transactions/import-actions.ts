"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireHousehold() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");
  return { supabase, householdId: profile.household_id as string };
}

const SKIP_SET = new Set([
  "Savings|Crypto debt",
  "Savings|Fidelity (Taxable) debt",
  "Income|Johana Income",
  "Income|Side Income",
]);

const ALIAS_MAP: Record<string, string> = {
  "Expenses|Children's Clothing": "Expenses|Boy's Clothing",
  "Income|Military Pay Deduc.": "Income|Military Pay Deductions",
  "Debt|Venture3191J (Jan27)": "Debt|Venture J (Jan27)",
  "Savings|Roth IRA (Vic)": "Savings|Fidelity Roth Vic",
};

const AUTO_CREATE_SUBCATS: { category: string; name: string; asPaidOffDebt?: boolean }[] = [
  { category: "Bills", name: "Irregular Bills" },
  { category: "Debt", name: "QuickSil7906V (Jun26)", asPaidOffDebt: true },
  { category: "Debt", name: "Sante Fe 2020 (APR26)", asPaidOffDebt: true },
  { category: "Debt", name: "Savor2946J (Mar26)", asPaidOffDebt: true },
  { category: "Debt", name: "Venture1 1163V(Feb27)", asPaidOffDebt: true },
];

const CARD_TOKENS: { token: string; accountName: string }[] = [
  { token: "venture v", accountName: "Venture V" },
  { token: "venturej", accountName: "Venture J" },
  { token: "venture j", accountName: "Venture J" },
  { token: "sapphire", accountName: "Sapphire" },
  { token: "ihg chase j", accountName: "IHG Rewards Club J" },
  { token: "hilton aspire", accountName: "Hilton Aspire" },
  { token: "plat amex", accountName: "Platinum Card" },
  { token: "1004plat", accountName: "Platinum Card" },
];

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export type ParsedCsvRow = {
  rowIndex: number; // 1-based (CSV line number, excluding header)
  date: string;
  category: string;
  subcategory: string;
  payee: string;
  card: string;
  memo: string;
  amountCents: number;
};

export type PreviewResult = {
  totalRows: number;
  toImport: number;
  toSkip: { rowIndex: number; reason: string }[];
  toAutoCreateSubs: string[]; // "Category|Subcategory" that will be created
  cardSummary: { csvValue: string; matchedAccount: string | null; rowCount: number }[];
  unmappedSubs: { key: string; rowCount: number }[]; // unexpected subs — surface before commit
};

export type ImportResult = {
  imported: number;
  skippedAlreadyExists: number;
  skippedByRule: number;
  autoCreated: string[];
  errors: string[];
};

function parseDate(s: string): string | null {
  // Tolerate any non-alphanumeric separators (dashes, spaces, mixes) and both
  // 3-letter and full month names ("Jun", "June", "JUN", "june").
  const m = s.trim().toLowerCase().match(/^(\d{1,2})[^a-z0-9]+([a-z]+)[^a-z0-9]+(\d{2,4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mo = MONTH_MAP[m[2].slice(0, 3)];
  if (!mo) return null;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yr}-${mo}-${day}`;
}

function parseAmountCents(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function normalizeCard(s: string): string {
  return s.trim().toLowerCase();
}

function matchAccount(cardValue: string, accountByName: Map<string, string>): string | null {
  const norm = normalizeCard(cardValue);
  if (!norm) return null;
  for (const { token, accountName } of CARD_TOKENS) {
    if (norm.includes(token)) {
      const id = accountByName.get(accountName);
      if (id) return id;
    }
  }
  return null;
}

// CSV has no quoted-comma cells (verified). Simple split is safe.
function parseCsvLines(csv: string): ParsedCsvRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    // Columns: Date, $, Debted $, Category, Subcategory, Payee, Credit Card, Memo_Remarks
    const date = cols[0]?.trim() ?? "";
    const amountStr = cols[2]?.trim() ?? "";
    const category = cols[3]?.trim() ?? "";
    const subcategory = cols[4]?.trim() ?? "";
    const payee = cols[5]?.trim() ?? "";
    const card = cols[6]?.trim() ?? "";
    const memo = (cols.slice(7).join(",") ?? "").trim();
    const amountCents = parseAmountCents(amountStr);
    rows.push({
      rowIndex: i,
      date, category, subcategory, payee, card, memo, amountCents,
    });
  }
  return rows;
}

function subKey(category: string, subcategory: string): string {
  return `${category}|${subcategory}`;
}

function resolveKey(category: string, subcategory: string): string {
  const raw = subKey(category, subcategory);
  return ALIAS_MAP[raw] ?? raw;
}

function hashRow(
  householdId: string,
  occurredOn: string,
  amountCents: number,
  subcategoryId: string,
  payee: string,
  memo: string,
  csvCard: string,
): string {
  const s = `${householdId}|${occurredOn}|${amountCents}|${subcategoryId}|${payee}|${memo}|${csvCard}`;
  return createHash("sha1").update(s).digest("hex");
}

export async function previewImport(csvText: string): Promise<PreviewResult> {
  const { supabase, householdId } = await requireHousehold();
  const rows = parseCsvLines(csvText);

  const [{ data: cats }, { data: subs }, { data: accts }] = await Promise.all([
    supabase.from("categories").select("id, name").eq("household_id", householdId),
    supabase
      .from("subcategories")
      .select("id, name, category_id, categories!inner(name)")
      .eq("household_id", householdId),
    supabase.from("accounts").select("id, name").eq("household_id", householdId).eq("active", true),
  ]);

  const catByName = new Map((cats ?? []).map((c) => [c.name as string, c.id as string]));
  const subByKey = new Map<string, string>();
  for (const s of (subs ?? []) as { id: string; name: string; categories: { name: string } | { name: string }[] }[]) {
    const catName = Array.isArray(s.categories) ? s.categories[0]?.name : s.categories?.name;
    if (catName) subByKey.set(`${catName}|${s.name}`, s.id);
  }
  const acctByName = new Map((accts ?? []).map((a) => [a.name as string, a.id as string]));
  const autoCreateKeys = new Set(AUTO_CREATE_SUBCATS.map((a) => `${a.category}|${a.name}`));

  const toSkip: { rowIndex: number; reason: string }[] = [];
  const cardCounts = new Map<string, { matched: string | null; count: number }>();
  const unmappedCounts = new Map<string, number>();
  let toImport = 0;

  for (const r of rows) {
    const rawKey = subKey(r.category, r.subcategory);
    if (SKIP_SET.has(rawKey)) {
      toSkip.push({ rowIndex: r.rowIndex, reason: `skip rule: ${rawKey}` });
      continue;
    }
    const key = resolveKey(r.category, r.subcategory);
    const isKnown = subByKey.has(key) || autoCreateKeys.has(key);
    if (!isKnown) {
      unmappedCounts.set(key, (unmappedCounts.get(key) ?? 0) + 1);
      continue;
    }
    if (!parseDate(r.date) || !Number.isFinite(r.amountCents) || r.amountCents <= 0) {
      toSkip.push({ rowIndex: r.rowIndex, reason: `bad date/amount: "${r.date}" / "${r.amountCents}"` });
      continue;
    }
    toImport++;
    const cv = r.card || "(none)";
    const existing = cardCounts.get(cv);
    if (existing) existing.count++;
    else {
      const matchedId = r.card ? matchAccount(r.card, acctByName) : null;
      let matchedName: string | null = null;
      if (matchedId) {
        for (const [n, id] of acctByName) if (id === matchedId) { matchedName = n; break; }
      }
      cardCounts.set(cv, { matched: matchedName, count: 1 });
    }
  }

  const toAutoCreateSubs = AUTO_CREATE_SUBCATS
    .map((a) => `${a.category}|${a.name}`)
    .filter((k) => !subByKey.has(k) && catByName.has(k.split("|")[0]));

  return {
    totalRows: rows.length,
    toImport,
    toSkip,
    toAutoCreateSubs,
    cardSummary: [...cardCounts.entries()]
      .map(([csvValue, { matched, count }]) => ({ csvValue, matchedAccount: matched, rowCount: count }))
      .sort((a, b) => b.rowCount - a.rowCount),
    unmappedSubs: [...unmappedCounts.entries()]
      .map(([key, rowCount]) => ({ key, rowCount }))
      .sort((a, b) => b.rowCount - a.rowCount),
  };
}

export async function commitImport(csvText: string): Promise<ImportResult> {
  const { supabase, householdId } = await requireHousehold();
  const rows = parseCsvLines(csvText);

  const [{ data: cats }, { data: subs }, { data: accts }] = await Promise.all([
    supabase.from("categories").select("id, name, kind").eq("household_id", householdId),
    supabase
      .from("subcategories")
      .select("id, name, category_id, categories!inner(name)")
      .eq("household_id", householdId),
    supabase.from("accounts").select("id, name").eq("household_id", householdId).eq("active", true),
  ]);

  const catByName = new Map((cats ?? []).map((c) => [c.name as string, c.id as string]));
  const subByKey = new Map<string, string>();
  for (const s of (subs ?? []) as { id: string; name: string; categories: { name: string } | { name: string }[] }[]) {
    const catName = Array.isArray(s.categories) ? s.categories[0]?.name : s.categories?.name;
    if (catName) subByKey.set(`${catName}|${s.name}`, s.id);
  }
  const acctByName = new Map((accts ?? []).map((a) => [a.name as string, a.id as string]));

  const autoCreated: string[] = [];

  // Auto-create missing subcategories + paid-off debt rows.
  for (const spec of AUTO_CREATE_SUBCATS) {
    const key = `${spec.category}|${spec.name}`;
    if (subByKey.has(key)) continue;
    const categoryId = catByName.get(spec.category);
    if (!categoryId) continue;
    const { data: siblings } = await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("household_id", householdId)
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSort = (siblings?.[0]?.sort_order ?? -1) + 1;
    const { data: created, error } = await supabase
      .from("subcategories")
      .insert({
        household_id: householdId,
        category_id: categoryId,
        name: spec.name,
        sort_order: nextSort,
      })
      .select("id")
      .single();
    if (error || !created) continue;
    subByKey.set(key, created.id);
    autoCreated.push(key);
    if (spec.asPaidOffDebt) {
      await supabase.from("debts").insert({
        household_id: householdId,
        subcategory_id: created.id,
        current_balance_cents: 0,
        min_payment_cents: 0,
        apr: 0,
        debt_kind: "credit_card",
        paid_off_at: new Date().toISOString().slice(0, 10),
      });
    }
  }

  // Upsert every unique payee once.
  const uniquePayees = new Set<string>();
  for (const r of rows) if (r.payee) uniquePayees.add(r.payee);
  const payeeByName = new Map<string, string>();
  if (uniquePayees.size > 0) {
    const payeeRows = [...uniquePayees].map((name) => ({ household_id: householdId, name }));
    const { data: upserted } = await supabase
      .from("payees")
      .upsert(payeeRows, { onConflict: "household_id,name" })
      .select("id, name");
    for (const p of upserted ?? []) payeeByName.set(p.name as string, p.id as string);
  }

  const toInsert: Record<string, unknown>[] = [];
  const seenHashes = new Set<string>();
  let skippedByRule = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const rawKey = subKey(r.category, r.subcategory);
    if (SKIP_SET.has(rawKey)) { skippedByRule++; continue; }
    const key = resolveKey(r.category, r.subcategory);
    const subcategoryId = subByKey.get(key);
    if (!subcategoryId) { skippedByRule++; continue; }
    const categoryName = key.split("|")[0];
    const categoryId = catByName.get(categoryName);
    if (!categoryId) { skippedByRule++; continue; }
    const occurredOn = parseDate(r.date);
    if (!occurredOn) { errors.push(`row ${r.rowIndex}: bad date "${r.date}"`); continue; }
    if (!Number.isFinite(r.amountCents) || r.amountCents <= 0) {
      errors.push(`row ${r.rowIndex}: bad amount`);
      continue;
    }
    const accountId = r.card ? matchAccount(r.card, acctByName) : null;
    const payeeId = r.payee ? payeeByName.get(r.payee) ?? null : null;

    const hash = hashRow(householdId, occurredOn, r.amountCents, subcategoryId, r.payee, r.memo, r.card);
    if (seenHashes.has(hash)) continue; // duplicate within CSV
    seenHashes.add(hash);

    toInsert.push({
      household_id: householdId,
      occurred_on: occurredOn,
      amount_cents: r.amountCents,
      currency: "USD",
      category_id: categoryId,
      subcategory_id: subcategoryId,
      account_id: accountId,
      payee_id: payeeId,
      memo: r.memo || null,
      source: "import",
      import_hash: hash,
      is_withdrawal: false,
      bucket_id: null,
    });
  }

  // Insert in chunks; ignore rows that conflict on (household_id, import_hash).
  const BATCH = 500;
  let inserted = 0;
  let alreadyExists = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("transactions")
      .upsert(chunk, { onConflict: "household_id,import_hash", ignoreDuplicates: true })
      .select("id");
    if (error) {
      errors.push(`insert error at row ${i}: ${error.message}`);
      break;
    }
    const got = data?.length ?? 0;
    inserted += got;
    alreadyExists += chunk.length - got;
  }

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/annual");

  return {
    imported: inserted,
    skippedAlreadyExists: alreadyExists,
    skippedByRule,
    autoCreated,
    errors,
  };
}
