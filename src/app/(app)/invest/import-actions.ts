"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase-result";
import {
  getCell,
  parseCsv,
  parseMoney,
  parsePercent,
  parsePerformanceDate,
  parseQuantity,
  toCents,
  type ImportKind,
  type ImportMapping,
  type PerformanceMapping,
  type PositionMapping,
} from "./import-utils";

async function requireHousehold() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  // A failed read is not "this user has no household" — redirecting on it
  // would drop a signed-in user into onboarding and invite a second household.
  if (profileError) throw new Error(`Could not load your profile: ${profileError.message}`);
  if (!profile) redirect("/onboarding");
  return { supabase, householdId: profile.household_id };
}

const isImportKind = (value: string): value is ImportKind => value === "positions" || value === "performance";
const isDate = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value);

function mappingIsObject(value: unknown): value is ImportMapping {
  return !!value && typeof value === "object";
}

export async function commitInvestmentImport(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const csvText = String(formData.get("csvText") ?? "");
  const fileName = String(formData.get("fileName") ?? "investment.csv").trim() || "investment.csv";
  const kindRaw = String(formData.get("importKind") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  const provider = String(formData.get("provider") ?? "Other").trim() || "Other";
  const asOfDate = String(formData.get("asOfDate") ?? "");
  let mapping: unknown;

  try {
    mapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  } catch {
    return { error: "The column mapping could not be read. Please preview the file again." };
  }

  if (!csvText || !accountId || !isImportKind(kindRaw) || !isDate(asOfDate) || !mappingIsObject(mapping)) {
    return { error: "Choose an investment account, import type, and valid as-of date before saving." };
  }

  const account = unwrap(
    await supabase
      .from("accounts")
      .select("id, kind, is_kids_account")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account || (account.kind !== "investment" && !account.is_kids_account)) {
    return { error: "That destination is not an investment or Kids Funding account." };
  }

  if (bucketId) {
    const bucket = unwrap(
      await supabase
        .from("buckets")
        .select("id")
        .eq("id", bucketId)
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "buckets",
    );
    if (!bucket) return { error: "The selected bucket does not belong to that account." };
  }

  const parsed = parseCsv(csvText);
  if (parsed.headers.length < 2 || parsed.rows.length === 0) {
    return { error: "This file does not contain a readable header row and data." };
  }

  const positionRows: Record<string, unknown>[] = [];
  const performanceRows: Record<string, unknown>[] = [];
  let skippedRows = 0;

  if (kindRaw === "positions") {
    const map = mapping as PositionMapping;
    for (const row of parsed.rows) {
      const securityName = getCell(parsed.headers, row, map.securityName).trim();
      const marketValue = parseMoney(getCell(parsed.headers, row, map.marketValue));
      if (!securityName || marketValue == null) {
        skippedRows += 1;
        continue;
      }
      positionRows.push({
        household_id: householdId,
        account_id: accountId,
        bucket_id: bucketId,
        as_of_date: asOfDate,
        symbol: getCell(parsed.headers, row, map.symbol).trim() || null,
        security_name: securityName,
        asset_class: getCell(parsed.headers, row, map.assetClass).trim() || null,
        quantity: parseQuantity(getCell(parsed.headers, row, map.quantity)),
        price_cents: toCents(parseMoney(getCell(parsed.headers, row, map.price))),
        market_value_cents: toCents(marketValue),
        cost_basis_cents: toCents(parseMoney(getCell(parsed.headers, row, map.costBasis))),
        unrealized_gain_cents: toCents(parseMoney(getCell(parsed.headers, row, map.unrealizedGain))),
        unrealized_gain_percent: parsePercent(getCell(parsed.headers, row, map.unrealizedGainPercent)),
      });
    }
  } else {
    const map = mapping as PerformanceMapping;
    for (const row of parsed.rows) {
      const period = getCell(parsed.headers, row, map.period);
      const rowDate = parsePerformanceDate(period);
      const endingBalance = parseMoney(getCell(parsed.headers, row, map.endingBalance));
      if (!rowDate || endingBalance == null) {
        skippedRows += 1;
        continue;
      }
      const dividends = parseMoney(getCell(parsed.headers, row, map.dividends)) ?? 0;
      const interest = parseMoney(getCell(parsed.headers, row, map.interest)) ?? 0;
      performanceRows.push({
        household_id: householdId,
        account_id: accountId,
        bucket_id: bucketId,
        as_of_date: rowDate,
        beginning_balance_cents: toCents(parseMoney(getCell(parsed.headers, row, map.beginningBalance))),
        contributions_cents: toCents(parseMoney(getCell(parsed.headers, row, map.contributions))),
        withdrawals_cents: toCents(parseMoney(getCell(parsed.headers, row, map.withdrawals))),
        dividends_cents: toCents(dividends + interest),
        fees_cents: toCents(parseMoney(getCell(parsed.headers, row, map.fees))),
        market_change_cents: toCents(parseMoney(getCell(parsed.headers, row, map.marketChange))),
        ending_balance_cents: toCents(endingBalance),
      });
    }
  }

  const rows = kindRaw === "positions" ? positionRows : performanceRows;
  if (rows.length === 0) {
    return { error: "No usable investment rows were found. Check the column mapping and required values." };
  }

  const sourceHash = createHash("sha256").update(csvText).digest("hex");
  const target = kindRaw === "positions" ? "investment_position_snapshots" : "investment_performance_snapshots";

  // Reuse one ongoing ledger for each account/bucket/import type. A later
  // export appends new dates and replaces rows for dates already present.
  let existingQuery = supabase
    .from("investment_import_batches")
    .select("id")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("import_kind", kindRaw);
  existingQuery = bucketId ? existingQuery.eq("bucket_id", bucketId) : existingQuery.is("bucket_id", null);
  const existing = unwrap(
    await existingQuery.order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "existing",
  );

  if (existing) {
    const { data: existingRows, error: existingRowsError } = await supabase
      .from(target)
      .select("*")
      .eq("import_batch_id", existing.id)
      .eq("household_id", householdId);
    if (existingRowsError) return { error: "The existing import could not be read. Please try again." };

    const incomingDates = [...new Set(rows.map((row) => String(row.as_of_date)))];
    const rowsToReplace = (existingRows ?? []).filter((row) => incomingDates.includes(String(row.as_of_date)));
    const { error: deleteError } = await supabase
      .from(target)
      .delete()
      .eq("import_batch_id", existing.id)
      .eq("household_id", householdId)
      .in("as_of_date", incomingDates);
    if (deleteError) return { error: "The existing dates could not be replaced. Please try again." };

    const payload = rows.map((row) => ({ ...row, import_batch_id: existing.id }));
    const { error: rowError } = await supabase.from(target).insert(payload);
    if (rowError) {
      if (rowsToReplace.length > 0) await supabase.from(target).insert(rowsToReplace);
      return { error: "The imported rows could not be saved. The previous dates were restored." };
    }

    const rowCount = (existingRows?.length ?? 0) - rowsToReplace.length + rows.length;
    const { error: updateError } = await supabase
      .from("investment_import_batches")
      .update({ provider, as_of_date: asOfDate, source_filename: fileName, source_hash: sourceHash, column_mapping: mapping, row_count: rowCount })
      .eq("id", existing.id)
      .eq("household_id", householdId);
    if (updateError) return { error: "The rows were saved, but the import summary could not be updated." };

    revalidatePath("/invest");
    return { error: null, imported: rows.length, skipped: skippedRows, appended: rows.length - rowsToReplace.length, replaced: rowsToReplace.length };
  }

  const { data: batch, error: batchError } = await supabase
    .from("investment_import_batches")
    .insert({
      household_id: householdId,
      account_id: accountId,
      bucket_id: bucketId,
      provider,
      import_kind: kindRaw,
      as_of_date: asOfDate,
      source_filename: fileName,
      source_hash: sourceHash,
      column_mapping: mapping,
      row_count: rows.length,
    })
    .select("id")
    .single();
  if (batchError || !batch) return { error: "The import could not be started. Please try again." };

  const payload = rows.map((row) => ({ ...row, import_batch_id: batch.id }));
  const { error: rowError } = await supabase.from(target).insert(payload);
  if (rowError) {
    await supabase.from("investment_import_batches").delete().eq("id", batch.id).eq("household_id", householdId);
    return { error: "The imported rows could not be saved. No partial import was kept." };
  }

  revalidatePath("/invest");
  return { error: null, imported: rows.length, skipped: skippedRows };
}

export async function moveInvestmentImport(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const batchId = String(formData.get("batchId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  if (!batchId || !accountId) return { error: "Choose an investment account." };

  const account = unwrap(
    await supabase
      .from("accounts")
      .select("id, kind, is_kids_account")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account || (account.kind !== "investment" && !account.is_kids_account)) {
    return { error: "That destination is not an investment or Kids Funding account." };
  }
  if (bucketId) {
    const bucket = unwrap(
      await supabase
        .from("buckets")
        .select("id")
        .eq("id", bucketId)
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "buckets",
    );
    if (!bucket) return { error: "The selected bucket does not belong to that account." };
  }

  const batch = unwrap(
    await supabase
      .from("investment_import_batches")
      .select("id")
      .eq("id", batchId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "investment_import_batches",
  );
  if (!batch) return { error: "That import could not be found." };

  const { error: batchError } = await supabase
    .from("investment_import_batches")
    .update({ account_id: accountId, bucket_id: bucketId })
    .eq("id", batchId)
    .eq("household_id", householdId);
  if (batchError) return { error: "The import destination could not be updated." };

  const [positions, performance] = await Promise.all([
    supabase.from("investment_position_snapshots").update({ account_id: accountId, bucket_id: bucketId }).eq("import_batch_id", batchId).eq("household_id", householdId),
    supabase.from("investment_performance_snapshots").update({ account_id: accountId, bucket_id: bucketId }).eq("import_batch_id", batchId).eq("household_id", householdId),
  ]);
  if (positions.error || performance.error) return { error: "The import moved, but its detail rows could not all be updated." };

  revalidatePath("/invest");
  return { error: null };
}

// ---- Manual entry -------------------------------------------------------
//
// Charles Schwab, TSP and M1 have no monthly CSV worth importing, and once a
// full history is loaded there is no reason to re-upload the whole spreadsheet
// just to append September. Both cases are the same operation: write one row
// into the ledger the CSV path already maintains, creating it if it is the
// first row for that account/bucket.

type Destination = { accountId: string; bucketId: string | null };

async function validateDestination(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  { accountId, bucketId }: Destination,
) {
  const account = unwrap(
    await supabase
      .from("accounts")
      .select("id, kind, is_kids_account")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account || (account.kind !== "investment" && !account.is_kids_account)) {
    return "That destination is not an investment or Kids Funding account.";
  }
  if (bucketId) {
    const bucket = unwrap(
      await supabase
        .from("buckets")
        .select("id")
        .eq("id", bucketId)
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "buckets",
    );
    if (!bucket) return "The selected bucket does not belong to that account.";
  }
  return null;
}

/** The ongoing ledger for one account/bucket/kind, created on first use. */
async function findOrCreateLedger(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  { accountId, bucketId }: Destination,
  kind: ImportKind,
  asOfDate: string,
) {
  let query = supabase
    .from("investment_import_batches")
    .select("id")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("import_kind", kind);
  query = bucketId ? query.eq("bucket_id", bucketId) : query.is("bucket_id", null);
  const existing = unwrap(await query.order("created_at", { ascending: true }).limit(1).maybeSingle(), "ledger");
  if (existing) return { id: existing.id as string, error: null };

  const { data: batch, error } = await supabase
    .from("investment_import_batches")
    .insert({
      household_id: householdId,
      account_id: accountId,
      bucket_id: bucketId,
      provider: "Manual",
      import_kind: kind,
      as_of_date: asOfDate,
      source_filename: null,
      source_hash: null,
      column_mapping: {},
      row_count: 0,
    })
    .select("id")
    .single();
  if (error || !batch) return { id: null, error: "This account's history could not be started. Please try again." };
  return { id: batch.id as string, error: null };
}

const monthBounds = (month: string) => {
  const [year, mon] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  return { start, next: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` };
};

/**
 * Re-derive the ledger's summary from the rows that actually remain. The
 * as-of date has to be read back rather than assumed: after a delete the month
 * just removed is precisely the one that must NOT be stamped on the batch.
 */
async function syncLedgerSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  batchId: string,
  table: "investment_performance_snapshots" | "investment_position_snapshots",
  fallbackDate: string,
) {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId)
    .eq("household_id", householdId);
  const latest = unwrap(
    await supabase
      .from(table)
      .select("as_of_date")
      .eq("import_batch_id", batchId)
      .eq("household_id", householdId)
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "latest row",
  );
  await supabase
    .from("investment_import_batches")
    .update({ row_count: count ?? 0, as_of_date: latest?.as_of_date ?? fallbackDate })
    .eq("id", batchId)
    .eq("household_id", householdId);
}

export async function saveManualPerformanceMonth(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  const month = String(formData.get("month") ?? "").trim();

  if (!accountId) return { error: "Choose an investment account." };
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Choose a month." };

  const endingRaw = String(formData.get("endingBalance") ?? "").trim();
  if (!endingRaw) return { error: "Enter the ending balance for that month." };
  const ending = parseMoney(endingRaw);
  if (ending == null) return { error: "The ending balance is not a number we can read." };

  const destinationError = await validateDestination(supabase, householdId, { accountId, bucketId });
  if (destinationError) return { error: destinationError };

  const { start, next } = monthBounds(month);
  const ledger = await findOrCreateLedger(supabase, householdId, { accountId, bucketId }, "performance", start);
  if (!ledger.id) return { error: ledger.error };

  const contributions = parseMoney(String(formData.get("contributions") ?? "")) ?? 0;
  const withdrawals = parseMoney(String(formData.get("withdrawals") ?? "")) ?? 0;
  const dividends = parseMoney(String(formData.get("dividends") ?? "")) ?? 0;
  const fees = parseMoney(String(formData.get("fees") ?? "")) ?? 0;

  // Beginning balance carries over from the most recent earlier month, so the
  // ledger stays continuous without asking for a number already on file.
  const previous = unwrap(
    await supabase
      .from("investment_performance_snapshots")
      .select("ending_balance_cents")
      .eq("import_batch_id", ledger.id)
      .eq("household_id", householdId)
      .lt("as_of_date", start)
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "previous month",
  );
  const typedBeginning = parseMoney(String(formData.get("beginningBalance") ?? ""));
  const beginningCents = typedBeginning != null ? toCents(typedBeginning) : previous?.ending_balance_cents ?? null;

  // Market change is derived, never typed: it is the only figure a brokerage
  // statement does not hand you directly, and every input it needs is above.
  const endingCents = toCents(ending)!;
  const marketChangeCents = beginningCents == null
    ? null
    : endingCents - beginningCents - toCents(contributions)! + toCents(withdrawals)! - toCents(dividends)! + toCents(fees)!;

  // Match on the calendar month rather than the exact day. Imported Fidelity
  // rows are dated 2026-08-03 while a manual August is 2026-08-01, and the
  // unique index would happily keep both — two rows for one month.
  const { error: deleteError } = await supabase
    .from("investment_performance_snapshots")
    .delete()
    .eq("import_batch_id", ledger.id)
    .eq("household_id", householdId)
    .gte("as_of_date", start)
    .lt("as_of_date", next);
  if (deleteError) return { error: "That month could not be replaced. Please try again." };

  const { error: insertError } = await supabase.from("investment_performance_snapshots").insert({
    household_id: householdId,
    import_batch_id: ledger.id,
    account_id: accountId,
    bucket_id: bucketId,
    as_of_date: start,
    beginning_balance_cents: beginningCents,
    contributions_cents: toCents(contributions),
    withdrawals_cents: toCents(withdrawals),
    dividends_cents: toCents(dividends),
    fees_cents: toCents(fees),
    market_change_cents: marketChangeCents,
    ending_balance_cents: endingCents,
    entry_source: "manual",
  });
  if (insertError) return { error: "That month could not be saved. Please try again." };

  await syncLedgerSummary(supabase, householdId, ledger.id, "investment_performance_snapshots", start);
  revalidatePath("/invest");
  return { error: null, marketChangeCents };
}

export async function deletePerformanceMonth(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const batchId = String(formData.get("batchId") ?? "");
  const asOfDate = String(formData.get("asOfDate") ?? "");
  if (!batchId || !isDate(asOfDate)) return { error: "That month could not be identified." };

  const { error } = await supabase
    .from("investment_performance_snapshots")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("household_id", householdId)
    .eq("as_of_date", asOfDate);
  if (error) return { error: "That month could not be removed. Please try again." };

  await syncLedgerSummary(supabase, householdId, batchId, "investment_performance_snapshots", asOfDate);
  revalidatePath("/invest");
  return { error: null };
}

type ManualHolding = { symbol: string; securityName: string; marketValue: string; quantity: string; costBasis: string };

export async function saveManualPositions(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  const asOfDate = String(formData.get("asOfDate") ?? "");
  if (!accountId) return { error: "Choose an investment account." };
  if (!isDate(asOfDate)) return { error: "Choose an as-of date." };

  let holdings: ManualHolding[];
  try {
    holdings = JSON.parse(String(formData.get("holdings") ?? "[]"));
  } catch {
    return { error: "The holdings could not be read. Please try again." };
  }

  const rows = holdings
    .map((holding) => {
      const symbol = (holding.symbol ?? "").trim().toUpperCase();
      const name = (holding.securityName ?? "").trim();
      const marketValue = parseMoney(holding.marketValue);
      if ((!symbol && !name) || marketValue == null) return null;
      return {
        household_id: householdId,
        account_id: accountId,
        bucket_id: bucketId,
        as_of_date: asOfDate,
        symbol: symbol || null,
        security_name: name || symbol,
        asset_class: null,
        quantity: parseQuantity(holding.quantity),
        price_cents: null,
        market_value_cents: toCents(marketValue),
        cost_basis_cents: toCents(parseMoney(holding.costBasis)),
        unrealized_gain_cents: null,
        unrealized_gain_percent: null,
        entry_source: "manual",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return { error: "Enter at least one holding with a ticker and a value." };

  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.symbol ?? row.security_name;
    if (seen.has(key)) return { error: `${key} is listed twice. Combine it into one row.` };
    seen.add(key);
  }

  const destinationError = await validateDestination(supabase, householdId, { accountId, bucketId });
  if (destinationError) return { error: destinationError };

  const ledger = await findOrCreateLedger(supabase, householdId, { accountId, bucketId }, "positions", asOfDate);
  if (!ledger.id) return { error: ledger.error };

  // Holdings are a complete picture of the account at that date, so the whole
  // set for the date is replaced rather than merged.
  const { error: deleteError } = await supabase
    .from("investment_position_snapshots")
    .delete()
    .eq("import_batch_id", ledger.id)
    .eq("household_id", householdId)
    .eq("as_of_date", asOfDate);
  if (deleteError) return { error: "The existing holdings could not be replaced. Please try again." };

  const { error: insertError } = await supabase
    .from("investment_position_snapshots")
    .insert(rows.map((row) => ({ ...row, import_batch_id: ledger.id })));
  if (insertError) return { error: "Those holdings could not be saved. Please try again." };

  await syncLedgerSummary(supabase, householdId, ledger.id, "investment_position_snapshots", asOfDate);
  revalidatePath("/invest");
  return { error: null, saved: rows.length };
}

/**
 * File one holding under a different account or bucket.
 *
 * The row cannot simply have its account_id rewritten: holdings are grouped by
 * the ledger they belong to, so a row pointing at one account from inside
 * another account's ledger would be counted under both. The row moves into the
 * destination's ledger, which is created if this is the first holding there,
 * and an emptied ledger is cleared away rather than left as a ghost.
 */
async function refileHolding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  positionId: string,
  accountId: string,
  bucketId: string | null,
) {
  const holding = unwrap(
    await supabase
      .from("investment_position_snapshots")
      .select("id, import_batch_id, as_of_date, symbol, security_name")
      .eq("id", positionId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "investment_position_snapshots",
  );
  if (!holding) return { error: "That holding could not be found." };

  const ledger = await findOrCreateLedger(supabase, householdId, { accountId, bucketId }, "positions", holding.as_of_date);
  if (!ledger.id) return { error: ledger.error };
  if (ledger.id === holding.import_batch_id) return { error: null };

  // The destination may already hold this fund on this date, which the unique
  // index would reject — merging silently would lose one of the two figures.
  const clash = unwrap(
    await supabase
      .from("investment_position_snapshots")
      .select("id")
      .eq("import_batch_id", ledger.id)
      .eq("household_id", householdId)
      .eq("as_of_date", holding.as_of_date)
      .eq(holding.symbol ? "symbol" : "security_name", holding.symbol ?? holding.security_name)
      .maybeSingle(),
    "clash",
  );
  if (clash) return { error: `That account already has ${holding.symbol ?? holding.security_name} on this date.` };

  const previousBatchId = holding.import_batch_id;
  const { error } = await supabase
    .from("investment_position_snapshots")
    .update({ import_batch_id: ledger.id, account_id: accountId, bucket_id: bucketId })
    .eq("id", positionId)
    .eq("household_id", householdId);
  if (error) return { error: "That holding could not be moved. Please try again." };

  await syncLedgerSummary(supabase, householdId, ledger.id, "investment_position_snapshots", holding.as_of_date);
  await syncLedgerSummary(supabase, householdId, previousBatchId, "investment_position_snapshots", holding.as_of_date);

  const { count } = await supabase
    .from("investment_position_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", previousBatchId)
    .eq("household_id", householdId);
  if ((count ?? 0) === 0) {
    await supabase.from("investment_import_batches").delete().eq("id", previousBatchId).eq("household_id", householdId);
  }

  return { error: null };
}

/**
 * Save a whole holding from the edit form: what it is, where it is filed, and
 * every figure on it.
 *
 * The form is the only place these are typed, so it writes them in one go —
 * an inline cell per figure meant five round trips and five chances to leave
 * the row half-updated. Nothing is derived from anything else: Victor copies
 * all of it off the brokerage statement, so computing gain from value minus
 * cost basis would overwrite the gain he had just entered.
 */
export async function saveHolding(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const positionId = String(formData.get("positionId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
  const securityName = String(formData.get("securityName") ?? "").trim();
  if (!positionId) return { error: "That holding could not be identified." };
  if (!accountId) return { error: "Choose an account for this holding." };
  if (!ticker && !securityName) return { error: "Enter a ticker or a name for this holding." };

  const marketValue = parseMoney(String(formData.get("marketValue") ?? ""));
  if (marketValue == null) return { error: "Enter the current value." };

  // The URL is rendered as a link, so only http(s) is accepted — a javascript:
  // or data: URL stored here would run when the link was clicked.
  const urlRaw = String(formData.get("url") ?? "").trim();
  let url: string | null = null;
  if (urlRaw) {
    const withScheme = /^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
      url = parsed.toString();
    } catch {
      return { error: "That website address could not be read. Use a link like https://…" };
    }
  }

  const destinationError = await validateDestination(supabase, householdId, { accountId, bucketId });
  if (destinationError) return { error: destinationError };

  const refiled = await refileHolding(supabase, householdId, positionId, accountId, bucketId);
  if (refiled.error) return { error: refiled.error };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  const marketValueCents = toCents(marketValue)!;
  const blankToNull = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw === "" ? null : raw;
  };
  const costBasis = blankToNull("costBasis");
  const gain = blankToNull("gain");
  const gainPercent = blankToNull("gainPercent");

  const { error } = await supabase
    .from("investment_position_snapshots")
    .update({
      symbol: ticker || null,
      security_name: securityName || ticker,
      quantity,
      market_value_cents: marketValueCents,
      cost_basis_cents: costBasis == null ? null : toCents(parseMoney(costBasis)),
      unrealized_gain_cents: gain == null ? null : toCents(parseMoney(gain)),
      unrealized_gain_percent: gainPercent == null ? null : parseQuantity(gainPercent),
      // Price is the one figure nobody types and nothing displays; keep it in
      // step with the two that define it rather than letting it drift.
      price_cents: quantity && quantity > 0 ? Math.round(marketValueCents / quantity) : null,
      url,
      entry_source: "manual",
    })
    .eq("id", positionId)
    .eq("household_id", householdId);
  if (error) return { error: "That holding could not be saved. Please try again." };

  revalidatePath("/invest");
  return { error: null };
}

/** Remove one holding, and its ledger if it was the last one there. */
export async function deleteHolding(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const positionId = String(formData.get("positionId") ?? "");
  if (!positionId) return { error: "That holding could not be identified." };

  const holding = unwrap(
    await supabase
      .from("investment_position_snapshots")
      .select("import_batch_id, as_of_date")
      .eq("id", positionId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "investment_position_snapshots",
  );
  if (!holding) return { error: "That holding could not be found." };

  const { error } = await supabase
    .from("investment_position_snapshots")
    .delete()
    .eq("id", positionId)
    .eq("household_id", householdId);
  if (error) return { error: "That holding could not be removed. Please try again." };

  await syncLedgerSummary(supabase, householdId, holding.import_batch_id, "investment_position_snapshots", holding.as_of_date);
  const { count } = await supabase
    .from("investment_position_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", holding.import_batch_id)
    .eq("household_id", householdId);
  if ((count ?? 0) === 0) {
    await supabase.from("investment_import_batches").delete().eq("id", holding.import_batch_id).eq("household_id", householdId);
  }

  revalidatePath("/invest");
  return { error: null };
}
