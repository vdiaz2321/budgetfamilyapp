"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { payeeKey, resolvePayeeIds } from "@/lib/payees";
import { throwIfAny, unwrap } from "@/lib/supabase-result";
import { parseCsv } from "../invest/import-utils";
import {
  mappingProblem,
  planImport,
  SHEET_AUTO_CREATE,
  type ColumnMapping,
  type DateOrder,
  type ImportPlan,
  type ImportSub,
} from "./import-utils";

export type PreviewResult = {
  totalRows: number;
  toImport: number;
  toSkip: ImportPlan["skipped"];
  toAutoCreateSubs: string[]; // "Type|Category" that will be created
  cardSummary: ImportPlan["cards"];
  unmappedSubs: ImportPlan["unknown"]; // rows whose Category isn't in the budget
  bothSigns: boolean;
  firstRows: {
    rowIndex: number;
    date: string;
    amountCents: number;
    type: string;
    category: string;
    payee: string;
    account: string;
    remarks: string;
  }[];
};

export type ImportResult = {
  imported: number;
  skippedAlreadyExists: number;
  skipped: number;
  autoCreated: string[];
  errors: string[];
};

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

// Reads the file, checks the mapping and works out what every row becomes.
// Preview and commit both come through here so they can't disagree.
async function buildPlan(csvText: string, mapping: ColumnMapping, dateOrder: DateOrder | null) {
  const { supabase, household } = await getSessionContext();
  const householdId = household.id;

  const { headers, rows } = parseCsv(csvText);
  const problem = mappingProblem(mapping, headers);
  if (problem) throw new Error(problem);

  // These three build the name -> id maps the whole import matches against.
  // A swallowed error would leave them empty, and every row would then look
  // unmapped — an import that silently skips everything.
  const [
    { data: cats, error: catsError },
    { data: subRows, error: subsError },
    { data: accts, error: acctsError },
  ] = await Promise.all([
    supabase.from("categories").select("id, name").eq("household_id", householdId),
    supabase
      .from("subcategories")
      .select("id, name, category_id, categories!inner(name)")
      .eq("household_id", householdId),
    supabase.from("accounts").select("id, name").eq("household_id", householdId).eq("active", true),
  ]);
  throwIfAny({ categories: catsError, subcategories: subsError, accounts: acctsError });

  const subs: ImportSub[] = [];
  for (const s of (subRows ?? []) as { id: string; name: string; category_id: string; categories: { name: string } | { name: string }[] }[]) {
    const categoryName = Array.isArray(s.categories) ? s.categories[0]?.name : s.categories?.name;
    if (categoryName) subs.push({ id: s.id, name: s.name, categoryId: s.category_id, categoryName });
  }

  const plan = planImport({
    headers,
    rows,
    mapping,
    dateOrder,
    subs,
    categories: (cats ?? []) as { id: string; name: string }[],
    accounts: (accts ?? []) as { id: string; name: string }[],
  });
  return { supabase, household, plan, totalRows: rows.length };
}

export async function previewImport(
  csvText: string,
  mapping: ColumnMapping,
  dateOrder: DateOrder | null,
): Promise<PreviewResult> {
  const { plan, totalRows } = await buildPlan(csvText, mapping, dateOrder);
  return {
    totalRows,
    toImport: plan.rows.length,
    toSkip: plan.skipped,
    toAutoCreateSubs: plan.autoCreate,
    cardSummary: plan.cards,
    unmappedSubs: plan.unknown,
    bothSigns: plan.bothSigns,
    firstRows: plan.rows.slice(0, 5).map((r) => ({
      rowIndex: r.rowIndex,
      date: r.occurredOn,
      amountCents: r.amountCents,
      type: r.typeName,
      category: r.categoryName,
      payee: r.payee,
      account: r.account?.name ?? "",
      remarks: r.memo,
    })),
  };
}

export async function commitImport(
  csvText: string,
  mapping: ColumnMapping,
  dateOrder: DateOrder | null,
): Promise<ImportResult> {
  const { supabase, household, plan } = await buildPlan(csvText, mapping, dateOrder);
  const householdId = household.id;

  const autoCreated: string[] = [];
  const createdSubIds = new Map<string, string>();
  const errors: string[] = [];

  // Create only the subcategories + paid-off debt rows this file's rows need.
  for (const key of plan.autoCreate) {
    const spec = SHEET_AUTO_CREATE.find((a) => `${a.category}|${a.name}` === key);
    const categoryId = plan.rows.find((r) => r.autoCreateKey === key)?.categoryId;
    if (!spec || !categoryId) continue;
    const siblings = unwrap(
      await supabase
        .from("subcategories")
        .select("sort_order")
        .eq("household_id", householdId)
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: false })
        .limit(1),
      "subcategories",
    );
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
    if (error || !created) {
      errors.push(`could not create ${key}: ${error?.message ?? "no row returned"}`);
      continue;
    }
    createdSubIds.set(key, created.id);
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

  // Keyed by lower-cased name: an import spelling "kaufland" has to land on the
  // existing "Kaufland" instead of forking the payee.
  const payeeByName = await resolvePayeeIds(
    supabase,
    householdId,
    [...new Set(plan.rows.map((r) => r.payee).filter(Boolean))],
  );

  const toInsert: Record<string, unknown>[] = [];
  for (const r of plan.rows) {
    const subcategoryId = r.subcategoryId ?? (r.autoCreateKey ? createdSubIds.get(r.autoCreateKey) : null);
    if (!subcategoryId) {
      errors.push(`row ${r.rowIndex}: its category could not be created`);
      continue;
    }
    toInsert.push({
      household_id: householdId,
      occurred_on: r.occurredOn,
      amount_cents: r.amountCents,
      currency: household.currency,
      category_id: r.categoryId,
      subcategory_id: subcategoryId,
      account_id: r.account?.id ?? null,
      payee_id: r.payee ? payeeByName.get(payeeKey(r.payee)) ?? null : null,
      memo: r.memo || null,
      source: "import",
      import_hash: hashRow(householdId, r.occurredOn, r.amountCents, subcategoryId, r.payee, r.memo, r.card),
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
  revalidatePath("/insights");

  return {
    imported: inserted,
    skippedAlreadyExists: alreadyExists,
    skipped: plan.skipped.length + plan.unknown.reduce((sum, u) => sum + u.rowCount, 0),
    autoCreated,
    errors,
  };
}
