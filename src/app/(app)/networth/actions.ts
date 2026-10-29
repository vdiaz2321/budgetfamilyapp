"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { currentMonthFirst } from "@/lib/snapshots";
import { unwrap } from "@/lib/supabase-result";
import { inflationGrowth, parseInflationHistory, recordInflationChange } from "@/lib/inflation";
import { applySsRecord, parseSsEarnings, toSsRecord, type SsStatementFigures } from "@/lib/ssa";
import { applyFers } from "@/lib/fers";
import {
  estimatePension,
  healthcareForYear,
  high3FromBasePay,
  high3Window,
  incomeForYear,
  inflatedSpending,
  ageInYear,
  retiredShareOfYear,
  type HealthcarePlan,
  type CostDates,
  type DentalPlan,
  type HealthPlan,
  parseColaByYear,
  parseDentalPlans,
  parseHealthPlans,
  rentalsForYear,
  type ColaPlan,
  toRentalProperty,
  type IncomeLine,
  type IncomeLineKind,
  type RentalRow,
  planEndYear,
  SGLI_STEPS_CENTS,
} from "@/lib/retirement";
import {
  GROUP_KINDS,
  GROUP_LABEL,
  groupsYear,
  isGroupKind,
  resolveGroupSettings,
  scaleBalances,
  toStoredGroups,
  clampReturnPct,
  clampTaxPct,
  isEmptyTyped,
  clampWithdrawPct,
  parseTypedGroups,
  parseSpendRestart,
  parseTypedWithdraw,
  pctWithdrawCarrier,
  resolveOverrides,
  type GroupKind,
  type TypedGroups,
} from "@/lib/account-groups";
import { loadGroupInputs } from "@/lib/account-groups-load";
import type { GroupRow } from "@/lib/account-groups";
import { fiPlanFields, toIncomeLine } from "./fi-plan-rows";
import type { FiPlan } from "./fi-section";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function requireHousehold() {
  const supabase = await createClient();
  // Checked locally from the session token, like the pages do — getUser()
  // asked the auth server first and added ~300ms to every save.
  const user = await verifiedUser(supabase);
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
      error: `${year} is already tracked account by account — edit it in Net Worth Monthly Balances instead.`,
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
//
// Reads and checks Edit Future Projections' form into the rows Save writes —
// without writing them, so the live preview can run the same checks.
async function parsePlanForm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  formData: FormData,
) {
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
  const investReturn = num("investmentReturnPct");
  const withdrawStart = num("withdrawStartYear");
  const spouseRetire = num("spouseRetireYear");
  const spouseBirthYear = num("spouseBirthYear");
  const spouseClaimAge = num("spouseSsClaimAge");
  const withdrawal = num("withdrawalRatePct");
  const inflation = num("inflationPct");
  const cashReturn = num("cashReturnPct");
  const sbpPct = num("sbpPct");
  const longevity = num("longevityAge");
  const spouseLongevity = num("spouseLongevityAge");
  const healthStartAge = num("healthcareStartAge");
  // Each row: a plan kind, its yearly premium as typed, and its dates.
  // Health plans and dental & vision plans ride along as JSON: each row a
  // kind, its yearly premium as typed, and its start/end.
  type PlanIn = { kind: string; amount: string; per?: string; startYear?: string; startMonth?: string; endYear?: string; endMonth?: string };
  const readPlans = (key: string, label: string): { rows: unknown[] } | { error: string } => {
    let raw: PlanIn[];
    try {
      raw = JSON.parse(String(formData.get(key) ?? "[]"));
      if (!Array.isArray(raw)) raw = [];
    } catch {
      return { error: `Could not read the ${label.toLowerCase()} plans.` };
    }
    for (const r of raw) {
      for (const y of [r.startYear, r.endYear]) {
        if (String(y ?? "").trim() && !/^\d{4}$/.test(String(y).trim())) {
          return { error: `${label}: start and end years have to be four-digit years.` };
        }
      }
    }
    return {
      rows: raw.map((r) => ({
        kind: r.kind,
        // Typed per month or per year; stored yearly.
        annualCents: r.amount?.trim() ? Math.max(0, displayToCents(r.amount)) * (r.per === "mo" ? 12 : 1) : 0,
        per: r.per,
        startYear: r.startYear?.trim(),
        startMonth: r.startMonth,
        endYear: r.endYear?.trim(),
        endMonth: r.endMonth,
      })),
    };
  };
  const healthIn = readPlans("healthPlans", "Health plan");
  if ("error" in healthIn) return healthIn;
  const dentalIn = readPlans("dentalPlans", "Dental & vision");
  if ("error" in dentalIn) return dentalIn;
  const healthPlans: HealthPlan[] = parseHealthPlans(healthIn.rows);
  const dentalPlans: DentalPlan[] = parseDentalPlans(dentalIn.rows);
  // An end has to come after its start.
  const endsBeforeStart = (d: CostDates) =>
    d.startYear != null && d.endYear != null && d.endYear * 12 + (d.endMonth ?? 12) < d.startYear * 12 + (d.startMonth ?? 1);
  if (healthPlans.some(endsBeforeStart)) return { error: "Health plan: the end can't be before the start." };
  if (dentalPlans.some(endsBeforeStart)) return { error: "Dental & vision: the end can't be before the start." };
  const colaPct = num("colaPct");
  if (colaPct != null && (colaPct < 0 || colaPct > 15)) return { error: "COLA has to be between 0% and 15%." };
  // Actual COLAs ride along as JSON rows: a payment year and its %, one per
  // year from the plan's first COLA.
  let colaRows: { year?: string; pct?: string }[] = [];
  try {
    colaRows = JSON.parse(String(formData.get("colaByYear") ?? "[]"));
    if (!Array.isArray(colaRows)) colaRows = [];
  } catch {
    return { error: "Couldn't read the COLA years." };
  }
  const colaByYear: Record<string, number> = {};
  for (const r of colaRows) {
    const y = String(r.year ?? "").trim();
    const pct = String(r.pct ?? "").trim();
    // A blank box uses the future COLA.
    if (!pct) continue;
    if (!/^\d{4}$/.test(y)) return { error: "COLA: each year has to be a four-digit year." };
    const n = Number(pct);
    if (!Number.isFinite(n) || n < -5 || n > 20) return { error: `COLA ${y}: enter a % between -5 and 20.` };
    if (y in colaByYear) return { error: `COLA ${y} is in the list twice.` };
    colaByYear[y] = n;
  }

  if (!year(birthYear)) return { error: "Enter a four-digit birth year." };
  if (!year(spouseBirthYear)) return { error: "Enter a four-digit spouse birth year." };
  if (!year(targetYear)) return { error: "Enter a four-digit military retirement year." };
  if (!year(serviceStart)) return { error: "Enter a four-digit year for when service started." };
  if (
    serviceStart != null &&
    targetYear != null &&
    serviceStart * 12 + (serviceStartMonth ?? 1) > targetYear * 12 + (targetMonth ?? 1)
  ) {
    return { error: "Service has to start before the military retirement year." };
  }
  // High-3 from each year's monthly base pay (fields basePay_2031, …), only
  // the years inside the 36 months before retired pay starts.
  const basePayByYear: Record<string, number> = {};
  if (targetYear != null) {
    const window = high3Window(targetYear, targetMonth);
    for (const w of window) {
      const cents = money(`basePay_${w.year}`);
      if (cents) basePayByYear[String(w.year)] = cents;
    }
    const missing = window.filter((w) => !basePayByYear[String(w.year)]).map((w) => w.year);
    if (missing.length > 0 && missing.length < window.length) {
      return { error: `High-3: enter the base pay for ${missing.join(", ")}.` };
    }
  }
  const high3Cents = high3FromBasePay(targetYear, targetMonth, basePayByYear);
  if (investReturn != null && (investReturn < -20 || investReturn > 30)) {
    return { error: "A rate of return outside -20%…30% isn't a plan, it's a bet." };
  }
  if (!year(withdrawStart)) return { error: "Enter a four-digit year for when withdrawals start." };
  if (!year(spouseRetire)) return { error: "Enter a four-digit year for the spouse's retirement." };
  if (withdrawal != null && (withdrawal <= 0 || withdrawal > 20)) {
    return { error: "Withdrawal rate has to be between 0% and 20%." };
  }
  if (inflation != null && (inflation < 0 || inflation > 20)) {
    return { error: "Inflation has to be between 0% and 20%." };
  }
  if (cashReturn != null && (cashReturn < 0 || cashReturn > 20)) {
    return { error: "Cash rate has to be between 0% and 20%." };
  }
  if (sbpPct != null && (sbpPct < 0 || sbpPct > 20)) {
    return { error: "SBP rate has to be between 0% and 20%." };
  }
  if (longevity != null && (longevity < 50 || longevity > 120)) {
    return { error: "Plan until age has to be between 50 and 120." };
  }
  if (spouseLongevity != null && (spouseLongevity < 50 || spouseLongevity > 120)) {
    return { error: "Spouse plan until age has to be between 50 and 120." };
  }
  // Children ride along as JSON: a birth year and a college flag each.
  let childRows: { birthYear?: string; college?: boolean }[] = [];
  try {
    childRows = JSON.parse(String(formData.get("children") ?? "[]"));
    if (!Array.isArray(childRows)) childRows = [];
  } catch {
    return { error: "Couldn't read the children." };
  }
  const children: { birthYear: number; college: boolean }[] = [];
  for (const [i, c] of childRows.entries()) {
    const y = String(c.birthYear ?? "").trim();
    if (!y) continue;
    if (!/^\d{4}$/.test(y)) return { error: `Child #${i + 1}: enter a four-digit birth year.` };
    children.push({ birthYear: Number(y), college: !!c.college });
  }
  if (children.length > 15) return { error: "Up to 15 children." };
  // SGLI: $0–$500,000 in $50,000 steps. VGLI never more than SGLI.
  const sgliCents = num("sgliCents") ?? 50000000;
  if (!SGLI_STEPS_CENTS.includes(sgliCents)) return { error: "SGLI has to be $0–$500,000 in $50,000 steps." };
  const vgliEnabled = formData.get("vgliEnabled") === "on" && sgliCents > 0;
  const vgliCents = Math.min(num("vgliCents") ?? 0, sgliCents);
  const payout = (key: string) => (formData.get(key) === "monthly36" ? "monthly36" : "lump");
  if (healthStartAge != null && (healthStartAge < 18 || healthStartAge > 120)) {
    return { error: "Healthcare start age has to be between 18 and 120." };
  }

  // The income lines ride along as JSON so the whole popup saves at once.
  type LineIn = {
    id?: string | null;
    name?: string;
    kind?: string;
    monthly?: string;
    startYear?: string;
    startMonth?: string;
    endYear?: string;
    endMonth?: string;
    raisePct?: string;
    /** Social Security only: the PIA per month, "" = worked out. */
    piaCents?: string;
    /** "yr" = the amount is per year; else per month. */
    per?: string;
    taxable?: boolean;
    /** FERS only: whose GS career, the survivor share, an early start. */
    owner?: string;
    survivorPct?: string;
    startEarly?: boolean;
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
    start_month: number | null;
    end_year: number | null;
    end_month: number | null;
    raise_pct: number | null;
    annual_cents: number | null;
    pia_cents: number | null;
    taxable: boolean;
    owner: "self" | "spouse";
    survivor_pct: 0 | 25 | 50;
    fers_start_early: boolean;
    sort_order: number;
  }> = [];
  for (const [i, l] of linesIn.entries()) {
    const name = String(l.name ?? "").trim();
    const kind = String(l.kind ?? "") as IncomeLineKind;
    const label = name || `Income line ${i + 1}`;
    if (!name) return { error: `${label}: give it a name.` };
    if (!LINE_KINDS.includes(kind)) return { error: `${label}: pick a type.` };
    if (!String(l.monthly ?? "").trim()) return { error: `${label}: enter the amount.` };
    const start = lineYear(l.startYear);
    const end = lineYear(l.endYear);
    if (start === "bad") return { error: `${label}: first year has to be a four-digit year.` };
    const startMonth = String(l.startMonth ?? "").trim() ? Number(l.startMonth) : null;
    if (startMonth != null && !(Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12)) {
      return { error: `${label}: pick a start month.` };
    }
    if (end === "bad") return { error: `${label}: last year has to be a four-digit year.` };
    const endMonth = String(l.endMonth ?? "").trim() ? Number(l.endMonth) : null;
    if (endMonth != null && !(Number.isInteger(endMonth) && endMonth >= 1 && endMonth <= 12)) {
      return { error: `${label}: pick an end month.` };
    }
    if (start != null && end != null && end * 12 + (endMonth ?? 12) < start * 12 + (startMonth ?? 1)) {
      return { error: `${label}: the end can't be before the start.` };
    }
    // A GS pension is worked out from the career: both ends of it are needed.
    if (kind === "fers" && (start == null || end == null)) {
      return { error: `${label}: enter the year the GS job starts and the year it ends.` };
    }
    const raiseRaw = String(l.raisePct ?? "").trim();
    const raise = kind !== "va" && kind !== "social_security" && kind !== "fers" && raiseRaw ? Number(raiseRaw) : null;
    if (raise != null && !(Number.isFinite(raise) && raise >= 0 && raise <= 20)) {
      return { error: `${label}: raise has to be between 0% and 20%.` };
    }
    lines.push({
      id: l.id || null,
      name,
      kind,
      // Typed per year: kept as typed, and a twelfth of it as the monthly.
      monthly_cents:
        l.per === "yr"
          ? Math.round(Math.max(0, displayToCents(String(l.monthly))) / 12)
          : Math.max(0, displayToCents(String(l.monthly))),
      annual_cents: l.per === "yr" ? Math.max(0, displayToCents(String(l.monthly))) : null,
      start_year: start,
      // A month only means something with a first year.
      start_month: start == null ? null : startMonth,
      end_year: end,
      end_month: end == null ? null : endMonth,
      raise_pct: raise,
      // On a spouse's GS line: their own Social Security at 62, for the supplement.
      pia_cents: (kind === "social_security" || (kind === "fers" && l.owner === "spouse")) && String(l.piaCents ?? "").trim() ? Math.max(0, displayToCents(String(l.piaCents))) || null : null,
      // VA disability is never taxed, whatever the box says; a GS pension always is.
      taxable: kind === "va" ? false : kind === "fers" ? true : !!l.taxable,
      owner: kind === "fers" && l.owner === "spouse" ? "spouse" : "self",
      survivor_pct: kind === "fers" && (l.survivorPct === "25" || l.survivorPct === "50") ? (Number(l.survivorPct) as 25 | 50) : 0,
      fers_start_early: kind === "fers" && !!l.startEarly,
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
    rentPer?: string;
    costs?: string;
    costsPer?: string;
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
      // Typed per month or per year; the projection reads the monthly figure.
      monthly_rent_cents: r.rentPer === "yr" ? Math.round(cents(r.rent) / 12) : cents(r.rent),
      yearly_rent_cents: r.rentPer === "yr" ? cents(r.rent) : null,
      monthly_costs_cents: r.costsPer === "yr" ? Math.round(cents(r.costs) / 12) : cents(r.costs),
      yearly_costs_cents: r.costsPer === "yr" ? cents(r.costs) : null,
      appreciation_pct: appreciation,
      sort_order: i,
    });
  }

  // Account groups ride along as JSON: each group's settings, and any account
  // or bucket moved to a different group.
  type GroupIn = {
    kind?: string;
    returnPct?: string;
    add?: string;
    addStart?: string;
    addEnd?: string;
    take?: string;
    takeStart?: string;
    takeEnd?: string;
    taxPct?: string;
  };
  type MoveIn = { accountId?: string; bucketId?: string | null; group?: string };
  let groupsIn: GroupIn[] = [];
  let movesIn: MoveIn[] = [];
  try {
    groupsIn = JSON.parse(String(formData.get("accountGroups") ?? "[]"));
    if (!Array.isArray(groupsIn)) groupsIn = [];
    movesIn = JSON.parse(String(formData.get("groupMoves") ?? "[]"));
    if (!Array.isArray(movesIn)) movesIn = [];
  } catch {
    return { error: "Couldn't read the account groups." };
  }
  const groupRows: Array<Record<string, unknown>> = [];
  for (const g of groupsIn) {
    if (!isGroupKind(g.kind)) continue;
    const label = GROUP_LABEL[g.kind];
    const pct = (raw: string | undefined, min: number, max: number, what: string): number | null | { error: string } => {
      const t = String(raw ?? "").trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= min && n <= max ? n : { error: `${label}: ${what}` };
    };
    const ret = pct(g.returnPct, -20, 30, "return has to be between -20% and 30%.");
    const tax = pct(g.taxPct, 0, 60, "tax has to be between 0% and 60%.");
    if (ret && typeof ret === "object") return ret;
    if (tax && typeof tax === "object") return tax;
    const yr = (raw: string | undefined, what: string): number | null | { error: string } => {
      const v = lineYear(raw);
      return v === "bad" ? { error: `${label}: ${what} has to be a four-digit year.` } : v;
    };
    const addStart = yr(g.addStart, "add from");
    const addEnd = yr(g.addEnd, "add to");
    const takeStart = yr(g.takeStart, "take out from");
    const takeEnd = yr(g.takeEnd, "take out to");
    for (const v of [addStart, addEnd, takeStart, takeEnd]) if (v && typeof v === "object") return v;
    if (addStart != null && addEnd != null && (addEnd as number) < (addStart as number)) {
      return { error: `${label}: the last year added can't be before the first.` };
    }
    if (takeStart != null && takeEnd != null && (takeEnd as number) < (takeStart as number)) {
      return { error: `${label}: the last year taken out can't be before the first.` };
    }
    const money = (raw: string | undefined) => (String(raw ?? "").trim() ? Math.max(0, displayToCents(String(raw))) : null);
    const take = money(g.take);
    if (take != null && take > 0 && takeStart == null) {
      return { error: `${label}: enter the year withdrawals start.` };
    }
    groupRows.push({
      household_id: householdId,
      kind: g.kind,
      return_pct: ret,
      add_annual_cents: g.kind === "cash" ? null : money(g.add),
      add_start_year: addStart,
      add_end_year: addEnd,
      take_annual_cents: g.kind === "cash" ? null : take,
      take_start_year: takeStart,
      take_end_year: takeEnd,
      tax_pct: tax,
      updated_at: new Date().toISOString(),
    });
  }

  // A new inflation rate counts from this year; the one it replaces stays on
  // the years before (lib/inflation).
  const { data: before } = await supabase
    .from("retirement_plan")
    .select("inflation_pct, inflation_history")
    .eq("household_id", householdId)
    .maybeSingle();
  const inflationHistory =
    before?.inflation_pct == null
      ? parseInflationHistory(before?.inflation_history)
      : recordInflationChange(
          parseInflationHistory(before.inflation_history),
          Number(before.inflation_pct),
          inflation ?? 2.5,
          new Date().getFullYear(),
        );

  const planRow = {
      household_id: householdId,
      birth_year: birthYear,
      target_retire_year: targetYear,
      target_retire_month: targetMonth,
      service_start_year: serviceStart,
      service_start_month: serviceStartMonth,
      high3_monthly_cents: high3Cents,
      base_pay_by_year: basePayByYear,
      investment_return_pct: investReturn ?? 7.5,
      withdraw_start_year: withdrawStart,
      spouse_retire_year: spouseRetire,
      spouse_birth_year: spouseBirthYear,
      ...(formData.has("spouseSsClaimAge")
        ? { spouse_ss_claim_age: spouseClaimAge != null && Number.isInteger(spouseClaimAge) && spouseClaimAge >= 62 && spouseClaimAge <= 70 ? spouseClaimAge : null }
        : {}),
      // No box for it any more (withdrawals are set year by year); keep
      // what's stored rather than resetting it.
      ...(formData.has("withdrawalRatePct") ? { withdrawal_rate_pct: withdrawal ?? 4 } : {}),
      inflation_pct: inflation ?? 2.5,
      inflation_history: inflationHistory,
      cash_return_pct: cashReturn ?? 3,
      sbp_enabled: formData.get("sbpEnabled") === "on",
      sbp_pct: sbpPct ?? 6.5,
      longevity_age: longevity ?? 90,
      spouse_longevity_age: spouseLongevity ?? 90,
      children,
      sgli_cents: sgliCents,
      sgli_payout: payout("sgliPayout"),
      vgli_enabled: vgliEnabled,
      vgli_cents: vgliEnabled ? vgliCents : 0,
      vgli_payout: payout("vgliPayout"),
      health_plans: healthPlans,
      // Typed per month or per year; stored yearly.
      healthcare_annual_cents: (() => {
        const c = money("healthcareAnnual");
        return c != null && formData.get("healthcareAnnualPer") !== "yr" ? c * 12 : c;
      })(),
      healthcare_annual_per: formData.get("healthcareAnnualPer") === "yr" ? "yr" : "mo",
      dental_plans: dentalPlans,
      healthcare_start_age: healthStartAge ?? 65,
      cola_pct: colaPct ?? 0,
      cola_by_year: colaByYear,
      cola_military: formData.get("colaMilitary") === "on",
      cola_va: formData.get("colaVa") === "on",
      cola_social_security: formData.get("colaSocialSecurity") === "on",
      // Replaced by the Net Worth Plan table (spending, saving) and the income
      // lines (guaranteed income). Cleared so an old figure can't quietly win.
      annual_spend_cents: null,
      annual_contribution_cents: null,
      guaranteed_income_cents: null,
      guaranteed_income_start_year: null,
      updated_at: new Date().toISOString(),
  };
  return { planRow, lines, rentals, groupRows, movesIn };
}

