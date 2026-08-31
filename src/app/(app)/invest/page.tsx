import { captureSnapshots } from "@/lib/snapshots";
import {
  InvestBoard,
  type BoardTab,
  type InvestAccount,
  type BucketRow,
  type InvestmentImportView,
  type YearCell,
} from "./invest-board";
import type { SavingsCardData } from "./savings-panel";
import type { CashReserveRow, CashReservesData } from "./cash-reserves";
import type { AccountOption, SubOption } from "../budget/types";
import { getSessionContext } from "@/lib/auth-context";
import { ensureCategories } from "@/lib/categories";
import { capsForYear, latestCapYear, pendingCapYear } from "@/lib/contribution-limits";
import {
  fundSlotFor,
  investSlotKey,
  periodStartFor,
  resolveContributedCents,
  signedContributionCents,
} from "@/lib/fund-contributions";
import { throwIfAny } from "@/lib/supabase-result";
import { CAP_KIND_LABEL, capKindFor, resolveRetirementKind } from "@/lib/retirement-kind";

export const metadata = { title: "Invest / Savings · Capitall" };

// History goes back to the sheet's earliest investment year.
const FLOOR_YEAR = 2023;

// Whole calendar months from today to a YYYY-MM-DD target date (day-of-month
// ignored — Monthly contributions are a monthly cadence, so day precision
// inside a month isn't meaningful here). Negative means the date has passed.
function monthsUntil(target: string): number {
  const [ty, tm] = target.split("-").map(Number);
  const now = new Date();
  return (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth());
}

