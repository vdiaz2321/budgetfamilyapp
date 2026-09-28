"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { currentMonthFirst } from "@/lib/snapshots";
import { unwrap } from "@/lib/supabase-result";
import {
  estimatePension,
  healthcareForYear,
  incomeForYear,
  retiredShareOfYear,
  type HealthcarePlan,
  type HealthPlan,
  parseHealthPlans,
  rentalsForYear,
  toRentalProperty,
  type IncomeLine,
  type IncomeLineKind,
  type RentalRow,
} from "@/lib/retirement";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

// The grid edits history, so the Net Worth page revalidates. Current-month edits
// also touch live balances, so Accounts + the sidebar layout need it too.
function revalidate() {
  revalidatePath("/networth");
  revalidatePath("/accounts");
  revalidatePath("/", "layout");
}

// Recompute one month's parent account_snapshots row from that month's bucket
// snapshots — the historical analogue of syncAccountFromBuckets (which only
// touches the live balance). Keeps a bucketed account's column equal to the sum
// of its buckets in every past month, not just the current one.
async function syncAccountSnapshotFromBuckets(
  supabase: SupabaseClient,
  householdId: string,
  accountId: string,
  month: string,
) {
  const account = unwrap(
    await supabase
      .from("accounts")
      .select("kind")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account) return;

  // Summed and stored as that month's account snapshot — a failed read would
  // record $0 for the month rather than leaving it alone.
  const { data: snaps, error: snapsError } = await supabase
    .from("bucket_snapshots")
    .select("balance_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("month", month);
  if (snapsError) throw new Error(`Could not read bucket snapshots: ${snapsError.message}`);
  const sum = (snaps ?? []).reduce((s, b) => s + (b.balance_cents ?? 0), 0);

  await supabase.from("account_snapshots").upsert(
    {
      household_id: householdId,
      month,
      account_id: accountId,
      kind: account.kind,
      balance_cents: sum,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,account_id" },
  );
}

// Set one account's balance for one month. Editing the CURRENT month also writes
// the live balance, so the Accounts page stays in sync and captureSnapshots
// re-derives the same value on its next run (no clobber). Editing a PAST month is
// a pure history correction — the live balance is left alone.
export async function setAccountSnapshot(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!accountId || !MONTH_RE.test(month)) return;
  // The grid only edits history. The current month (and anything later) is the
  // Accounts page's balance, re-derived on every save — a write here would be
  // silently undone, so it's refused rather than accepted and lost.
  if (month >= currentMonthFirst()) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const account = unwrap(
    await supabase
      .from("accounts")
      .select("kind")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account) return;

  await supabase.from("account_snapshots").upsert(
    {
      household_id: householdId,
      month,
      account_id: accountId,
      kind: account.kind,
      balance_cents: balanceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,account_id" },
  );

  revalidate();
}

// Set one bucket's balance for one month, then re-derive that month's parent
// account total from all its bucket snapshots. Current-month edits also update
// the live bucket balance (and its parent), matching the Accounts page.
export async function setBucketSnapshot(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const bucketId = String(formData.get("bucketId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!bucketId || !MONTH_RE.test(month)) return;
  // Same rule as setAccountSnapshot: history only.
  if (month >= currentMonthFirst()) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const bucket = unwrap(
    await supabase
      .from("buckets")
      .select("account_id")
      .eq("id", bucketId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "buckets",
  );
  if (!bucket) return;

  await supabase.from("bucket_snapshots").upsert(
    {
      household_id: householdId,
      month,
      bucket_id: bucketId,
      account_id: bucket.account_id,
      balance_cents: balanceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,bucket_id" },
  );

  await syncAccountSnapshotFromBuckets(supabase, householdId, bucket.account_id, month);

  revalidate();
}

// Set one debt's balance for one month. The liability half of
// setAccountSnapshot, and it follows the same rule: history only. The current
// month's balance belongs to Debt/Loans and is re-derived from there on every
// capture, so a write here would just be undone.
//
// Asset rows in the Net Worth grid have always been typeable and debt rows
// never were, which meant a wrong card balance in a past month was the one
// figure on the page with no way to correct it — the number sat there, wrong,
// in the totals and the chart.
export async function setDebtSnapshot(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!subcategoryId || !MONTH_RE.test(month)) return;
  if (month >= currentMonthFirst()) return;

  // Balances are held positive here (the grid subtracts them), so a typed
  // "-500" means the same thing as "500" rather than a negative liability.
  const balanceCents = Math.abs(displayToCents(String(formData.get("balance") ?? "0")));

  // Only a debt this household actually has — the subcategory id arrives from
  // a form field, so it is checked rather than trusted.
  const debt = unwrap(
    await supabase
      .from("debts")
      .select("subcategory_id")
      .eq("household_id", householdId)
      .eq("subcategory_id", subcategoryId)
      .maybeSingle(),
    "debts",
  );
  if (!debt) return;

  await supabase.from("debt_snapshots").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      balance_cents: balanceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidate();
}

// Section-level totals for a month that predates per-account tracking. Used only
// as a fallback for months with no account_snapshots (see networth/page.tsx).
export async function setNetworthHistory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!MONTH_RE.test(month)) return { error: "Pick a valid month." };
  if (month > currentMonthFirst()) return { error: "Historical months only — no future months." };

  const row = {
    household_id: householdId,
    month,
    savings_cents: displayToCents(String(formData.get("savings") ?? "0")),
    bank_cents: displayToCents(String(formData.get("bank") ?? "0")),
    stocks_cents: displayToCents(String(formData.get("stocks") ?? "0")),
    debt_cents: displayToCents(String(formData.get("debt") ?? "0")),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("networth_history")
    .upsert(row, { onConflict: "household_id,month" });
  if (error) return { error: "Couldn't save that — please try again." };

  revalidatePath("/networth");
  return { error: null };
}

// Saves a single year-end (December) net worth total to networth_history.
//
// For a year that has no row yet, the whole amount goes in bank_cents so that
// net = total; there is no breakdown to honour.
//
// For a year that ALREADY has one, the breakdown is kept and only the cash
// line absorbs the difference. This used to overwrite savings, stocks and debt
// with zeros, so correcting a typo in 2023's total silently erased the stocks
// and debt split behind it — and the Year by Year table then reported $0 of
// stocks for a year that plainly had some, with no undo.
export async function upsertNetworthYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const year = Number(formData.get("year"));
  const nowYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1990 || year >= nowYear) {
    return { error: "Enter a valid past year." };
  }
  const totalCents = displayToCents(String(formData.get("total") ?? "0"));
  const month = `${year}-12-01`;

  // A December the per-account snapshots already cover ignores anything
  // written here — snapshots win when a month has them (networth/page.tsx).
  // Saving would have looked like it worked and changed nothing on screen,
  // which is exactly what happens to every year from now on as the snapshot
  // record grows past its first December. Say so instead.
  const { count: snapshotCount, error: snapshotCountError } = await supabase
    .from("account_snapshots")
    .select("account_id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("month", month);
  if (snapshotCountError) {
    return { error: `Couldn't check ${year} — ${snapshotCountError.message}` };
  }
  if ((snapshotCount ?? 0) > 0) {
    return {
      error: `${year} is already tracked account by account — edit it in Monthly Actual Balances instead.`,
    };
  }

  const existing = unwrap(
    await supabase
      .from("networth_history")
      .select("savings_cents, stocks_cents, debt_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .maybeSingle(),
    "networth_history",
  );

  const savings = existing?.savings_cents ?? 0;
  const stocks = existing?.stocks_cents ?? 0;
  const debt = existing?.debt_cents ?? 0;
  // net = savings + bank + stocks − debt, and net is what was typed.
  const bank = totalCents - savings - stocks + debt;

  const { error } = await supabase
    .from("networth_history")
    .upsert(
      {
        household_id: householdId,
        month,
        bank_cents: bank,
        savings_cents: savings,
        stocks_cents: stocks,
        debt_cents: debt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,month" },
    );
  if (error) return { error: "Couldn't save — try again." };

  revalidatePath("/networth");
  return { error: null };
}

// ---- The Financial Independence assumptions. Only the things the app can't
// measure live here; portfolio, contributions and spending come from the
// accounts and transactions already recorded.
export async function saveRetirementPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const num = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const money = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw ? Math.max(0, displayToCents(raw)) : null;
  };
  const year = (n: number | null) => n == null || (n > 1900 && n < 2200);

  const birthYear = num("birthYear");
  const targetYear = num("targetRetireYear");
  const serviceStart = num("serviceStartYear");
  const month = (key: string): number | null => {
    const n = num(key);
    return n != null && Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
  };
  const targetMonth = month("targetRetireMonth");
  const serviceStartMonth = month("serviceStartMonth");
  const realReturn = num("realReturnPct");
  const withdrawal = num("withdrawalRatePct");
  const inflation = num("inflationPct");
  const sbpPct = num("sbpPct");
  const taxPct = num("retirementTaxPct");
  const longevity = num("longevityAge");
  const healthStartAge = num("healthcareStartAge");
  // Each row: a plan kind and its yearly premium as typed.
  let healthPlans: HealthPlan[] = [];
  try {
    const raw = JSON.parse(String(formData.get("healthPlans") ?? "[]")) as { kind: string; amount: string }[];
    healthPlans = parseHealthPlans(
      raw.map((r) => ({ kind: r.kind, annualCents: r.amount?.trim() ? Math.max(0, displayToCents(r.amount)) : 0 })),
    );
  } catch {
    return { error: "Could not read the health plans." };
  }
  const healthGrowth = num("healthcareGrowthPct");
  // The two drift rates the projection grid fills forward with.
  const personalInflation = num("personalInflationPct");
  const incomeGrowth = num("incomeGrowthPct");

  if (!year(birthYear)) return { error: "Enter a four-digit birth year." };
  if (!year(targetYear)) return { error: "Enter a four-digit military retirement year." };
  if (!year(serviceStart)) return { error: "Enter a four-digit year for when service started." };
  if (
    serviceStart != null &&
    targetYear != null &&
    serviceStart * 12 + (serviceStartMonth ?? 1) > targetYear * 12 + (targetMonth ?? 1)
  ) {
    return { error: "Service has to start before the military retirement year." };
  }
  if (realReturn != null && (realReturn < -20 || realReturn > 20)) {
    return { error: "A real return outside -20%…20% isn't a plan, it's a bet." };
  }
  if (withdrawal != null && (withdrawal <= 0 || withdrawal > 20)) {
    return { error: "Withdrawal rate has to be between 0% and 20%." };
  }
  if (inflation != null && (inflation < 0 || inflation > 20)) {
    return { error: "Inflation has to be between 0% and 20%." };
  }
  if (sbpPct != null && (sbpPct < 0 || sbpPct > 20)) {
    return { error: "SBP rate has to be between 0% and 20%." };
  }
  if (taxPct != null && (taxPct < 0 || taxPct > 60)) {
    return { error: "Tax rate has to be between 0% and 60%." };
  }
  if (longevity != null && (longevity < 50 || longevity > 120)) {
    return { error: "Plan until age has to be between 50 and 120." };
  }
  if (personalInflation != null && (personalInflation < -20 || personalInflation > 20)) {
    return { error: "Spending growth has to be between -20% and 20%." };
  }
  if (incomeGrowth != null && (incomeGrowth < -20 || incomeGrowth > 20)) {
    return { error: "Income growth has to be between -20% and 20%." };
  }
  if (healthStartAge != null && (healthStartAge < 18 || healthStartAge > 120)) {
    return { error: "Healthcare start age has to be between 18 and 120." };
  }
  if (healthGrowth != null && (healthGrowth < 0 || healthGrowth > 20)) {
    return { error: "Healthcare growth has to be between 0% and 20%." };
  }

  // The income lines ride along as JSON so the whole popup saves at once.
  type LineIn = {
    id?: string | null;
    name?: string;
    kind?: string;
    monthly?: string;
    startYear?: string;
    endYear?: string;
    taxable?: boolean;
  };
  let linesIn: LineIn[] = [];
  try {
    linesIn = JSON.parse(String(formData.get("incomeLines") ?? "[]"));
    if (!Array.isArray(linesIn)) linesIn = [];
  } catch {
    return { error: "Couldn't read the income lines." };
  }
  const lineYear = (raw: string | undefined): number | null | "bad" => {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n > 1900 && n < 2200 ? n : "bad";
  };
  const lines: Array<{
    id: string | null;
    name: string;
    kind: IncomeLineKind;
    monthly_cents: number;
    start_year: number | null;
    end_year: number | null;
    taxable: boolean;
    sort_order: number;
  }> = [];
  for (const [i, l] of linesIn.entries()) {
    const name = String(l.name ?? "").trim();
    const kind = String(l.kind ?? "") as IncomeLineKind;
    const label = name || `Income line ${i + 1}`;
    if (!name) return { error: `${label}: give it a name.` };
    if (!LINE_KINDS.includes(kind)) return { error: `${label}: pick a type.` };
    if (!String(l.monthly ?? "").trim()) return { error: `${label}: enter the monthly amount.` };
    const start = lineYear(l.startYear);
    const end = lineYear(l.endYear);
    if (start === "bad") return { error: `${label}: first year has to be a four-digit year.` };
    if (end === "bad") return { error: `${label}: last year has to be a four-digit year.` };
    if (start != null && end != null && end < start) {
      return { error: `${label}: last year can't be before the first year.` };
    }
    lines.push({
      id: l.id || null,
      name,
      kind,
      monthly_cents: Math.max(0, displayToCents(String(l.monthly))),
      start_year: start,
      end_year: end,
      // VA disability is never taxed, whatever the box says.
      taxable: kind === "va" ? false : !!l.taxable,
      sort_order: i,
    });
  }

  // Rentals ride along as JSON too.
  type RentalIn = {
    id?: string | null;
    name?: string;
    propertyAccountId?: string | null;
    loanAccountId?: string | null;
    purchaseYear?: string;
    value?: string;
    downPaymentPct?: string;
    closingCostPct?: string;
    loanBalance?: string;
    loanRatePct?: string;
    loanYears?: string;
    rent?: string;
    costs?: string;
    appreciationPct?: string;
  };
  let rentalsIn: RentalIn[] = [];
  try {
    rentalsIn = JSON.parse(String(formData.get("rentals") ?? "[]"));
    if (!Array.isArray(rentalsIn)) rentalsIn = [];
  } catch {
    return { error: "Couldn't read the rental properties." };
  }
  const thisYearNow = new Date().getFullYear();
  const pctIn = (raw: string | undefined, fallback: number, min: number, max: number): number | "bad" => {
    const t = String(raw ?? "").trim();
    if (!t) return fallback;
    const n = Number(t);
    return Number.isFinite(n) && n >= min && n <= max ? n : "bad";
  };
  const rentals: Array<Record<string, unknown> & { id: string | null; name: string }> = [];
  for (const [i, r] of rentalsIn.entries()) {
    const name = String(r.name ?? "").trim();
    const label = name || `Rental ${i + 1}`;
    if (!name) return { error: `${label}: give it a name.` };
    const owned = !!r.propertyAccountId;
    const purchaseYear = lineYear(r.purchaseYear);
    if (purchaseYear === "bad") return { error: `${label}: purchase year has to be a four-digit year.` };
    if (!owned && purchaseYear == null) {
      return { error: `${label}: pick its Property account, or enter the year you plan to buy it.` };
    }
    if (!owned && purchaseYear != null && purchaseYear <= thisYearNow) {
      return { error: `${label}: a planned purchase has to be after ${thisYearNow}. Already bought? Add it on Accounts and pick it here.` };
    }
    const down = pctIn(r.downPaymentPct, 25, 0, 100);
    const closing = pctIn(r.closingCostPct, 3, 0, 20);
    const rate = pctIn(r.loanRatePct, 7, 0, 30);
    const appreciation = pctIn(r.appreciationPct, 0, -20, 20);
    const years = pctIn(r.loanYears, 30, 0, 50);
    if (down === "bad") return { error: `${label}: down payment has to be 0–100%.` };
    if (closing === "bad") return { error: `${label}: closing costs have to be 0–20%.` };
    if (rate === "bad") return { error: `${label}: loan rate has to be 0–30%.` };
    if (appreciation === "bad") return { error: `${label}: value growth has to be between -20% and 20%.` };
    if (years === "bad" || !Number.isInteger(years)) return { error: `${label}: loan years has to be a whole number 0–50.` };
    const cents = (raw: string | undefined) => (String(raw ?? "").trim() ? Math.max(0, displayToCents(String(raw))) : 0);
    if (!owned && cents(r.value) <= 0) return { error: `${label}: enter the price.` };
    rentals.push({
      id: r.id || null,
      name,
      property_account_id: r.propertyAccountId || null,
      // The loan now comes from the mortgage linked to the property on Accounts.
      loan_account_id: null,
      purchase_year: owned ? null : purchaseYear,
      value_cents: cents(r.value),
      down_payment_pct: down,
      closing_cost_pct: closing,
      loan_balance_cents: owned ? cents(r.loanBalance) : null,
      loan_rate_pct: rate,
      loan_years: years,
      monthly_rent_cents: cents(r.rent),
      monthly_costs_cents: cents(r.costs),
      appreciation_pct: appreciation,
      sort_order: i,
    });
  }

  const { error } = await supabase.from("retirement_plan").upsert(
    {
      household_id: householdId,
      birth_year: birthYear,
      target_retire_year: targetYear,
      target_retire_month: targetMonth,
      service_start_year: serviceStart,
      service_start_month: serviceStartMonth,
      high3_monthly_cents: money("high3"),
      real_return_pct: realReturn ?? 5,
      withdrawal_rate_pct: withdrawal ?? 4,
      inflation_pct: inflation ?? 2.5,
      sbp_enabled: formData.get("sbpEnabled") === "on",
      sbp_pct: sbpPct ?? 6.5,
      retirement_tax_pct: taxPct ?? 12,
      longevity_age: longevity ?? 90,
      health_plans: healthPlans,
      healthcare_annual_cents: money("healthcareAnnual"),
      dental_vision_annual_cents: money("dentalVisionAnnual"),
      healthcare_start_age: healthStartAge ?? 65,
      healthcare_growth_pct: healthGrowth ?? 1.5,
      personal_inflation_pct: personalInflation ?? 0,
      income_growth_pct: incomeGrowth ?? 0,
      // Replaced by the Net Worth Plan table (spending, saving) and the income
      // lines (guaranteed income). Cleared so an old figure can't quietly win.
      annual_spend_cents: null,
      annual_contribution_cents: null,
      guaranteed_income_cents: null,
      guaranteed_income_start_year: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  );
  if (error) {
    console.error("[saveRetirementPlan]", error);
    return { error: `Couldn't save the plan — ${error.message}` };
  }

  // Lines: remove the ones taken out, then write the rest.
  const { data: existing, error: existingError } = await supabase
    .from("retirement_income_lines")
    .select("id")
    .eq("household_id", householdId);
  if (existingError) return { error: `Couldn't read the income lines — ${existingError.message}` };
  const keep = new Set(lines.map((l) => l.id).filter(Boolean));
  const removed = (existing ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  if (removed.length > 0) {
    const { error: delError } = await supabase
      .from("retirement_income_lines")
      .delete()
      .eq("household_id", householdId)
      .in("id", removed);
    if (delError) return { error: `Couldn't remove an income line — ${delError.message}` };
  }
  const stamp = new Date().toISOString();
  const toUpdate = lines.filter((l) => l.id);
  const toInsert = lines.filter((l) => !l.id);
  for (const { id, ...row } of toUpdate) {
    const { error: upError } = await supabase
      .from("retirement_income_lines")
      .update({ ...row, updated_at: stamp })
      .eq("household_id", householdId)
      .eq("id", id!);
    if (upError) return { error: `Couldn't save ${row.name} — ${upError.message}` };
  }
  if (toInsert.length > 0) {
    const { error: insError } = await supabase
      .from("retirement_income_lines")
      .insert(
        toInsert.map((l) => ({
          household_id: householdId,
          name: l.name,
          kind: l.kind,
          monthly_cents: l.monthly_cents,
          start_year: l.start_year,
          end_year: l.end_year,
          taxable: l.taxable,
          sort_order: l.sort_order,
        })),
      );
    if (insError) return { error: `Couldn't add an income line — ${insError.message}` };
  }

  // A linked account has to be this household's Property / loan account.
  const linkedIds = rentals.flatMap((r) => [r.property_account_id, r.loan_account_id]).filter(Boolean) as string[];
  if (linkedIds.length > 0) {
    const { data: owns, error: ownErr } = await supabase
      .from("accounts")
      .select("id")
      .eq("household_id", householdId)
      .in("id", linkedIds);
    if (ownErr) return { error: `Couldn't check the linked accounts — ${ownErr.message}` };
    if ((owns ?? []).length !== new Set(linkedIds).size) return { error: "A rental is linked to an account that isn't yours." };
  }

  // Rentals: same sync as the income lines.
  const { data: existingRentals, error: rentalReadError } = await supabase
    .from("rental_properties")
    .select("id")
    .eq("household_id", householdId);
  if (rentalReadError) return { error: `Couldn't read the rentals — ${rentalReadError.message}` };
  const keepRentals = new Set(rentals.map((r) => r.id).filter(Boolean));
  const removedRentals = (existingRentals ?? []).map((r) => r.id).filter((id) => !keepRentals.has(id));
  if (removedRentals.length > 0) {
    const { error: rDel } = await supabase
      .from("rental_properties")
      .delete()
      .eq("household_id", householdId)
      .in("id", removedRentals);
    if (rDel) return { error: `Couldn't remove a rental — ${rDel.message}` };
  }
  for (const { id, ...row } of rentals) {
    const { error: rErr } = id
      ? await supabase
          .from("rental_properties")
          .update({ ...row, updated_at: stamp })
          .eq("household_id", householdId)
          .eq("id", id)
      : await supabase.from("rental_properties").insert({ ...row, household_id: householdId });
    if (rErr) return { error: `Couldn't save ${row.name} — ${rErr.message}` };
  }

  try {
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Saved, but couldn't update the plan table." };
  }
  revalidatePath("/networth");
  return { error: null };
}

const LINE_KINDS: IncomeLineKind[] = ["va", "social_security", "job", "spouse", "other"];

// ---- Recompute the plan table from the retirement inputs.
//
// income_cents is each year's TOTAL take-home: the pay typed for the year
// (work_income_cents, only before the military retirement year) plus every
// income line paying that year, after SBP and tax. Future gains are the real
// return on the year's opening balance, so a balance that is being spent down
// earns less — and nothing once it is gone. The table is extended to the
// plan-until age, carrying the last year's spending forward.
//
// Years before this one are history and are never touched; this year keeps
// its own gains (the register is measuring them).
async function recomputeRetirementIncome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
) {
  const thisYear = new Date().getFullYear();
  const [planRes, linesRes, rowsRes, rentalsRes, acctRes, loanRes] = await Promise.all([
    supabase.from("retirement_plan").select("*").eq("household_id", householdId).maybeSingle(),
    supabase.from("retirement_income_lines").select("*").eq("household_id", householdId),
    supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, one_off_cents, eoy_cents, tax_pct")
      .eq("household_id", householdId)
      .order("year"),
    supabase.from("rental_properties").select("*").eq("household_id", householdId),
    supabase.from("accounts").select("id, current_balance_cents").eq("household_id", householdId),
    supabase
      .from("debts")
      .select("property_account_id, current_balance_cents")
      .eq("household_id", householdId)
      .not("property_account_id", "is", null)
      .is("paid_off_at", null),
  ]);
  if (loanRes.error) throw new Error(`Could not read the mortgages: ${loanRes.error.message}`);
  if (rentalsRes.error) throw new Error(`Could not read the rentals: ${rentalsRes.error.message}`);
  if (acctRes.error) throw new Error(`Could not read the accounts: ${acctRes.error.message}`);
  if (planRes.error) throw new Error(`Could not read the retirement plan: ${planRes.error.message}`);
  if (linesRes.error) throw new Error(`Could not read the income lines: ${linesRes.error.message}`);
  if (rowsRes.error) throw new Error(`Could not read the projection: ${rowsRes.error.message}`);

  const plan = planRes.data;
  const rows = (rowsRes.data ?? []).map((r) => ({ ...r, one_off_cents: r.one_off_cents ?? 0 }));
  if (!plan || rows.length === 0) return;

  const lines: IncomeLine[] = (linesRes.data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    monthlyCents: l.monthly_cents,
    startYear: l.start_year,
    endYear: l.end_year,
    taxable: l.taxable,
  }));
  const retireYear: number | null = plan.target_retire_year;
  const retireMonth: number | null = plan.target_retire_month ?? null;
  const pension = estimatePension(
    {
      retireYear,
      retireMonth,
      serviceStartYear: plan.service_start_year,
      serviceStartMonth: plan.service_start_month ?? null,
      high3MonthlyCents: plan.high3_monthly_cents,
      inflationPct: Number(plan.inflation_pct ?? 2.5),
      sbpEnabled: !!plan.sbp_enabled,
      sbpPct: Number(plan.sbp_pct ?? 6.5),
    },
    thisYear,
  );
  const defaultTax = Number(plan.retirement_tax_pct ?? 12);
  const inflationPct = Number(plan.inflation_pct ?? 2.5);
  const balances = new Map((acctRes.data ?? []).map((a) => [a.id as string, Number(a.current_balance_cents ?? 0)]));
  const loanByProperty = new Map<string, number>();
  for (const d of loanRes.data ?? []) {
    const id = d.property_account_id as string;
    loanByProperty.set(id, (loanByProperty.get(id) ?? 0) + Number(d.current_balance_cents ?? 0));
  }
  const rentals = ((rentalsRes.data ?? []) as RentalRow[]).map((r) => toRentalProperty(r, balances, loanByProperty));
  const health: HealthcarePlan = {
    birthYear: plan.birth_year,
    retireYear,
    retireMonth,
    planAnnualCents: parseHealthPlans(plan.health_plans).reduce((t, p) => t + p.annualCents, 0),
    tflAnnualCents: plan.healthcare_annual_cents,
    tflStartAge: Number(plan.healthcare_start_age ?? 65),
    dentalVisionAnnualCents: plan.dental_vision_annual_cents ?? null,
    growthPct: Number(plan.healthcare_growth_pct ?? 1.5),
  };
  const returnPct = Number(plan.real_return_pct ?? 5);

  // Run to the plan-until age, carrying the last year forward.
  const lastYear = plan.birth_year ? plan.birth_year + Number(plan.longevity_age ?? 90) : null;
  const last = rows[rows.length - 1];
  if (lastYear != null) {
    for (let y = last.year + 1; y <= lastYear; y++) {
      rows.push({
        ...last,
        year: y,
        age: plan.birth_year ? y - plan.birth_year : last.age == null ? null : last.age + (y - last.year),
        one_off_cents: 0,
      });
    }
  }

  const stamp = new Date().toISOString();
  const out: Array<Record<string, unknown>> = [];
  let carry: number | null = null;
  for (const row of rows) {
    if (row.year < thisYear) continue;
    const boy: number = carry ?? row.boy_cents;
    // The retirement year is split by month: a November retirement keeps ten
    // months of active-duty pay and gets two months of retired pay.
    const retiredShare = retiredShareOfYear(row.year, retireYear, retireMonth);
    const work = Math.round((row.work_income_cents ?? row.income_cents) * (1 - retiredShare));
    const taxPct = row.tax_pct == null ? defaultTax : Number(row.tax_pct);
    const yearIncome = incomeForYear(row.year, pension, retireYear, lines, taxPct);
    const pensionYearly = (yearIncome.parts.find((p) => p.kind === "pension")?.monthlyAfterTaxCents ?? 0) * 12;
    const lineIncome = yearIncome.afterTaxCents - Math.round(pensionYearly * (1 - retiredShare));
    // Rentals: net rent is income; equity is part of net worth but earns no
    // investment return — it grows by principal paid and appreciation, and a
    // purchase moves the down payment out of savings (closing costs are gone).
    const rent = rentalsForYear(rentals, row.year, thisYear, inflationPct, taxPct);
    const income = work + lineIncome + rent.cashAfterTaxCents;
    const baseSpend = row.base_spending_cents ?? row.spending_cents;
    // Spending is what was typed plus healthcare — nothing else. It used to
    // drop by each debt's payment once the Debts page projected it paid off,
    // which on two small 0% cards meant a −$33…−$900 line on every row from
    // 2028; Victor had it removed (2026-09-28).
    const spending = Math.max(0, baseSpend + healthcareForYear(row.year, health, thisYear));
    const investable = boy - rent.equityStartCents;
    const propertyEffect = rent.equityEndCents - rent.equityStartCents - rent.purchaseCashCents;
    const growth =
      row.year === thisYear
        ? row.growth_cents
        : (investable > 0 ? Math.round((investable * returnPct) / 100) : 0) + propertyEffect;
    const eoy = boy + income - spending + growth + row.one_off_cents;
    out.push({
      household_id: householdId,
      year: row.year,
      age: row.age,
      boy_cents: boy,
      work_income_cents: row.work_income_cents ?? row.income_cents,
      income_cents: income,
      base_spending_cents: baseSpend,
      spending_cents: spending,
      debt_freed_cents: 0,
      growth_cents: growth,
      one_off_cents: row.one_off_cents,
      eoy_cents: eoy,
      tax_pct: row.tax_pct,
      updated_at: stamp,
    });
    carry = eoy;
  }
  if (out.length === 0) return;

  const { error } = await supabase
    .from("networth_projection")
    .upsert(out, { onConflict: "household_id,year" });
  if (error) throw new Error(`Could not update the projection: ${error.message}`);
}

// ---- The year-by-year net worth projection (Victor's sheet, now data).
//
// Editing one year has to move every year after it: the sheet's whole point is
// that this year's ending balance is next year's opening one. So a save writes
// the edited row and then walks the chain forward, recomputing
//   EOY = BOY + income - spending + growth
// and carrying each EOY into the next year's BOY. Years before the edit are
// left exactly as they are — history doesn't move because a future guess did.
type ProjectionRow = {
  year: number;
  age: number | null;
  boy_cents: number;
  income_cents: number;
  spending_cents: number;
  growth_cents: number;
  one_off_cents: number;
  eoy_cents: number;
};

async function rebuildProjectionChain(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  fromYear: number,
) {
  const { data: rows, error } = await supabase
    .from("networth_projection")
    .select("year, age, boy_cents, income_cents, spending_cents, growth_cents, one_off_cents, eoy_cents")
    .eq("household_id", householdId)
    .gte("year", fromYear)
    .order("year");
  if (error) throw new Error(`Could not read the projection: ${error.message}`);

  // Walk the chain in memory first, then write once. This used to UPDATE each
  // changed year on its own, which was fine while an edit moved two or three
  // rows — but a change now carries forward, so editing 2026 moves every year
  // to 2047 and that was twenty-one sequential round trips to the database.
  // One batched upsert instead of N serial writes.
  const stamp = new Date().toISOString();
  const changed: Array<Record<string, unknown>> = [];
  let carry: number | null = null;

  for (const row of (rows ?? []) as ProjectionRow[]) {
    const boy: number = carry ?? row.boy_cents;
    const eoy: number =
      boy + row.income_cents - row.spending_cents + row.growth_cents + (row.one_off_cents ?? 0);
    if (boy !== row.boy_cents || eoy !== row.eoy_cents) {
      // Every column is sent, not just the two that moved: on the insert half
      // of an upsert the omitted ones would fall back to their defaults and
      // quietly zero a year's income.
      changed.push({
        household_id: householdId,
        year: row.year,
        age: row.age,
        boy_cents: boy,
        income_cents: row.income_cents,
        spending_cents: row.spending_cents,
        growth_cents: row.growth_cents,
        one_off_cents: row.one_off_cents ?? 0,
        eoy_cents: eoy,
        updated_at: stamp,
      });
    }
    carry = eoy;
  }

  if (changed.length === 0) return;

  const { error: upErr } = await supabase
    .from("networth_projection")
    .upsert(changed, { onConflict: "household_id,year" });
  if (upErr) throw new Error(`Could not update the projection: ${upErr.message}`);
}

// ---- Starting a projection from nothing.
//
// Until now a row could only be created by editing one that already existed,
// so a household with no projection had no way to get its first year — the
// section simply never appeared. This seeds twenty-five years from what the
// register already knows about the last twelve months, which is a far better
// first draft than an empty grid: every figure is the household's own, and
// every one of them is editable afterwards.
//
// Income and spending are held flat across all twenty-five years on purpose.
// The grid is in today's money and a change carries forward, so a flat start
// is the honest one — the user bends it where their life actually bends.
const SEED_YEARS = 25;

export async function seedProjection(seed: {
  boyCents: number;
  incomeCents: number;
  spendingCents: number;
}) {
  const { supabase, householdId } = await requireHousehold();

  // Never over an existing plan: this only ever creates a first draft.
  const { count, error: countError } = await supabase
    .from("networth_projection")
    .select("year", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (countError) {
    console.error("[seedProjection:count]", countError);
    return { error: `Couldn't read the projection — ${countError.message}` };
  }
  if ((count ?? 0) > 0) {
    return { error: "You already have a projection — edit a year instead." };
  }

  const { data: plan } = await supabase
    .from("retirement_plan")
    .select("birth_year")
    .eq("household_id", householdId)
    .maybeSingle();
  const birthYear = plan?.birth_year ?? null;

  const income = Math.max(0, Math.round(seed.incomeCents));
  const spending = Math.max(0, Math.round(seed.spendingCents));
  const thisYear = new Date().getFullYear();
  const stamp = new Date().toISOString();

  // Gains start at zero rather than a guess: the return the household will
  // actually get is the one thing the register cannot measure, and a made-up
  // number here would quietly become "the plan".
  const rows: Array<Record<string, unknown>> = [];
  let carry = Math.round(seed.boyCents);
  for (let i = 0; i < SEED_YEARS; i++) {
    const year = thisYear + i;
    const eoy = carry + income - spending;
    rows.push({
      household_id: householdId,
      year,
      age: birthYear ? year - birthYear : null,
      boy_cents: carry,
      income_cents: income,
      work_income_cents: income,
      spending_cents: spending,
      base_spending_cents: spending,
      growth_cents: 0,
      eoy_cents: eoy,
      updated_at: stamp,
    });
    carry = eoy;
  }

  const { error } = await supabase.from("networth_projection").insert(rows);
  if (error) {
    console.error("[seedProjection]", error);
    return { error: `Couldn't start the projection — ${error.message}` };
  }

  revalidatePath("/networth");
  return { error: null, years: rows.length };
}

// ---- Extending a projection that already exists.
//
// A grid that stops at its last year is a grid that can only ever be corrected,
// never lengthened — and nothing else in the app added a year, so a projection
// was permanently whatever length it was created at. This appends more years
// on the end, carrying the last planned year's figures forward, which is the
// same "this is the new normal until you say otherwise" rule a mid-grid edit
// already follows.
const APPEND_YEARS = 5;

export async function appendProjectionYears(count: number = APPEND_YEARS) {
  const { supabase, householdId } = await requireHousehold();

  const years = Math.min(25, Math.max(1, Math.trunc(count) || APPEND_YEARS));

  const last = unwrap(
    await supabase
      .from("networth_projection")
      .select("year, age, income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, eoy_cents, tax_pct")
      .eq("household_id", householdId)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "networth_projection",
  );
  if (!last) {
    return { error: "There's no projection to extend yet." };
  }
  if (last.year + years > 2200) {
    return { error: "That runs past the end of the calendar this app keeps." };
  }

  const stamp = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  let carry = last.eoy_cents;

  for (let i = 1; i <= years; i++) {
    const year = last.year + i;
    // No one-off: buying a house in the last planned year is not a reason to
    // buy one every year after it.
    const eoy = carry + last.income_cents - last.spending_cents + last.growth_cents;
    rows.push({
      household_id: householdId,
      year,
      // Ages keep counting from the last year that had one.
      age: last.age == null ? null : last.age + i,
      boy_cents: carry,
      income_cents: last.income_cents,
      work_income_cents: last.work_income_cents ?? last.income_cents,
      spending_cents: last.spending_cents,
      base_spending_cents: last.base_spending_cents ?? last.spending_cents,
      growth_cents: last.growth_cents,
      tax_pct: last.tax_pct,
      eoy_cents: eoy,
      updated_at: stamp,
    });
    carry = eoy;
  }

  const { error } = await supabase.from("networth_projection").insert(rows);
  if (error) {
    console.error("[appendProjectionYears]", error);
    return { error: `Couldn't add those years — ${error.message}` };
  }
  try {
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Added, but couldn't update the plan table." };
  }

  revalidatePath("/networth");
  return { error: null, added: rows.length, through: last.year + years };
}

export async function saveProjectionYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const year = Number(String(formData.get("year") ?? ""));
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return { error: "That year doesn't look right." };
  }
  const cents = (key: string) => Math.max(0, displayToCents(String(formData.get(key) ?? "0")));
  const ageRaw = String(formData.get("age") ?? "").trim();
  const age = ageRaw ? Number(ageRaw) : null;

  // The typed income is the year's take-home PAY; retirement income lines are
  // added on top by the recompute below.
  const income = cents("income");
  const spending = cents("spending");
  const growth = cents("growth");
  const taxRaw = String(formData.get("taxPct") ?? "").trim();
  const taxPct = taxRaw === "" ? null : Number(taxRaw);
  if (taxPct != null && (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 60)) {
    return { error: "Tax rate has to be between 0% and 60%." };
  }
  // Signed, unlike the others: a windfall is positive, a house is negative.
  const oneOff = displayToCents(String(formData.get("oneOff") ?? "0"));

  // What the year held before this save, so the carry-forward below can tell
  // which figures were actually typed and which were merely resubmitted.
  const prev = unwrap(
    await supabase
      .from("networth_projection")
      .select("income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, tax_pct")
      .eq("household_id", householdId)
      .eq("year", year)
      .maybeSingle(),
    "networth_projection",
  );

  const { error } = await supabase.from("networth_projection").upsert(
    {
      household_id: householdId,
      year,
      age: age != null && Number.isFinite(age) ? age : null,
      // BOY is only editable on the very first year; every later year inherits
      // it from the year before when the chain is rebuilt.
      boy_cents: cents("boy"),
      income_cents: income,
      work_income_cents: income,
      spending_cents: spending,
      base_spending_cents: spending,
      growth_cents: growth,
      one_off_cents: oneOff,
      tax_pct: taxPct,
      eoy_cents: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,year" },
  );
  if (error) {
    console.error("[saveProjectionYear]", error);
    return { error: `Couldn't save ${year} — ${error.message}` };
  }

  // ---- Carry the change forward.
  //
  // Editing one year is almost never a statement about that year alone: a
  // raise, or the kids moving out, is the new normal until something else
  // changes. So a figure you actually changed is written into every later year
  // as well, and the twenty rows behind it stop being twenty clicks.
  //
  // Only the figures that CHANGED travel. Retyping income while editing
  // spending must not overwrite twenty years of income, so each column is
  // compared against what the row held a moment ago and left alone if equal.
  //
  // And figures taken from ACTUALS never travel at all. What a year turned out
  // to cost is a fact about that year, not a forecast for the next twenty —
  // pressing "Use 2026 actuals" in September would otherwise write nine months
  // of income ($97,130) into every row through 2047 in one press, with the
  // dialog only warning that later years are "recomputed". The modal sends
  // carryForward=0 whenever the boxes were filled from measured figures.
  // The one-off is never in here, whatever else is: a house bought in 2027 is
  // not a house bought every year to 2047.
  const carryForward = String(formData.get("carryForward") ?? "1") !== "0";
  const carry: Record<string, number | null> = {};
  if (carryForward) {
    if (!prev || (prev.work_income_cents ?? prev.income_cents) !== income) {
      carry.work_income_cents = income;
      carry.income_cents = income;
    }
    if (!prev || (prev.base_spending_cents ?? prev.spending_cents) !== spending) {
      carry.base_spending_cents = spending;
      carry.spending_cents = spending;
    }
    if (!prev || prev.growth_cents !== growth) carry.growth_cents = growth;
    // A new tax rate is the new normal too (a rental, a business) until
    // another year says otherwise.
    if (!prev || (prev.tax_pct == null ? null : Number(prev.tax_pct)) !== taxPct) carry.tax_pct = taxPct;
  }

  if (Object.keys(carry).length > 0) {
    const { error: carryError } = await supabase
      .from("networth_projection")
      .update({ ...carry, updated_at: new Date().toISOString() })
      .eq("household_id", householdId)
      .gt("year", year);
    if (carryError) {
      console.error("[saveProjectionYear:carry]", carryError);
      return { error: `Saved ${year}, but couldn't carry it forward — ${carryError.message}` };
    }
  }

  try {
    await rebuildProjectionChain(supabase, householdId, year);
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not rebuild the projection." };
  }

  revalidatePath("/networth");
  return { error: null };
}

// Regenerates every year after `fromYear` from the assumptions — income and
// spending drift at their own rates, gains are the return applied to the
// opening balance. This is the sheet's model doing the typing instead of
// Victor doing it, and it deliberately overwrites hand-entered future years,
// so the UI asks first.
//
// ---- Everything here is in TODAY'S MONEY, and that is the whole point.
//
// The grid is read as today's money everywhere else (the FI section feeds its
// rows straight into a real-return projection without deflating them), so the
// rates applied here have to be real ones too:
//
//   * gains use `real_return_pct` — the SAME knob the FI chart compounds with.
//     It used to read a separate `projection_return_pct`, which is how the two
//     halves of this page ended up quoting $926,835 and $1,516,822 for the
//     same year 2041. One return, one answer.
//   * income and spending drift at their rates ABOVE inflation, which is why
//     both default to 0 — in today's money, a salary that merely keeps pace
//     with inflation is a flat line.
export async function fillProjectionForward(fromYear: number) {
  const { supabase, householdId } = await requireHousehold();

  const [{ data: plan }, { data: rows, error: rowsError }] = await Promise.all([
    supabase
      .from("retirement_plan")
      .select("real_return_pct, personal_inflation_pct, income_growth_pct")
      .eq("household_id", householdId)
      .maybeSingle(),
    supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, one_off_cents, eoy_cents")
      .eq("household_id", householdId)
      .order("year"),
  ]);
  if (rowsError) return { error: `Could not read the projection — ${rowsError.message}` };

  const all = rows ?? [];
  const base = all.find((r) => r.year === fromYear);
  if (!base) return { error: `${fromYear} isn't in the projection yet.` };

  const returnPct = Number(plan?.real_return_pct ?? 5);
  const inflationPct = Number(plan?.personal_inflation_pct ?? 0);
  const incomePct = Number(plan?.income_growth_pct ?? 0);

  // The year you fill forward FROM is the anchor: its own figures are left
  // exactly as typed, and the chain starts from the balance they actually
  // land on. Recomputing its growth here (as this used to) produced a
  // closing balance that disagreed with the row's own stored EOY, so the
  // grid showed year N ending on one number and year N+1 opening on another.
  const baseEoy =
    base.boy_cents + base.income_cents - base.spending_cents + base.growth_cents +
    (base.one_off_cents ?? 0);

  let carry = baseEoy;

  const updates: Array<Record<string, unknown>> = [];

  // Only if the anchor's stored EOY drifted from its own columns.
  if (base.eoy_cents !== baseEoy) {
    updates.push({
      household_id: householdId,
      year: base.year,
      age: base.age,
      boy_cents: base.boy_cents,
      income_cents: base.income_cents,
      spending_cents: base.spending_cents,
      growth_cents: base.growth_cents,
      one_off_cents: base.one_off_cents ?? 0,
      eoy_cents: baseEoy,
      updated_at: new Date().toISOString(),
    });
  }

  // ---- Each year keeps its OWN shape; the drift rates scale it.
  //
  // This used to take the anchor year's income and spending and walk them
  // forward over every later row, which meant a 0% drift rate — the default,
  // and the honest one in today's money — did not mean "leave them alone", it
  // meant "copy 2026 over the next twenty-one years". Victor's plan steps
  // down deliberately ($90k while the kids are home, $65k, then $45k once
  // they've gone); one press flattened all of it to a single flat line and
  // moved his FI date two years.
  //
  // So a row's own figures are the plan, and the rate is a multiplier on top:
  // at 0% every typed year survives untouched, and at 2% the whole shape —
  // steps included — rises 2% a year. Only the gains are always recomputed,
  // because that is the column this exists to fix.
  for (const row of all.filter((r) => r.year > fromYear)) {
    const n = row.year - fromYear;
    // Drift scales the typed pay; retirement income lines are re-added by the
    // recompute below, so they are never drifted twice.
    const income = Math.round((row.work_income_cents ?? row.income_cents) * Math.pow(1 + incomePct / 100, n));
    // Scales the typed spending; healthcare is re-added by the recompute.
    const spending = Math.round((row.base_spending_cents ?? row.spending_cents) * Math.pow(1 + inflationPct / 100, n));
    const growth = Math.round((carry * returnPct) / 100);
    // A one-off is kept exactly as typed and never scaled: the drift rates say
    // how a salary or a grocery bill changes over time, and a house purchase
    // is neither.
    const oneOff = row.one_off_cents ?? 0;
    const eoy = carry + income - spending + growth + oneOff;
    updates.push({
      household_id: householdId,
      year: row.year,
      age: row.age,
      boy_cents: carry,
      income_cents: income,
      work_income_cents: income,
      spending_cents: spending,
      base_spending_cents: spending,
      growth_cents: growth,
      one_off_cents: oneOff,
      eoy_cents: eoy,
      updated_at: new Date().toISOString(),
    });
    carry = eoy;
  }

  if (updates.length > 0) {
    const { error } = await supabase
      .from("networth_projection")
      .upsert(updates, { onConflict: "household_id,year" });
    if (error) {
      console.error("[fillProjectionForward]", error);
      return { error: `Couldn't rebuild the projection — ${error.message}` };
    }
  }
  try {
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Rebuilt, but couldn't add retirement income." };
  }

  revalidatePath("/networth");
  return { error: null, updated: updates.length };
}

/**
 * Closes out finished years by replacing their estimates with what actually
 * happened, then re-chaining everything after them.
 *
 * The guard matters more than the mechanism: a year is only adopted when the
 * register covers at least six of its months AND its year-end gains have been
 * entered. Adopting a partial year would build a Frankenstein row — real gains
 * against a guessed income — and every later year would inherit it. A year
 * that can't be fully measured keeps Victor's estimate untouched.
 *
 * Idempotent: once adopted, the stored values already equal the measured ones
 * and nothing is written. Safe to call on every page load, which is how it
 * stays automatic.
 */
export async function adoptClosedProjectionYears(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  thisYear: number,
  measuredByYear: Map<
    number,
    { income: number | null; spending: number | null; gains: number | null; months: number }
  >,
): Promise<number[]> {
  const { data: rows, error } = await supabase
    .from("networth_projection")
    .select("year, income_cents, spending_cents, growth_cents")
    .eq("household_id", householdId)
    .lt("year", thisYear)
    .order("year");
  if (error || !rows) return [];

  const adopted: number[] = [];
  let earliest: number | null = null;

  for (const row of rows) {
    const m = measuredByYear.get(row.year);
    if (!m || m.months < 6 || m.income == null || m.spending == null || !m.gains) continue;
    if (
      row.income_cents === m.income &&
      row.spending_cents === m.spending &&
      row.growth_cents === m.gains
    ) {
      continue;
    }

    const { error: upErr } = await supabase
      .from("networth_projection")
      .update({
        income_cents: m.income,
        spending_cents: m.spending,
        growth_cents: m.gains,
        updated_at: new Date().toISOString(),
      })
      .eq("household_id", householdId)
      .eq("year", row.year);
    if (upErr) {
      console.error("[adoptClosedProjectionYears]", upErr);
      continue;
    }
    adopted.push(row.year);
    earliest = earliest == null ? row.year : Math.min(earliest, row.year);
  }

  if (earliest != null) {
    await rebuildProjectionChain(supabase, householdId, earliest);
  }
  return adopted;
}

// The year in progress opens on what net worth ACTUALLY closed at last year,
// not on what the plan said it would. The plan chained plan-to-plan, so 2026
// opened on the 2025 plan's $316,635 while 2025 really closed at $308,096 —
// and every target after it sat $8,539 too high (Victor, 2026-09-28).
//
// Runs on page load, like adoptClosedProjectionYears, so a save that re-walks
// the chain from an earlier year can't leave it undone past the next refresh.
// Only the current year is anchored; earlier years keep the plan as it was.
export async function anchorYearToActualStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  year: number,
  actualStartCents: number | null,
): Promise<boolean> {
  if (actualStartCents == null) return false;
  const row = unwrap(
    await supabase
      .from("networth_projection")
      .select("boy_cents")
      .eq("household_id", householdId)
      .eq("year", year)
      .maybeSingle(),
    "networth_projection",
  );
  if (!row || row.boy_cents === actualStartCents) return false;
  const { error } = await supabase
    .from("networth_projection")
    .update({ boy_cents: actualStartCents, updated_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .eq("year", year);
  if (error) throw new Error(`Could not update the projection: ${error.message}`);
  await rebuildProjectionChain(supabase, householdId, year);
  return true;
}