export async function saveRetirementPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const parsed = await parsePlanForm(supabase, householdId, formData);
  if ("error" in parsed) return { error: parsed.error };
  const { planRow, lines, rentals, groupRows, movesIn } = parsed;

  const { error } = await supabase.from("retirement_plan").upsert(planRow, { onConflict: "household_id" });
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
          start_month: l.start_month,
          end_year: l.end_year,
          end_month: l.end_month,
          raise_pct: l.raise_pct,
          annual_cents: l.annual_cents,
          pia_cents: l.pia_cents,
          taxable: l.taxable,
          owner: l.owner,
          survivor_pct: l.survivor_pct,
          fers_start_early: l.fers_start_early,
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

  if (groupRows.length > 0) {
    const { error: gErr } = await supabase
      .from("retirement_account_groups")
      .upsert(groupRows, { onConflict: "household_id,kind" });
    if (gErr) return { error: `Couldn't save the account groups — ${gErr.message}` };
  }
  // A move sets the account's (or bucket's) group; "" puts it back to automatic.
  for (const m of movesIn) {
    const accountId = String(m.accountId ?? "");
    if (!accountId) continue;
    const group = isGroupKind(m.group) ? m.group : null;
    const { error: mErr } = m.bucketId
      ? await supabase
          .from("buckets")
          .update({ plan_group: group })
          .eq("household_id", householdId)
          .eq("account_id", accountId)
          .eq("id", m.bucketId)
      : await supabase
          .from("accounts")
          .update({ plan_group: group })
          .eq("household_id", householdId)
          .eq("id", accountId);
    if (mErr) return { error: `Couldn't move an account to its group — ${mErr.message}` };
  }

  try {
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Saved, but couldn't update the plan table." };
  }
  revalidatePath("/networth");
  return { error: null };
}

