import { captureSnapshots } from "@/lib/snapshots";
import { InvestBoard, type InvestAccount, type BucketRow, type InvestmentImportView, type YearCell } from "./invest-board";
import { getSessionContext } from "@/lib/auth-context";
import { investSlotKey, resolveContributedCents } from "@/lib/fund-contributions";
import { throwIfAny } from "@/lib/supabase-result";

export const metadata = { title: "Investments · Capitall" };

// History goes back to the sheet's earliest investment year.
const FLOOR_YEAR = 2023;

export default async function InvestPage() {
  const { supabase, household } = await getSessionContext();

  // Freeze this month's balances into snapshots, same as Net Worth — that's the
  // series the year-end balances are read from.
  await captureSnapshots(supabase, household.id);

  const [
    { data: accountRows, error: accountRowsError },
    { data: bucketRows, error: bucketRowsError },
    { data: accSnaps, error: accSnapsError },
    { data: contribRows, error: contribRowsError },
    { data: yearRows, error: yearRowsError },
    { data: bankingRows, error: bankingRowsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, holder, subtype, is_kids_account, sort_order, current_balance_cents, tax_treatment")
      .eq("household_id", household.id)
      .or("kind.eq.investment,is_kids_account.eq.true")
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, sort_order, tax_treatment")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("account_snapshots")
      .select("month, account_id, balance_cents")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("v_investment_contributions")
      .select("account_id, bucket_id, year, net_contribution_cents")
      .eq("household_id", household.id),
    supabase
      .from("investment_years")
      .select("account_id, bucket_id, year, contributed_cents, accrued_cents, start_cents, end_cents")
      .eq("household_id", household.id),
    supabase
      .from("accounts")
      .select("id, name, kind")
      .eq("household_id", household.id)
      .eq("active", true)
      .in("kind", ["checking", "savings_bucket", "credit_card"])
      .order("sort_order")
      .order("name"),
  ]);
  throwIfAny({ accountRows: accountRowsError, bucketRows: bucketRowsError, accSnaps: accSnapsError, contribRows: contribRowsError, yearRows: yearRowsError, bankingRows: bankingRowsError });

  const accounts = accountRows ?? [];
  const investIds = new Set(accounts.map((a) => a.id));

  // Buckets that live under investment accounts.
  const bucketsByAccount = new Map<
    string,
    { id: string; name: string; balanceCents: number; taxTreatment: string | null }[]
  >();
  for (const b of bucketRows ?? []) {
    if (!investIds.has(b.account_id)) continue;
    const arr = bucketsByAccount.get(b.account_id) ?? [];
    arr.push({
      id: b.id,
      name: b.name,
      balanceCents: b.balance_cents ?? 0,
      taxTreatment: (b as { tax_treatment?: string | null }).tax_treatment ?? null,
    });
    bucketsByAccount.set(b.account_id, arr);
  }

  // Per-account year-end balance = balance of the LAST snapshot within that
  // calendar year (Dec if present, otherwise the latest month recorded that
  // year). Snapshots come ordered by month, so a later row overwrites an
  // earlier one for the same account+year.
  const endBalance = new Map<string, number>(); // key `${accountId}:${year}`
  for (const s of accSnaps ?? []) {
    if (!investIds.has(s.account_id)) continue;
    const year = Number(s.month.slice(0, 4));
    endBalance.set(`${s.account_id}:${year}`, s.balance_cents);
  }

  // Live-derived net contributions per (account, bucket, year).
  const contribBy = new Map<string, number>();
  for (const c of contribRows ?? []) {
    contribBy.set(investSlotKey(c.account_id, c.bucket_id ?? null, c.year), c.net_contribution_cents ?? 0);
  }

  // Stored/reviewed rows.
  const storedBy = new Map<string, { contributed: number; accrued: number; start: number | null; end: number | null }>();
  for (const r of yearRows ?? []) {
    const key = investSlotKey(r.account_id, r.bucket_id ?? null, r.year);
    storedBy.set(key, {
      contributed: r.contributed_cents ?? 0,
      accrued: r.accrued_cents ?? 0,
      start: r.start_cents ?? null,
      end: r.end_cents ?? null,
    });
  }

  const nowYear = new Date().getFullYear();

  // Which years to show: the union of every year we have data for, always
  // including the current year, floored at FLOOR_YEAR, newest first.
  const yearSet = new Set<number>([nowYear]);
  for (const r of yearRows ?? []) yearSet.add(r.year);
  for (const c of contribRows ?? []) yearSet.add(c.year);
  for (const s of accSnaps ?? []) {
    if (investIds.has(s.account_id)) yearSet.add(Number(s.month.slice(0, 4)));
  }
  const years = [...yearSet].filter((y) => y >= FLOOR_YEAR).sort((a, b) => b - a);

  // Build a YearCell for a specific (account, bucket, year) slot. `bucketKey` is
  // the bucket_id or "_" for the account-level (no-bucket) slot.
  function buildCell(
    accountId: string,
    bucketKey: string,
    year: number,
    fallbackEnd: number | null,
  ): YearCell {
    const key = investSlotKey(accountId, bucketKey === "_" ? null : bucketKey, year);
    const stored = storedBy.get(key);

    // Ledger for the year in progress, reviewed row for years already closed.
    // The rule lives in @/lib/fund-contributions so /savings resolves the same
    // money the same way — this slot used to read `seed + live`, which counted
    // every 2026 contribution twice.
    const contributed = resolveContributedCents({
      storedCents: stored ? stored.contributed : null,
      liveCents: contribBy.get(key) ?? 0,
      hasLive: contribBy.has(key),
      isCurrentYear: year === nowYear,
    });

    const start = stored?.start ?? null;
    const end = stored?.end ?? fallbackEnd;

    let accrued: number;
    if (stored) {
      accrued = stored.accrued;
    } else {
      accrued = start != null && end != null ? end - start - contributed : 0;
    }

    return {
      year,
      startBalanceCents: start,
      endBalanceCents: end,
      contributedCents: contributed,
      accruedCents: accrued,
      stored: !!stored,
      // True when `contributed` was summed from the transaction ledger rather
      // than read from investment_years. Typing over such a cell writes a row
      // that resolveContributedCents then ignores for the year in progress, so
      // the table renders these read-only instead of pretending they take.
      contribFromLedger: year === nowYear && contribBy.has(key),
    };
  }

  const data: InvestAccount[] = accounts.map((a) => {
    const acctBuckets = bucketsByAccount.get(a.id) ?? [];

    // Bucket rows carry their own cells. Fallback end for the current year =
    // bucket's live balance (buckets don't have per-month snapshots today, so
    // the current balance is the best-available "now" number).
    const buckets: BucketRow[] = acctBuckets.map((b) => {
      const cells: Record<number, YearCell> = {};
      for (const year of years) {
        const fallbackEnd = year === nowYear ? b.balanceCents : null;
        cells[year] = buildCell(a.id, b.id, year, fallbackEnd);
      }
      return {
        id: b.id,
        name: b.name,
        balanceCents: b.balanceCents,
        taxTreatment: b.taxTreatment,
        cells,
      };
    });

    // Account-level cells. When the account has buckets we still keep an
    // account-level slot (bucket_id NULL) because seeded CSV rows live there.
    // Rendering rolls up bucket rows plus this slot's stored contribution so
    // the seed floor is preserved.
    //
    // The snapshot fallback is deliberately skipped once an account has
    // buckets. An account snapshot records the WHOLE account, and the buckets
    // already add up to that same whole, so letting the slot fall back to it
    // counts the account's value twice — `effectiveCell` sums the slot and
    // every bucket. Fidelity and Crypto only escaped this because their slots
    // were hand-set to 0; TSP, the moment it was split into Traditional and
    // Roth, inflated Current Value by a whole extra copy of a bucket. Buckets
    // own the balance when they exist, so the slot contributes nothing.
    const cells: Record<number, YearCell> = {};
    for (const year of years) {
      const fallbackEnd = acctBuckets.length > 0 ? null : endBalance.get(`${a.id}:${year}`) ?? null;
      cells[year] = buildCell(a.id, "_", year, fallbackEnd);
    }

    return {
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      subtype: a.subtype ?? null,
      taxTreatment: (a as { tax_treatment?: string | null }).tax_treatment ?? null,
      isKids: !!a.is_kids_account,
      balanceCents: a.current_balance_cents ?? 0,
      sortOrder: a.sort_order ?? 0,
      cells,
      buckets,
    };
  });

  const destAccounts = (bankingRows ?? []).map((a) => ({ id: a.id, name: a.name }));

  const { data: importBatches, error: importBatchesError } = await supabase
    .from("investment_import_batches")
    .select("id, account_id, bucket_id, provider, import_kind, as_of_date, source_filename, row_count, created_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: false })
    .limit(12);
  throwIfAny({ importBatches: importBatchesError });

  const batchIds = (importBatches ?? []).map((batch) => batch.id);
  const [{ data: positionRows, error: positionRowsError }, { data: performanceRows, error: performanceRowsError }] = batchIds.length > 0
    ? await Promise.all([
      supabase
        .from("investment_position_snapshots")
        .select("import_batch_id, symbol, security_name, quantity, price_cents, market_value_cents, cost_basis_cents, unrealized_gain_cents, unrealized_gain_percent")
        .eq("household_id", household.id)
        .in("import_batch_id", batchIds)
        .order("market_value_cents", { ascending: false })
        .limit(2000),
      supabase
        .from("investment_performance_snapshots")
        .select("import_batch_id, as_of_date, beginning_balance_cents, contributions_cents, withdrawals_cents, dividends_cents, fees_cents, market_change_cents, ending_balance_cents")
        .eq("household_id", household.id)
        .in("import_batch_id", batchIds)
        .order("as_of_date", { ascending: false })
        .limit(2000),
    ])
    : [{ data: [] }, { data: [] }];
  throwIfAny({ positionRows: positionRowsError, performanceRows: performanceRowsError });

  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  const bucketNameById = new Map((bucketRows ?? []).map((bucket) => [bucket.id, bucket.name]));
  const positionsByBatch = new Map<string, InvestmentImportView["positions"]>();
  for (const row of positionRows ?? []) {
    const values = positionsByBatch.get(row.import_batch_id) ?? [];
    values.push({
      symbol: row.symbol ?? null,
      securityName: row.security_name,
      quantity: row.quantity ?? null,
      priceCents: row.price_cents ?? null,
      marketValueCents: row.market_value_cents ?? 0,
      costBasisCents: row.cost_basis_cents ?? null,
      unrealizedGainCents: row.unrealized_gain_cents ?? null,
      unrealizedGainPercent: row.unrealized_gain_percent ?? null,
    });
    positionsByBatch.set(row.import_batch_id, values);
  }
  const performanceByBatch = new Map<string, InvestmentImportView["performance"]>();
  for (const row of performanceRows ?? []) {
    const values = performanceByBatch.get(row.import_batch_id) ?? [];
    values.push({
      asOfDate: row.as_of_date,
      beginningBalanceCents: row.beginning_balance_cents ?? null,
      contributionsCents: row.contributions_cents ?? null,
      withdrawalsCents: row.withdrawals_cents ?? null,
      dividendsCents: row.dividends_cents ?? null,
      feesCents: row.fees_cents ?? null,
      marketChangeCents: row.market_change_cents ?? null,
      endingBalanceCents: row.ending_balance_cents ?? 0,
    });
    performanceByBatch.set(row.import_batch_id, values);
  }
  const imports: InvestmentImportView[] = (importBatches ?? []).map((batch) => ({
    id: batch.id,
    accountId: batch.account_id,
    bucketId: batch.bucket_id ?? null,
    accountName: accountNameById.get(batch.account_id) ?? "Investment account",
    bucketName: batch.bucket_id ? bucketNameById.get(batch.bucket_id) ?? null : null,
    provider: batch.provider,
    importKind: batch.import_kind === "performance" ? "performance" : "positions",
    asOfDate: batch.as_of_date,
    sourceFilename: batch.source_filename ?? null,
    rowCount: batch.row_count ?? 0,
    createdAt: batch.created_at,
    positions: positionsByBatch.get(batch.id) ?? [],
    performance: performanceByBatch.get(batch.id) ?? [],
  }));

  return <InvestBoard accounts={data} years={years} currency={household.currency} destAccounts={destAccounts} imports={imports} />;
}
