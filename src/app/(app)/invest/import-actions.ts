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