const LINE_KINDS: IncomeLineKind[] = ["pay", "va", "social_security", "fers", "job", "spouse", "other"];
// ---- Recompute the plan table from the retirement inputs.
//
// income_cents is each year's TOTAL take-home: the pay typed for the year
// (work_income_cents, only before the military retirement year) plus every
// income line paying that year, after SBP and tax. Future years run through
// the account groups (lib/account-groups): each kind of money earns its own
// return on what it opened the year with, takes its planned contributions,
// pays its planned withdrawals and required minimums, and covers any
// shortfall in the usual low-tax order. Tax on withdrawals is added to the
// year's spending. The table is extended to the plan-until age, carrying the
// last year's spending forward.
//
// Years before this one are history and are never touched; this year keeps
// its own gains (the register is measuring them).
async function recomputeRetirementIncome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
): Promise<boolean> {
  const built = buildProjectionRows(householdId, await loadRecomputeInputs(supabase, householdId));
  if (!built) return false;
  const { error } = await supabase
    .from("networth_projection")
    .upsert(built.out, { onConflict: "household_id,year" });
  if (error) throw new Error(`Could not update the projection: ${error.message}`);
  return true;
}

/** Everything the plan table is rebuilt from, as stored. */
async function loadRecomputeInputs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
) {
  const [planRes, linesRes, rowsRes, rentalsRes, acctRes, loanRes, groupInputs, ssRes] = await Promise.all([
    supabase.from("retirement_plan").select("*").eq("household_id", householdId).maybeSingle(),
    supabase.from("retirement_income_lines").select("*").eq("household_id", householdId),
    supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, one_off_cents, eoy_cents, tax_pct, group_overrides")
      .eq("household_id", householdId)
      .order("year"),
    supabase.from("rental_properties").select("*").eq("household_id", householdId),
    supabase.from("accounts").select("id, kind, is_kids_account, active, current_balance_cents").eq("household_id", householdId),
    supabase
      .from("debts")
      .select("property_account_id, current_balance_cents")
      .eq("household_id", householdId)
      .not("property_account_id", "is", null)
      .is("paid_off_at", null),
    loadGroupInputs(supabase, householdId),
    supabase
      .from("social_security_records")
      .select("birth_month, earnings, statement")
      .eq("household_id", householdId)
      .eq("person", "self")
      .maybeSingle(),
  ]);
  if (ssRes.error) throw new Error(`Could not read the Social Security record: ${ssRes.error.message}`);
  if (loanRes.error) throw new Error(`Could not read the mortgages: ${loanRes.error.message}`);
  if (rentalsRes.error) throw new Error(`Could not read the rentals: ${rentalsRes.error.message}`);
  if (acctRes.error) throw new Error(`Could not read the accounts: ${acctRes.error.message}`);
  if (planRes.error) throw new Error(`Could not read the retirement plan: ${planRes.error.message}`);
  if (linesRes.error) throw new Error(`Could not read the income lines: ${linesRes.error.message}`);
  if (rowsRes.error) throw new Error(`Could not read the projection: ${rowsRes.error.message}`);
  return {
    plan: planRes.data,
    lines: linesRes.data ?? [],
    rows: rowsRes.data ?? [],
    rentals: rentalsRes.data ?? [],
    accounts: acctRes.data ?? [],
    loans: loanRes.data ?? [],
    groupInputs,
    ss: ssRes.data,
  };
}
type RecomputeInputs = Awaited<ReturnType<typeof loadRecomputeInputs>>;