export default async function InvestPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, household } = await getSessionContext();
  // Resolved server-side so a deep link (/savings redirects here) opens on the
  // right tab without a client-side flash.
  const initialTab: BoardTab = (await searchParams).tab === "savings" ? "savings" : "portfolio";

  // Freeze this month's balances into snapshots, same as Net Worth — that's the
  // series the year-end balances and the cash-reserve sparklines read from.
  await captureSnapshots(supabase, household.id);

  const now = new Date();
  const nowYear = now.getFullYear();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const currentMonthKey = monthKey.slice(0, 7);
  // Three complete months back — the current month is partial and would make
  // the burn rate look artificially low.
  const essentialFromMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();

  const categories = await ensureCategories(supabase, household.id);
  const savingsCategoryIds = categories.filter((c) => c.kind === "savings").map((c) => c.id);
  const incomeCategoryIds = categories.filter((c) => c.kind === "income").map((c) => c.id);
  // BILLS ONLY are the "essential monthly spend" an emergency fund has to
  // cover — the obligations that keep arriving whatever happens. Expenses,
  // savings and debt principal are deliberately excluded: in a real emergency
  // discretionary spending stops, so counting it would overstate the runway
  // needed and understate the months of cover.
  const essentialCategoryIds = categories
    .filter((c) => c.kind === "bills")
    .map((c) => c.id);

  const { data: subs, error: subsError } = await supabase
    .from("subcategories")
    .select("id, category_id, name, sort_order, linked_bucket_id, linked_account_id")
    .eq("household_id", household.id)
    .order("sort_order");
  throwIfAny({ subs: subsError });

  const savingsSubs = (subs ?? []).filter((s) => savingsCategoryIds.includes(s.category_id));
  const savingsSubIds = savingsSubs.map((s) => s.id);
  const incomeSubIds = (subs ?? [])
    .filter((s) => incomeCategoryIds.includes(s.category_id))
    .map((s) => s.id);
  const essentialSubIds = (subs ?? [])
    .filter((s) => essentialCategoryIds.includes(s.category_id))
    .map((s) => s.id);

  const [
    { data: allAccountRows, error: allAccountRowsError },
    { data: bucketRows, error: bucketRowsError },
    { data: accSnaps, error: accSnapsError },
    { data: bucketSnaps, error: bucketSnapsError },
    { data: contribRows, error: contribRowsError },
    { data: monthContribRows, error: monthContribRowsError },
    { data: yearRows, error: yearRowsError },
    { data: savingsGoals, error: savingsGoalsError },
    { data: savingsTx, error: savingsTxError },
    { data: plans, error: plansError },
    { data: payees, error: payeesError },
    { data: incomeActuals, error: incomeActualsError },
    { data: essentialActuals, error: essentialActualsError },
    { data: storedCapRows, error: storedCapRowsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, name, holder, kind, subtype, is_kids_account, active, sort_order, current_balance_cents, tax_treatment, retirement_kind",
      )
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, sort_order, tax_treatment, retirement_kind, holder")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("account_snapshots")
      .select("month, account_id, balance_cents")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("bucket_snapshots")
      .select("month, bucket_id, balance_cents")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("v_investment_contributions")
      .select("account_id, bucket_id, year, net_contribution_cents")
      .eq("household_id", household.id),
    // Month-grained companion view — the hero's "Contributed this month".
    supabase
      .from("v_investment_contributions_monthly")
      .select("account_id, net_contribution_cents")
      .eq("household_id", household.id)
      .eq("month", monthKey),
    supabase
      .from("investment_years")
      .select("account_id, bucket_id, year, contributed_cents, accrued_cents, start_cents, end_cents")
      .eq("household_id", household.id),
    savingsSubIds.length
      ? supabase
          .from("savings_goals")
          .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
          .eq("household_id", household.id)
      : Promise.resolve({ data: [], error: null }),
    savingsSubIds.length
      ? supabase
          .from("transactions")
          .select("id, subcategory_id, amount_cents, is_withdrawal, payee_id, occurred_on, account_id")
          .eq("household_id", household.id)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [], error: null }),
    savingsSubIds.length
      ? supabase
          .from("budget_plans")
          .select("subcategory_id, planned_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [], error: null }),
    // Names only — used server-side (payeeNameById) to label withdrawals. The
    // autocomplete list is fetched on demand by the client (listPayees).
    supabase.from("payees").select("id, name").eq("household_id", household.id),
    incomeSubIds.length
      ? supabase
          .from("v_monthly_actuals")
          .select("subcategory_id, actual_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", incomeSubIds)
      : Promise.resolve({ data: [], error: null }),
    // Trailing essential spend, for emergency-fund months-of-cover.
    essentialSubIds.length
      ? supabase
          .from("v_monthly_actuals")
          .select("month, actual_cents")
          .eq("household_id", household.id)
          .gte("month", essentialFromMonth)
          .lt("month", monthKey)
          .in("subcategory_id", essentialSubIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("contribution_caps")
      .select("tax_year, elective_deferral_cents, ira_cents")
      .eq("household_id", household.id),
  ]);
  throwIfAny({
    allAccountRows: allAccountRowsError,
    bucketRows: bucketRowsError,
    accSnaps: accSnapsError,
    bucketSnaps: bucketSnapsError,
    contribRows: contribRowsError,
    monthContribRows: monthContribRowsError,
    yearRows: yearRowsError,
    savingsGoals: savingsGoalsError,
    savingsTx: savingsTxError,
    plans: plansError,
    payees: payeesError,
    incomeActuals: incomeActualsError,
    essentialActuals: essentialActualsError,
    storedCapRows: storedCapRowsError,
  });

  const allAccounts = allAccountRows ?? [];
  // Same set the board has always shown: investment accounts, plus kids
  // accounts of any kind (the 529s live under a checking-kind Fidelity).
  const accounts = allAccounts.filter((a) => a.kind === "investment" || a.is_kids_account);
  const investIds = new Set(accounts.map((a) => a.id));

  // ---- Portfolio -----------------------------------------------------------

  // Raw bucket rows per account — the cap maths needs `retirement_kind` and
  // `holder`, which the display-shaped map below drops.
  const bucketRawByAccount = new Map<string, (typeof bucketRows extends (infer T)[] | null ? T : never)[]>();
  for (const b of bucketRows ?? []) {
    if (!investIds.has(b.account_id)) continue;
    const arr = bucketRawByAccount.get(b.account_id) ?? [];
    arr.push(b);
    bucketRawByAccount.set(b.account_id, arr);
  }

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
    contribBy.set(
      investSlotKey(c.account_id, c.bucket_id ?? null, c.year),
      c.net_contribution_cents ?? 0,
    );
  }

  // Stored/reviewed rows.
  const storedBy = new Map<
    string,
    { contributed: number; accrued: number; start: number | null; end: number | null }
  >();
  for (const r of yearRows ?? []) {
    const key = investSlotKey(r.account_id, r.bucket_id ?? null, r.year);
    storedBy.set(key, {
      contributed: r.contributed_cents ?? 0,
      accrued: r.accrued_cents ?? 0,
      start: r.start_cents ?? null,
      end: r.end_cents ?? null,
    });
  }

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
    // The rule lives in @/lib/fund-contributions so the savings tab resolves
    // the same money the same way — this slot used to read `seed + live`,
    // which counted every 2026 contribution twice.
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

  // Hero figure: net contributions into the family's investment accounts this
  // calendar month. Kids accounts are excluded to match the portfolio summary,
  // which is also family-only.
  const contributedThisMonthCents = (monthContribRows ?? [])
    .filter((row) => {
      const account = allAccounts.find((a) => a.id === row.account_id);
      return account != null && !account.is_kids_account;
    })
    .reduce((sum, row) => sum + (row.net_contribution_cents ?? 0), 0);

  const destAccounts = allAccounts
    .filter(
      (a) =>
        a.active &&
        (a.kind === "checking" || a.kind === "savings_bucket" || a.kind === "credit_card"),
    )
    .map((a) => ({ id: a.id, name: a.name }));

  // ---- Imported holdings & performance -------------------------------------

  const { data: importBatches, error: importBatchesError } = await supabase
    .from("investment_import_batches")
    .select(
      "id, account_id, bucket_id, provider, import_kind, as_of_date, source_filename, row_count, created_at",
    )
    .eq("household_id", household.id)
    .order("created_at", { ascending: false })
    .limit(12);
  throwIfAny({ importBatches: importBatchesError });

  const batchIds = (importBatches ?? []).map((batch) => batch.id);
  const [
    { data: positionRows, error: positionRowsError },
    { data: performanceRows, error: performanceRowsError },
  ] = batchIds.length > 0
    ? await Promise.all([
        supabase
          .from("investment_position_snapshots")
          .select(
            "id, import_batch_id, as_of_date, symbol, security_name, quantity, price_cents, market_value_cents, cost_basis_cents, unrealized_gain_cents, unrealized_gain_percent, url",
          )
          .eq("household_id", household.id)
          .in("import_batch_id", batchIds)
          .order("market_value_cents", { ascending: false })
          .limit(2000),
        supabase
          .from("investment_performance_snapshots")
          .select(
            "import_batch_id, as_of_date, entry_source, beginning_balance_cents, contributions_cents, withdrawals_cents, dividends_cents, fees_cents, market_change_cents, ending_balance_cents",
          )
          .eq("household_id", household.id)
          .in("import_batch_id", batchIds)
          .order("as_of_date", { ascending: false })
          .limit(2000),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  throwIfAny({ positionRows: positionRowsError, performanceRows: performanceRowsError });

  const accountNameById = new Map(allAccounts.map((account) => [account.id, account.name]));
  const bucketNameById = new Map((bucketRows ?? []).map((bucket) => [bucket.id, bucket.name]));
  const positionsByBatch = new Map<string, InvestmentImportView["positions"]>();
  for (const row of positionRows ?? []) {
    const values = positionsByBatch.get(row.import_batch_id) ?? [];
    values.push({
      id: row.id,
      asOfDate: row.as_of_date,
      symbol: row.symbol ?? null,
      securityName: row.security_name,
      quantity: row.quantity ?? null,
      priceCents: row.price_cents ?? null,
      marketValueCents: row.market_value_cents ?? 0,
      costBasisCents: row.cost_basis_cents ?? null,
      unrealizedGainCents: row.unrealized_gain_cents ?? null,
      unrealizedGainPercent: row.unrealized_gain_percent ?? null,
      url: row.url ?? null,
    });
    positionsByBatch.set(row.import_batch_id, values);
  }
  const performanceByBatch = new Map<string, InvestmentImportView["performance"]>();
  for (const row of performanceRows ?? []) {
    const values = performanceByBatch.get(row.import_batch_id) ?? [];
    values.push({
      asOfDate: row.as_of_date,
      entrySource: row.entry_source === "manual" ? "manual" : "csv",
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

  // ---- Savings & contributions ---------------------------------------------

  const isKidsAccountById = new Map(allAccounts.map((a) => [a.id, a.is_kids_account ?? false]));
  const payeeNameById = new Map((payees ?? []).map((payee) => [payee.id, payee.name]));
  const accountIdByBucket = new Map((bucketRows ?? []).map((b) => [b.id, b.account_id]));
  const incomeReceivedCents = (incomeActuals ?? []).reduce(
    (sum, row) => sum + Math.max(0, row.actual_cents ?? 0),
    0,
  );

  // Average essential spend across the complete months we actually have,
  // rather than a fixed divisor — a partial history shouldn't deflate it.
  const essentialByMonth = new Map<string, number>();
  for (const row of essentialActuals ?? []) {
    const m = (row as { month: string }).month;
    essentialByMonth.set(m, (essentialByMonth.get(m) ?? 0) + Math.abs(row.actual_cents ?? 0));
  }
  const essentialMonths = [...essentialByMonth.values()];
  const monthlyEssentialCents =
    essentialMonths.length > 0
      ? Math.round(essentialMonths.reduce((s, v) => s + v, 0) / essentialMonths.length)
      : null;

  // ---- Cash reserves --------------------------------------------------------
  //
  // Buckets under savings/cash accounts. Deliberately NOT filtered by whether a
  // savings goal exists: there is no savings budget item right now, so a
  // goal-driven list would be empty while ~$170k sits in these buckets.
  // Checking accounts are excluded — day-to-day balances aren't reserves.
  const reserveAccountIds = new Set(
    allAccounts
      .filter((a) => !a.is_kids_account && (a.kind === "savings_bucket" || a.kind === "cash"))
      .map((a) => a.id),
  );
  const goalByBucketId = new Map<
    string,
    { goalCents: number; monthlyCents: number }
  >();
  for (const s of savingsSubs) {
    if (!s.linked_bucket_id) continue;
    const g = (savingsGoals ?? []).find((x) => x.subcategory_id === s.id);
    if (!g) continue;
    goalByBucketId.set(s.linked_bucket_id, {
      goalCents: g.goal_cents ?? 0,
      monthlyCents: g.monthly_contribution_cents ?? 0,
    });
  }
  const cashRows: CashReserveRow[] = (bucketRows ?? [])
    .filter((b) => reserveAccountIds.has(b.account_id))
    .map((b) => {
      const goal = goalByBucketId.get(b.id) ?? null;
      return {
        id: b.id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
        // Only decides whether the months-of-cover track is drawn under this
        // row — the balance itself is never gated on the name matching.
        isEmergencyFund: /emergency/i.test(b.name ?? ""),
        goalCents: goal ? goal.goalCents : null,
        plannedMonthlyCents: goal ? goal.monthlyCents : null,
      };
    })
    .sort((a, b) => b.balanceCents - a.balanceCents);
  const cashReserves: CashReservesData = {
    rows: cashRows,
    totalCents: cashRows.reduce((s, r) => s + r.balanceCents, 0),
    monthlyEssentialCents,
    basisMonths: essentialMonths.length,
  };

  // ---- Contribution limits --------------------------------------------------
  //
  // Tax-advantaged accounts have hard annual caps, and overshooting one is a
  // correctable-but-unpleasant tax event while undershooting is simply lost
  // room that doesn't roll over.
  //
  // Sourced from the investment ACCOUNTS (and their buckets), not from savings
  // subcategories. Reading it off goals meant a tax-advantaged account with no
  // savings goal was silently absent from the cap maths — Charles Schwab's Roth
  // IRA was, so the "still allowed" figure was overstated by everything
  // contributed there.
  //
  // Caps are keyed by the current tax year, so January doesn't silently start
  // measuring against last year's figures. Anything entered from this page
  // (contribution_caps) wins over the built-in table; a year in neither yields
  // null and the card says so rather than showing a stale cap.
  const capYear = nowYear;
  const storedCaps: Record<number, { electiveDeferralCents: number; iraCents: number }> =
    Object.fromEntries(
      (storedCapRows ?? []).map((r) => [
        r.tax_year,
        { electiveDeferralCents: r.elective_deferral_cents, iraCents: r.ira_cents },
      ]),
    );
  const caps = capsForYear(capYear, storedCaps);

  // Caps are per PERSON, and Traditional + Roth IRAs share ONE limit between
  // them. That makes the grouping key (holder, capKind) rather than the slot:
  //
  //  - Elective deferral (TSP/401k) is one limit across a person's whole plan.
  //    TSP holds a Roth bucket and a Traditional bucket; a row each would have
  //    invented a second $23.5k of room that does not exist.
  //  - A second Roth IRA at another brokerage is NOT a second $7,500. Charles
  //    Schwab and the Fidelity Roth draw on the same limit for the same person,
  //    so they roll into one row showing the combined usage.
  //
  // Which kind a slot is comes from `retirement_kind` when set, and falls back
  // to reading the name only when it isn't — that fallback is flagged, because
  // a guess deciding how much room is left is exactly how a wrong number gets
  // presented confidently.
  type CapGroup = {
    holder: string | null;
    capKind: "ira" | "electiveDeferral";
    contributedCents: number;
    slotNames: string[];
    inferred: boolean;
    unattributed: boolean;
  };
  const capGroups = new Map<string, CapGroup>();

  if (caps) {
    for (const a of accounts) {
      if (a.is_kids_account) continue;
      const accountHolder = ((a.holder as string | null) ?? "").trim() || null;
      const acctBuckets = bucketRawByAccount.get(a.id) ?? [];
      const slots =
        acctBuckets.length === 0
          ? [
              {
                key: investSlotKey(a.id, null, capYear),
                label: a.name,
                bucketKind: null as string | null,
                bucketName: null as string | null,
                holder: accountHolder,
              },
            ]
          : acctBuckets.map((b) => ({
              key: investSlotKey(a.id, b.id, capYear),
              // A bucket name already carries its brokerage ("TSP Roth",
              // "Fidelity Roth Vic"), so prefixing the account repeats it —
              // same rule as ledgerLabel on the portfolio tab.
              label: b.name,
              bucketKind: (b.retirement_kind as string | null) ?? null,
              bucketName: b.name as string | null,
              // A brokerage can hold a Roth for each spouse, so the bucket's
              // own holder wins over the account's.
              holder: ((b.holder as string | null) ?? "").trim() || accountHolder,
            }));

      for (const slot of slots) {
        const { kind, inferred } = resolveRetirementKind({
          bucketKind: slot.bucketKind,
          accountKind: (a.retirement_kind as string | null) ?? null,
          bucketName: slot.bucketName,
          accountName: a.name,
          accountSubtype: a.subtype ?? null,
        });
        if (!kind) continue;
        const capKind = capKindFor(kind);
        // Without a holder the slot can't be attributed to a person. Grouping
        // every such slot together is the conservative read: it can understate
        // room, never overstate it, and the card says a holder is missing.
        const groupKey = `${capKind}:${slot.holder ?? "__unattributed__"}`;
        const existing = capGroups.get(groupKey);
        const contributed = Math.max(0, contribBy.get(slot.key) ?? 0);
        if (existing) {
          existing.contributedCents += contributed;
          existing.slotNames.push(slot.label);
          existing.inferred = existing.inferred || inferred;
          existing.unattributed = existing.unattributed || slot.holder == null;
        } else {
          capGroups.set(groupKey, {
            holder: slot.holder,
            capKind,
            contributedCents: contributed,
            slotNames: [slot.label],
            inferred,
            unattributed: slot.holder == null,
          });
        }
      }
    }
  }

  const contributionLimits = !caps
    ? []
    : [...capGroups.entries()].map(([groupKey, g]) => ({
        subId: groupKey,
        // The person is the subject of the limit, so they lead. The accounts
        // that feed the row are named underneath rather than lost.
        name: g.holder ?? "Holder not set",
        kind: CAP_KIND_LABEL[g.capKind],
        sourceNames: g.slotNames,
        capKind: g.capKind,
        limitCents:
          g.capKind === "electiveDeferral" ? caps.electiveDeferralCents : caps.iraCents,
        contributedCents: g.contributedCents,
        inferredKind: g.inferred,
        needsHolder: g.unattributed,
      }));

  // ---- Savings goal cards ---------------------------------------------------

  const withdrawalSubOptions: SubOption[] = savingsSubs.map((sub) => ({
    id: sub.id,
    name: sub.name,
    kind: "savings",
    linkedBucketId: sub.linked_bucket_id ?? null,
  }));
  const withdrawalAccountOptions: AccountOption[] = allAccounts
    .filter(
      (account) =>
        account.kind === "checking" ||
        account.kind === "savings_bucket" ||
        account.kind === "cash" ||
        account.kind === "credit_card",
    )
    .map((account) => ({
      id: account.id,
      name: account.name,
      group: account.kind === "credit_card" ? "Credit Cards" : "Banking",
    }));

  const goalBySub = new Map((savingsGoals ?? []).map((g) => [g.subcategory_id, g]));
  const plannedBySub = new Map(
    (plans ?? []).map((p) => [p.subcategory_id, p.planned_cents as number]),
  );
  const monthDepositsBySub = new Map<string, number>();
  const monthWithdrawalsBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    if (t.occurred_on.startsWith(currentMonthKey)) {
      const target = t.is_withdrawal ? monthWithdrawalsBySub : monthDepositsBySub;
      target.set(t.subcategory_id, (target.get(t.subcategory_id) ?? 0) + t.amount_cents);
    }
  }

  // Contributions-to-date per goal, summed from transactions inside the goal's
  // own period.
  //
  // The period and the netting rule come from @/lib/fund-contributions, which
  // the portfolio tab reads too — same window (calendar year), same treatment
  // of withdrawals. That shared definition is what keeps a goal card's figure
  // equal to its account's Contrib column; they drifted apart once already when
  // each owned a private copy.
  //
  // `start_cents` is still honoured as an opening balance for goals that have
  // no transactions in the period yet, so nothing regresses on a fresh goal.
  const periodNetBySub = new Map<string, number>();
  const periodTxCountBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    const goal = goalBySub.get(t.subcategory_id);
    const from = periodStartFor((goal?.target_date as string | null) ?? null, now);
    if (t.occurred_on < from) continue;
    periodNetBySub.set(
      t.subcategory_id,
      (periodNetBySub.get(t.subcategory_id) ?? 0) + signedContributionCents(t),
    );
    periodTxCountBySub.set(
      t.subcategory_id,
      (periodTxCountBySub.get(t.subcategory_id) ?? 0) + 1,
    );
  }

  // Per-subcategory transaction lists for the expanded goal details (most
  // recent first, cap at 12).
  const txsBySub = new Map<string, SavingsCardData["transactions"]>();
  for (const t of savingsTx ?? []) {
    if (!txsBySub.has(t.subcategory_id)) txsBySub.set(t.subcategory_id, []);
    txsBySub.get(t.subcategory_id)!.push({
      id: t.id,
      date: t.occurred_on,
      payee: t.payee_id ? payeeNameById.get(t.payee_id) ?? null : null,
      amountCents: t.amount_cents,
      isWithdrawal: t.is_withdrawal,
      accountName: t.account_id ? accountNameById.get(t.account_id) ?? null : null,
    });
  }
  for (const [k, arr] of txsBySub) {
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    txsBySub.set(k, arr.slice(0, 12));
  }

  const cards: SavingsCardData[] = savingsSubs.map((s) => {
    // Which account this goal's money actually lands in. Bucket link wins over
    // account link — same precedence the portfolio tab resolves contributions
    // with, so a goal can't be filed under one account here and another there.
    const slot = fundSlotFor(
      {
        linkedBucketId: s.linked_bucket_id ?? null,
        linkedAccountId: (s as { linked_account_id?: string | null }).linked_account_id ?? null,
      },
      accountIdByBucket,
    );
    const isKids = slot ? (isKidsAccountById.get(slot.accountId) ?? false) : false;

    const g = goalBySub.get(s.id);
    const goalCents = g?.goal_cents ?? 0;
    const startCents = g?.start_cents ?? 0;
    const monthlyCents = g?.monthly_contribution_cents ?? 0;
    const targetDate = (g?.target_date as string | null) ?? null;
    const plannedCents = plannedBySub.get(s.id) ?? 0;
    const monthDepositsCents = monthDepositsBySub.get(s.id) ?? 0;
    const monthWithdrawalsCents = monthWithdrawalsBySub.get(s.id) ?? 0;
    const monthNetCents = monthDepositsCents - monthWithdrawalsCents;
    const periodNetCents = periodNetBySub.get(s.id) ?? 0;
    const hasPeriodTx = (periodTxCountBySub.get(s.id) ?? 0) > 0;
    const savedCents = hasPeriodTx ? periodNetCents : startCents;
    const leftToSaveCents = goalCents - savedCents;
    const reached = goalCents > 0 && leftToSaveCents <= 0;

    let pace: SavingsCardData["pace"] = "none";
    let requiredMonthlyCents: number | null = null;
    if (reached) {
      pace = "reached";
    } else if (targetDate && goalCents > 0) {
      const months = monthsUntil(targetDate);
      if (months <= 0) {
        pace = "overdue";
        requiredMonthlyCents = leftToSaveCents;
      } else {
        // Treat this month's planned contribution as already made — Victor
        // logs savings at end of month, so give the month a chance to land
        // before flagging behind. Required = what's needed each future month
        // after this month's planned amount comes through.
        const projectedLeft = Math.max(0, leftToSaveCents - plannedCents);
        requiredMonthlyCents = Math.ceil(projectedLeft / months);
        pace = plannedCents >= requiredMonthlyCents ? "on_track" : "behind";
      }
    }

    return {
      id: s.id,
      name: s.name,
      goalCents,
      startCents,
      savedCents,
      monthlyCents,
      plannedCents,
      leftToSaveCents,
      targetDate,
      pace,
      requiredMonthlyCents,
      monthDepositsCents,
      monthWithdrawalsCents,
      monthNetCents,
      transactions: txsBySub.get(s.id) ?? [],
      isKids,
    };
  });

  const currentMonthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <InvestBoard
      accounts={data}
      years={years}
      currency={household.currency}
      destAccounts={destAccounts}
      imports={imports}
      contributedThisMonthCents={contributedThisMonthCents}
      currentMonthLabel={currentMonthLabel}
      initialTab={initialTab}
      savings={{
        cards,
        currency: household.currency,
        cashReserves,
        contributionLimits,
        capYear,
        capsPublished: caps != null,
        latestCapYear: latestCapYear(storedCaps),
        pendingCapYear: pendingCapYear(now, storedCaps),
        seedCaps: caps,
        incomeReceivedCents,
        currentMonthKey,
        currentMonthLabel,
        withdrawalSubOptions,
        withdrawalAccountOptions,
        firstOfMonth: monthKey,
      }}
    />
  );
}