/** The plan table's future rows, worked out from the inputs — pure, so the
 *  live preview runs it on unsaved ones. null = no plan or no table yet. */
function buildProjectionRows(householdId: string, d: RecomputeInputs) {
  const thisYear = new Date().getFullYear();
  const plan = d.plan;
  const rows = d.rows.map((r) => ({ ...r, one_off_cents: r.one_off_cents ?? 0 }));
  if (!plan || rows.length === 0) return null;

  const retireYear: number | null = plan.target_retire_year;
  const retireMonth: number | null = plan.target_retire_month ?? null;
  // A blank end means the line never stops (Victor, 2026-10-17).
  const typedLines: IncomeLine[] = d.lines.map(toIncomeLine);
  // With an earnings record saved, Social Security is worked out from it;
  // a GS career becomes the pension it pays.
  const lines = applyFers(
    applySsRecord(typedLines, toSsRecord(d.ss), {
      birthYear: plan.birth_year ?? null,
      spouseBirthYear: plan.spouse_birth_year ?? null,
      spouseClaimAge: plan.spouse_ss_claim_age ?? null,
      thisYear,
    }),
    { birthYear: plan.birth_year ?? null, spouseBirthYear: plan.spouse_birth_year ?? null },
  );
  const pension = estimatePension(
    {
      retireYear,
      retireMonth,
      serviceStartYear: plan.service_start_year,
      serviceStartMonth: plan.service_start_month ?? null,
      high3MonthlyCents: plan.high3_monthly_cents,
      sbpEnabled: !!plan.sbp_enabled,
      sbpPct: Number(plan.sbp_pct ?? 6.5),
    },
  );
  const inflationPct = Number(plan.inflation_pct ?? 2.5);
  // Spending, typed withdrawals and the 4% rule grow from the year they were
  // typed, each year at the rate it had (lib/inflation).
  const inflation = { pct: inflationPct, history: parseInflationHistory(plan.inflation_history) };
  const grow = (from: number, to: number) => inflationGrowth(from, to, inflation);
  const cola: ColaPlan = {
    pct: Number(plan.cola_pct ?? 2.5),
    byYear: parseColaByYear(plan.cola_by_year),
    military: plan.cola_military ?? true,
    va: plan.cola_va ?? true,
    socialSecurity: plan.cola_social_security ?? true,
  };
  const balances = new Map(d.accounts.map((a) => [a.id as string, Number(a.current_balance_cents ?? 0)]));
  const loanByProperty = new Map<string, number>();
  for (const l of d.loans) {
    const id = l.property_account_id as string;
    loanByProperty.set(id, (loanByProperty.get(id) ?? 0) + Number(l.current_balance_cents ?? 0));
  }
  const rentals = (d.rentals as RentalRow[]).map((r) => toRentalProperty(r, balances, loanByProperty));
  const health: HealthcarePlan = {
    birthYear: plan.birth_year,
    retireYear,
    retireMonth,
    plans: parseHealthPlans(plan.health_plans),
    tflAnnualCents: plan.healthcare_annual_cents,
    tflStartAge: Number(plan.healthcare_start_age ?? 65),
    dentalPlans: parseDentalPlans(plan.dental_plans),
  };
  // Each group's return, contributions, withdrawals and tax; a blank return
  // is the plan's (Cash: the savings APY), blank contributions what the last
  // twelve months put in.
  const settings = resolveGroupSettings(d.groupInputs.rows, {
    investReturnPct: Number(plan.investment_return_pct ?? 7.5),
    cashReturnPct: Number(plan.cash_return_pct ?? 3),
    measuredAddCents: d.groupInputs.measuredAddCents,
    // A blank "Add to" stops the year before you stop working.
    stopWorkYear: plan.withdraw_start_year ?? plan.target_retire_year ?? null,
  });

  // Run to the plan-until age — yours or your spouse's, whichever is later —
  // carrying the last year forward.
  const lastYear = planEndYear(
    plan.birth_year ?? null,
    Number(plan.longevity_age ?? 90),
    plan.spouse_birth_year ?? null,
    Number(plan.spouse_longevity_age ?? 90),
  );
  const last = rows[rows.length - 1];
  if (lastYear != null) {
    for (let y = last.year + 1; y <= lastYear; y++) {
      rows.push({
        ...last,
        year: y,
        age: plan.birth_year ? y - plan.birth_year : last.age == null ? null : last.age + (y - last.year),
        one_off_cents: 0,
        // Typed only on the year it was typed; the carry happens below.
        group_overrides: null,
      });
    }
  }

  // Contributions / withdrawals typed per group in the year popup, carried
  // into every later year until another year types a new figure.
  // A typed withdrawal % becomes dollars in its own year, then rises with
  // inflation (the 4% rule).
  const carryPct = pctWithdrawCarrier(grow);
  const overridesByYear = resolveOverrides(
    rows.map((r) => ({ year: r.year, typed: parseTypedGroups(r.group_overrides), withdraw: parseTypedWithdraw(r.group_overrides) })),
    grow,
  );

  // Typed spending rises with inflation from the year it was typed.
  const grownSpend = inflatedSpending(
    rows.map((r) => ({
      year: r.year,
      baseSpendingCents: r.base_spending_cents ?? r.spending_cents,
      restart: parseSpendRestart(r.group_overrides),
    })),
    thisYear,
    grow,
  );

  const stamp = new Date().toISOString();
  const out: Array<Record<string, unknown>> = [];
  let carry: number | null = null;
  // Each group's balance at the start of the next year; set from today's
  // accounts at the first future year.
  let groupBal: Record<GroupKind, number> | null = null;
  for (const row of rows) {
    if (row.year < thisYear) continue;
    const boy: number = carry ?? row.boy_cents;
    // The retirement year is split by month: a November retirement keeps ten
    // months of active-duty pay and gets two months of retired pay.
    const retiredShare = retiredShareOfYear(row.year, retireYear, retireMonth);
    // Future income comes only from Edit Future Projections: retired
    // pay and the income lines, pay from work included. The pay typed into the
    // table only counts for the year in progress — later years carried an old
    // sheet's stand-ins ($100k a year to 2071) into a plan with no income at
    // all (Victor, 2026-10-16).
    const work =
      row.year === thisYear ? Math.round((row.work_income_cents ?? row.income_cents) * (1 - retiredShare)) : 0;
    // Income is gross: taxes are budgeted as spending.
    const yearIncome = incomeForYear(row.year, pension, retireYear, lines, 0, cola, { thisYear, birthYear: plan.birth_year ?? null });
    const pensionYearly = (yearIncome.parts.find((p) => p.kind === "pension")?.monthlyAfterTaxCents ?? 0) * 12;
    // This year's typed pay already is the pay, so a Pay line isn't added on top.
    const payThisYear =
      row.year === thisYear
        ? yearIncome.parts.filter((p) => p.kind === "pay").reduce((t, p) => t + p.monthlyAfterTaxCents * (p.months ?? 12), 0)
        : 0;
    const lineIncome = yearIncome.afterTaxCents - Math.round(pensionYearly * (1 - retiredShare)) - payThisYear;
    // Rentals: net rent is income; equity is part of net worth but earns no
    // investment return — it grows by principal paid and appreciation, and a
    // purchase moves the down payment out of savings (closing costs are gone).
    const rent = rentalsForYear(rentals, row.year, thisYear, inflationPct, 0);
    const income = work + lineIncome + rent.cashAfterTaxCents;
    // The same income by source, for the year popup. Adds up to `income`.
    const incomeParts: { name: string; cents: number }[] = [];
    if (work) incomeParts.push({ name: "Pay (typed for this year)", cents: work });
    for (const p of yearIncome.parts) {
      if (row.year === thisYear && p.kind === "pay") continue;
      const cents =
        p.kind === "pension"
          ? pensionYearly - Math.round(pensionYearly * (1 - retiredShare))
          : p.monthlyAfterTaxCents * (p.months ?? 12);
      if (cents) incomeParts.push({ name: p.name, cents });
    }
    if (rent.cashAfterTaxCents) incomeParts.push({ name: "Rentals (net)", cents: rent.cashAfterTaxCents });
    const baseSpend = row.base_spending_cents ?? row.spending_cents;
    // Spending is what was typed plus healthcare — nothing else. It used to
    // drop by each debt's payment once the Debts page projected it paid off,
    // which on two small 0% cards meant a −$33…−$900 line on every row from
    // 2028; Victor had it removed (2026-09-28).
    const lifeSpending = Math.max(0, (grownSpend.get(row.year) ?? baseSpend) + healthcareForYear(row.year, health));
    const propertyEffect = rent.equityEndCents - rent.equityStartCents - rent.purchaseCashCents;
    // This year keeps its own gains (the register is measuring them); later
    // years run through the groups.
    let growth = row.growth_cents;
    let taxCents = 0;
    let groupDetail: ReturnType<typeof groupsYear> | null = null;
    if (row.year > thisYear) {
      // Everything but rental equity sits in the groups, and they have to add
      // up to it: a gap (this year's remaining saving, debts netted off, a
      // rental's equity moving) is spread across them at the start, and any
      // later drift lands in Cash.
      const investable = boy - rent.equityStartCents;
      if (groupBal == null) {
        groupBal = scaleBalances(d.groupInputs.liveCents, investable);
      } else {
        const sum = GROUP_KINDS.reduce((t, k) => t + groupBal![k], 0);
        groupBal.cash += investable - sum;
      }
      groupDetail = groupsYear(groupBal, settings, {
        year: row.year,
        thisYear,
        inflationPct,
        flowCents: income - lifeSpending + row.one_off_cents - rent.purchaseCashCents,
        age: ageInYear(plan.birth_year ?? null, row.year),
        birthYear: plan.birth_year ?? null,
        overrides: carryPct(row.year, groupBal, overridesByYear.get(row.year)),
      });
      groupBal = groupDetail.balances;
      taxCents = groupDetail.taxCents;
      growth = groupDetail.gainCents + propertyEffect;
    }
    // Tax on what the groups paid out is part of what the year costs.
    const spending = lifeSpending + taxCents;
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
      withdrawn_cents: groupDetail?.withdrawnCents ?? null,
      withdrawal_tax_cents: groupDetail ? taxCents : null,
      planned_add_cents: groupDetail?.addCents ?? null,
      groups: groupDetail ? toStoredGroups(groupDetail.groups) : null,
      income_parts: incomeParts,
      updated_at: stamp,
    });
    carry = eoy;
  }
  if (out.length === 0) return null;
  return { out, rentals };
}

/** What Edit Future Projections' results show while a change is unsaved. */
export type PlanPreview = {
  error: null;
  /** The plan as typed, in the shape the Retirement details cards read. */
  plan: Partial<FiPlan>;
  /** The plan table's future years, rebuilt from what's typed. */
  projection: { year: number; incomeCents: number; spendingCents: number; oneOffCents: number; eoyCents: number; growthCents: number }[];
};

// The live preview (Victor, 2026-10-29): the same checks and the same
// rebuild as Save, on what's typed, with nothing written.
export async function previewRetirementPlan(formData: FormData): Promise<PlanPreview | { error: string }> {
  const { supabase, householdId } = await requireHousehold();
  const parsed = await parsePlanForm(supabase, householdId, formData);
  if ("error" in parsed) return { error: parsed.error };
  const stored = await loadRecomputeInputs(supabase, householdId);
  const plan = { ...(stored.plan ?? {}), ...parsed.planRow };
  const built = buildProjectionRows(householdId, {
    ...stored,
    plan,
    lines: parsed.lines,
    rentals: parsed.rentals,
    groupInputs: { ...stored.groupInputs, rows: parsed.groupRows as unknown as GroupRow[] },
  });
  return {
    error: null,
    plan: {
      ...fiPlanFields(plan),
      incomeLines: parsed.lines.map(toIncomeLine),
      rentalRows: parsed.rentals as unknown as RentalRow[],
      ...(built ? { rentals: built.rentals } : {}),
    },
    projection: (built?.out ?? []).map((r) => ({
      year: r.year as number,
      incomeCents: r.income_cents as number,
      spendingCents: r.spending_cents as number,
      oneOffCents: r.one_off_cents as number,
      eoyCents: r.eoy_cents as number,
      growthCents: r.growth_cents as number,
    })),
  };
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
// A change carries forward, so a flat start
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

  // Future income comes from the income lines, so a first plan with none gets
  // one Pay line at the measured rate — edit its end when work stops.
  const { count: lineCount, error: lineCountError } = await supabase
    .from("retirement_income_lines")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (!lineCountError && (lineCount ?? 0) === 0 && income > 0) {
    const { error: payError } = await supabase.from("retirement_income_lines").insert({
      household_id: householdId,
      name: "Pay",
      kind: "pay",
      monthly_cents: Math.round(income / 12),
      annual_cents: income,
      taxable: true,
      sort_order: 0,
    });
    if (payError) console.error("[seedProjection:pay]", payError);
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
  // Survivor spending % for this year; blank = carried from an earlier year.
  const survRaw = String(formData.get("survivorPct") ?? "").trim();
  const survivorPct = survRaw === "" ? null : Number(survRaw);
  if (survivorPct != null && (!Number.isFinite(survivorPct) || survivorPct <= 0 || survivorPct > 100)) {
    return { error: "Survivor spending has to be between 1% and 100%." };
  }
  // Signed, unlike the others: a windfall is positive, a house is negative.
  const oneOff = displayToCents(String(formData.get("oneOff") ?? "0"));
  // Blank = no estimate. Tracking only; never carried forward or into EOY.
  const contributedRaw = String(formData.get("contributed") ?? "").trim();
  const contributed = contributedRaw === "" ? null : Math.max(0, displayToCents(contributedRaw));

  // What the year held before this save, so the carry-forward below can tell
  // which figures were actually typed and which were merely resubmitted.
  const prev = unwrap(
    await supabase
      .from("networth_projection")
      .select("income_cents, work_income_cents, spending_cents, base_spending_cents, growth_cents, tax_pct, group_overrides")
      .eq("household_id", householdId)
      .eq("year", year)
      .maybeSingle(),
    "networth_projection",
  );

  // The box shows the year's spending grown by inflation. Saved untouched, the
  // typed amount behind it stays; a new amount becomes this year's figure.
  const spendingWas = String(formData.get("spendingWas") ?? "");
  const spendingTyped = spendingWas === "" || displayToCents(spendingWas) !== spending;
  const prevBase = prev ? prev.base_spending_cents ?? prev.spending_cents : null;
  const baseSpending = !spendingTyped && prevBase != null ? prevBase : spending;

  // Proj Contributed / Proj Withdraw per account group. Each box comes in
  // with the figure it showed (gaddWas_…); only a changed box becomes this
  // year's typed figure, and an emptied box drops what this year had typed —
  // the year before's figure (or the group settings) take over again.
  const typedGroups: TypedGroups = parseTypedGroups(prev?.group_overrides);
  for (const kind of GROUP_KINDS) {
    if (kind === "cash") continue;
    for (const field of ["add", "take"] as const) {
      const key = `g${field}_${kind}`;
      if (!formData.has(key)) continue;
      const raw = String(formData.get(key) ?? "").trim();
      const was = String(formData.get(`g${field}Was_${kind}`) ?? "").trim();
      const entry = { ...(typedGroups[kind] ?? {}) };
      if (raw === "") {
        delete entry[field];
      } else {
        const value = Math.max(0, displayToCents(raw));
        if (was === "" || displayToCents(was) !== value) entry[field] = value;
      }
      if (isEmptyTyped(entry)) delete typedGroups[kind];
      else typedGroups[kind] = entry;
    }
  }
  // Return % per group, Cash included: same rule — only a changed box is
  // typed, an emptied one goes back to the year before's (or the settings').
  for (const kind of GROUP_KINDS) {
    const key = `gret_${kind}`;
    if (!formData.has(key)) continue;
    const raw = String(formData.get(key) ?? "").replace(/[%\s]/g, "");
    const was = String(formData.get(`gretWas_${kind}`) ?? "").replace(/[%\s]/g, "");
    const entry = { ...(typedGroups[kind] ?? {}) };
    if (raw === "") {
      delete entry.ret;
    } else {
      const value = Number(raw);
      if (Number.isFinite(value) && (was === "" || Number(was) !== value)) entry.ret = clampReturnPct(value);
    }
    if (isEmptyTyped(entry)) delete typedGroups[kind];
    else typedGroups[kind] = entry;
  }
  // Proj Withdraw %, per investment group: the same rule. A typed percent
  // replaces any dollar withdrawal the year held.
  for (const kind of GROUP_KINDS) {
    if (kind === "cash") continue;
    const key = `gtakepct_${kind}`;
    if (!formData.has(key)) continue;
    const raw = String(formData.get(key) ?? "").replace(/[%\s]/g, "");
    const was = String(formData.get(`gtakepctWas_${kind}`) ?? "").replace(/[%\s]/g, "");
    const entry = { ...(typedGroups[kind] ?? {}) };
    if (raw === "") {
      delete entry.takePct;
    } else {
      const value = Number(raw);
      if (Number.isFinite(value) && (was === "" || Number(was) !== value)) {
        entry.takePct = clampWithdrawPct(value);
        delete entry.take;
      }
    }
    if (isEmptyTyped(entry)) delete typedGroups[kind];
    else typedGroups[kind] = entry;
  }

  // Tax % on withdrawals, per investment group: the same rule — only a
  // changed box is typed and carries into later years.
  for (const kind of GROUP_KINDS) {
    if (kind === "cash") continue;
    const key = `gtax_${kind}`;
    if (!formData.has(key)) continue;
    const raw = String(formData.get(key) ?? "").replace(/[%\s]/g, "");
    const was = String(formData.get(`gtaxWas_${kind}`) ?? "").replace(/[%\s]/g, "");
    const entry = { ...(typedGroups[kind] ?? {}) };
    if (raw === "") {
      delete entry.tax;
    } else {
      const value = Number(raw);
      if (Number.isFinite(value) && (was === "" || Number(was) !== value)) entry.tax = clampTaxPct(value);
    }
    if (isEmptyTyped(entry)) delete typedGroups[kind];
    else typedGroups[kind] = entry;
  }

  // The year's Est. Withdraw total: a changed box becomes this year's typed
  // figure (0 stops withdrawals from here on); emptied, the year before's
  // carries again.
  // "3%" is a percent of each year's start; anything else is dollars.
  let typedWithdraw = parseTypedWithdraw(prev?.group_overrides);
  // The popup now types withdrawals per group; a yearly total saved before
  // that would override them, so a save from the group boxes drops it.
  if (!formData.has("withdraw") && [...formData.keys()].some((k) => k.startsWith("gtakepct_"))) typedWithdraw = null;
  if (formData.has("withdraw")) {
    const norm = (v: string) => v.replace(/[\s,$]/g, "");
    const raw = norm(String(formData.get("withdraw") ?? ""));
    const was = norm(String(formData.get("withdrawWas") ?? ""));
    if (raw === "") typedWithdraw = null;
    else if (raw !== was) {
      if (raw.endsWith("%")) {
        const pct = Number(raw.slice(0, -1));
        if (Number.isFinite(pct)) typedWithdraw = { pct: clampWithdrawPct(pct) };
      } else {
        typedWithdraw = { cents: Math.max(0, displayToCents(raw)) };
      }
    }
  }
  // A spending typed here restarts its inflation growth in this year, even
  // when the amount matches the base the years before it already held.
  const spendFrom = spendingTyped || parseSpendRestart(prev?.group_overrides);
  const overridesOut = {
    ...typedGroups,
    ...(spendFrom ? { spendFrom: true } : {}),
    ...(typedWithdraw == null ? {} : "pct" in typedWithdraw ? { withdrawPct: typedWithdraw.pct } : { withdraw: typedWithdraw.cents }),
  };

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
      base_spending_cents: baseSpending,
      growth_cents: growth,
      one_off_cents: oneOff,
      contributed_cents: contributed,
      tax_pct: taxPct,
      // Only when the popup sent the box, so other saves leave it alone.
      ...(formData.has("survivorPct") ? { survivor_spending_pct: survivorPct } : {}),
      group_overrides: Object.keys(overridesOut).length > 0 ? overridesOut : null,
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
    if (spendingTyped && prevBase !== spending) {
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
    // The carried spending replaces what later years had typed, so their
    // restart markers go too — growth now runs from this year.
    if (carry.base_spending_cents != null) {
      const later = unwrap(
        await supabase
          .from("networth_projection")
          .select("year, group_overrides")
          .eq("household_id", householdId)
          .gt("year", year),
        "networth_projection",
      );
      for (const r of later ?? []) {
        if (!parseSpendRestart(r.group_overrides)) continue;
        const rest = { ...(r.group_overrides as Record<string, unknown>) };
        delete rest.spendFrom;
        await supabase
          .from("networth_projection")
          .update({ group_overrides: Object.keys(rest).length > 0 ? rest : null })
          .eq("household_id", householdId)
          .eq("year", r.year);
      }
    }
  }

  try {
    // The retirement recompute re-chains every year from this one on, so for
    // this year or later the plain chain rebuild was the same work twice
    // (~450ms). It still runs for a past year — the recompute never touches
    // history — or when there is no retirement plan to recompute from.
    const thisYear = new Date().getFullYear();
    if (year < thisYear) await rebuildProjectionChain(supabase, householdId, year);
    const rechained = await recomputeRetirementIncome(supabase, householdId);
    if (!rechained && year >= thisYear) await rebuildProjectionChain(supabase, householdId, year);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not rebuild the projection." };
  }

  revalidatePath("/networth");
  return { error: null };
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
  // The projection rows the caller already read, to skip reading them again —
  // the Net Worth page has them in its main batch.
  knownRows?: { year: number; income_cents: number | null; spending_cents: number | null; growth_cents: number | null }[],
): Promise<number[]> {
  let rows = knownRows?.filter((r) => r.year < thisYear).sort((a, b) => a.year - b.year) ?? null;
  if (!rows) {
    const { data, error } = await supabase
      .from("networth_projection")
      .select("year, income_cents, spending_cents, growth_cents")
      .eq("household_id", householdId)
      .lt("year", thisYear)
      .order("year");
    if (error || !data) return [];
    rows = data;
  }

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
  // The year's current boy_cents if the caller already read it (undefined =
  // read it here; null = there's no row for the year).
  knownBoyCents?: number | null,
): Promise<boolean> {
  if (actualStartCents == null) return false;
  const row =
    knownBoyCents !== undefined
      ? knownBoyCents == null
        ? null
        : { boy_cents: knownBoyCents }
      : unwrap(
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

/**
 * The withdrawal rate behind the Investments card's "Needed in" figure — the
 * yardstick only (how much the investments must be to cover the year's gap at
 * that %). The withdrawals themselves stay per group in the year popup.
 */
export async function setWithdrawalRate(pct: number) {
  const { supabase, householdId } = await requireHousehold();
  if (!Number.isFinite(pct) || pct <= 0 || pct > 20) {
    return { error: "Withdrawal rate has to be between 0% and 20%." };
  }
  const { error } = await supabase
    .from("retirement_plan")
    .update({ withdrawal_rate_pct: pct, updated_at: new Date().toISOString() })
    .eq("household_id", householdId);
  if (error) {
    console.error("[setWithdrawalRate]", error);
    return { error: `Couldn't save the rate — ${error.message}` };
  }
  revalidatePath("/networth");
  return { ok: true };
}

// ---- Social Security earnings record (lib/ssa) --------------------------
//
// The statement PDF is read in the browser; only its numbers arrive here.
// Each change re-runs the plan so the projection and the survivor card use
// the record at once.

const ssRow = (supabase: SupabaseClient, householdId: string) =>
  supabase
    .from("social_security_records")
    .select("earnings")
    .eq("household_id", householdId)
    .eq("person", "self")
    .maybeSingle();

async function ssSaved(supabase: SupabaseClient, householdId: string) {
  try {
    await recomputeRetirementIncome(supabase, householdId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Saved, but couldn't update the plan table." };
  }
  revalidatePath("/networth");
  return { error: null };
}

/** Saves a read statement: its earnings replace the record, and its figures
 *  are kept to compare against. Finished years typed after the statement's
 *  last one stay; nothing for this year or later — no planned pay (Victor,
 *  2026-10-23). */
export async function importSsStatement(input: {
  birthMonth: number | null;
  statement: SsStatementFigures;
  earnings: { year: number; cents: number; split?: boolean }[];
}) {
  const { supabase, householdId } = await requireHousehold();
  const earnings = parseSsEarnings(input.earnings);
  if (earnings.length === 0) return { error: "No earnings were found on that statement." };
  const st = input.statement;
  if (!st || !/^\d{4}-\d{2}-\d{2}$/.test(String(st.statementDate))) return { error: "The statement date couldn't be read." };
  const { data: prior, error: readErr } = await ssRow(supabase, householdId);
  if (readErr) return { error: `Couldn't read the record — ${readErr.message}` };
  const lastPosted = earnings.at(-1)!.year;
  const thisYear = new Date().getFullYear();
  const typedSince = parseSsEarnings(prior?.earnings).filter((r) => r.year > lastPosted && r.year < thisYear);
  const bm = input.birthMonth;
  const { error } = await supabase.from("social_security_records").upsert(
    {
      household_id: householdId,
      person: "self",
      birth_month: bm != null && Number.isInteger(bm) && bm >= 1 && bm <= 12 ? bm : null,
      statement_date: st.statementDate,
      statement: st,
      earnings: [...earnings, ...typedSince],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,person" },
  );
  if (error) return { error: `Couldn't save the record — ${error.message}` };
  return ssSaved(supabase, householdId);
}

/** Adds or replaces one finished year of earnings, typed by hand — not this
 *  year or later: the record holds what SSA posts, never planned pay. */
export async function saveSsYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const year = Number(String(formData.get("year") ?? "").trim());
  const raw = String(formData.get("earnings") ?? "").trim();
  if (!Number.isInteger(year) || year < 1937 || year > 2100) return { error: "Enter a four-digit year." };
  if (year >= new Date().getFullYear()) return { error: "Add a year once it's over and SSA has posted it." };
  if (!raw) return { error: "Enter the earnings for that year." };
  const cents = Math.max(0, displayToCents(raw));
  const { data: prior, error: readErr } = await ssRow(supabase, householdId);
  if (readErr) return { error: `Couldn't read the record — ${readErr.message}` };
  const earnings = [...parseSsEarnings(prior?.earnings).filter((r) => r.year !== year), { year, cents }].sort((a, b) => a.year - b.year);
  const { error } = await supabase.from("social_security_records").upsert(
    { household_id: householdId, person: "self", earnings, updated_at: new Date().toISOString() },
    { onConflict: "household_id,person" },
  );
  if (error) return { error: `Couldn't save that year — ${error.message}` };
  return ssSaved(supabase, householdId);
}

/** The statement's monthly benefit at 62, 67 and 70, typed over by him when
 *  he reviews a new statement (Victor, 2026-10-23). Blank keeps a figure;
 *  the other ages the import read stay as they were. */
export async function saveSsBenefits(input: Record<string, string>) {
  const { supabase, householdId } = await requireHousehold();
  const figures: Record<string, number> = {};
  for (const age of ["62", "67", "70"]) {
    const raw = String(input[age] ?? "").trim();
    if (!raw) continue;
    const cents = displayToCents(raw);
    if (!(cents > 0)) return { error: `Enter the monthly benefit at ${age} as a dollar amount.` };
    figures[age] = cents;
  }
  const { data: prior, error: readErr } = await supabase
    .from("social_security_records")
    .select("statement")
    .eq("household_id", householdId)
    .eq("person", "self")
    .maybeSingle();
  if (readErr) return { error: `Couldn't read the record — ${readErr.message}` };
  if (!prior) return { error: "Import your SSA statement first." };
  const st = (prior.statement as SsStatementFigures | null) ?? {
    statementDate: new Date().toISOString().slice(0, 10),
    retirementByAge: {},
    disabilityCents: null,
    survivors: null,
    assumedEarningsCents: null,
  };
  const statement: SsStatementFigures = { ...st, retirementByAge: { ...st.retirementByAge, ...figures } };
  const { error } = await supabase
    .from("social_security_records")
    .update({ statement, updated_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .eq("person", "self");
  if (error) return { error: `Couldn't save the benefits — ${error.message}` };
  return ssSaved(supabase, householdId);
}

/** Removes one year from the record. */
export async function deleteSsYear(year: number) {
  const { supabase, householdId } = await requireHousehold();
  const { data: prior, error: readErr } = await ssRow(supabase, householdId);
  if (readErr) return { error: `Couldn't read the record — ${readErr.message}` };
  if (!prior) return { error: null };
  const earnings = parseSsEarnings(prior.earnings).filter((r) => r.year !== year);
  const { error } = await supabase
    .from("social_security_records")
    .update({ earnings, updated_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .eq("person", "self");
  if (error) return { error: `Couldn't remove that year — ${error.message}` };
  return ssSaved(supabase, householdId);
}

/** Deletes the whole record: Social Security goes back to the typed line. */
export async function clearSsRecord() {
  const { supabase, householdId } = await requireHousehold();
  const { error } = await supabase.from("social_security_records").delete().eq("household_id", householdId).eq("person", "self");
  if (error) return { error: `Couldn't remove the record — ${error.message}` };
  return ssSaved(supabase, householdId);
}
