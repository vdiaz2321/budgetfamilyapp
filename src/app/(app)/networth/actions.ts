"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { currentMonthFirst } from "@/lib/snapshots";
import { unwrap } from "@/lib/supabase-result";

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
// For years where only the total is known (no section breakdown), the full
// amount is stored in bank_cents so net = bank_cents = total.
export async function upsertNetworthYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const year = Number(formData.get("year"));
  const nowYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1990 || year >= nowYear) {
    return { error: "Enter a valid past year." };
  }
  const totalCents = displayToCents(String(formData.get("total") ?? "0"));
  const month = `${year}-12-01`;

  const { error } = await supabase
    .from("networth_history")
    .upsert(
      {
        household_id: householdId,
        month,
        bank_cents: totalCents,
        savings_cents: 0,
        stocks_cents: 0,
        debt_cents: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,month" },
    );
  if (error) return { error: "Couldn't save — try again." };

  revalidatePath("/networth");
  return { error: null };
}

export async function deleteNetworthHistory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!MONTH_RE.test(month)) return;

  await supabase
    .from("networth_history")
    .delete()
    .eq("household_id", householdId)
    .eq("month", month);

  revalidatePath("/networth");
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

  const birthYear = num("birthYear");
  const targetYear = num("targetRetireYear");
  const realReturn = num("realReturnPct");
  const withdrawal = num("withdrawalRatePct");

  if (birthYear != null && (birthYear < 1900 || birthYear > 2200)) {
    return { error: "Enter a four-digit birth year." };
  }
  if (targetYear != null && (targetYear < 1900 || targetYear > 2200)) {
    return { error: "Enter a four-digit target year." };
  }
  if (realReturn != null && (realReturn < -20 || realReturn > 20)) {
    return { error: "A real return outside -20%…20% isn't a plan, it's a bet." };
  }
  if (withdrawal != null && (withdrawal <= 0 || withdrawal > 20)) {
    return { error: "Withdrawal rate has to be between 0% and 20%." };
  }

  const { error } = await supabase.from("retirement_plan").upsert(
    {
      household_id: householdId,
      birth_year: birthYear,
      target_retire_year: targetYear,
      annual_spend_cents: money("annualSpend"),
      annual_contribution_cents: money("annualContribution"),
      real_return_pct: realReturn ?? 5,
      withdrawal_rate_pct: withdrawal ?? 4,
      include_cash: formData.get("includeCash") === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  );
  if (error) {
    console.error("[saveRetirementPlan]", error);
    return { error: `Couldn't save the plan — ${error.message}` };
  }

  revalidatePath("/networth");
  return { error: null };
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
  eoy_cents: number;
};

async function rebuildProjectionChain(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  fromYear: number,
) {
  const { data: rows, error } = await supabase
    .from("networth_projection")
    .select("year, age, boy_cents, income_cents, spending_cents, growth_cents, eoy_cents")
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
    const eoy: number = boy + row.income_cents - row.spending_cents + row.growth_cents;
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
      spending_cents: spending,
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
      .select("year, age, income_cents, spending_cents, growth_cents, eoy_cents")
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
    const eoy = carry + last.income_cents - last.spending_cents + last.growth_cents;
    rows.push({
      household_id: householdId,
      year,
      // Ages keep counting from the last year that had one.
      age: last.age == null ? null : last.age + i,
      boy_cents: carry,
      income_cents: last.income_cents,
      spending_cents: last.spending_cents,
      growth_cents: last.growth_cents,
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

  const income = cents("income");
  const spending = cents("spending");
  const growth = cents("growth");

  // What the year held before this save, so the carry-forward below can tell
  // which figures were actually typed and which were merely resubmitted.
  const prev = unwrap(
    await supabase
      .from("networth_projection")
      .select("income_cents, spending_cents, growth_cents")
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
      spending_cents: spending,
      growth_cents: growth,
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
  const carry: Record<string, number> = {};
  if (!prev || prev.income_cents !== income) carry.income_cents = income;
  if (!prev || prev.spending_cents !== spending) carry.spending_cents = spending;
  if (!prev || prev.growth_cents !== growth) carry.growth_cents = growth;

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
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not rebuild the projection." };
  }

  revalidatePath("/networth");
  return { error: null };
}

// Regenerates every year after `fromYear` from the assumptions — income grows
// at its rate, spending at personal inflation, growth is the return applied to
// the opening balance. This is the sheet's model doing the typing instead of
// Victor doing it, and it deliberately overwrites hand-entered future years,
// so the UI asks first.
export async function fillProjectionForward(fromYear: number) {
  const { supabase, householdId } = await requireHousehold();

  const [{ data: plan }, { data: rows, error: rowsError }] = await Promise.all([
    supabase
      .from("retirement_plan")
      .select("projection_return_pct, personal_inflation_pct, income_growth_pct")
      .eq("household_id", householdId)
      .maybeSingle(),
    supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, spending_cents, growth_cents, eoy_cents")
      .eq("household_id", householdId)
      .order("year"),
  ]);
  if (rowsError) return { error: `Could not read the projection — ${rowsError.message}` };

  const all = rows ?? [];
  const base = all.find((r) => r.year === fromYear);
  if (!base) return { error: `${fromYear} isn't in the projection yet.` };

  const returnPct = Number(plan?.projection_return_pct ?? 8);
  const inflationPct = Number(plan?.personal_inflation_pct ?? 4);
  const incomePct = Number(plan?.income_growth_pct ?? 2.5);

  // The year you fill forward FROM is the anchor: its own figures are left
  // exactly as typed, and the chain starts from the balance they actually
  // land on. Recomputing its growth here (as this used to) produced a
  // closing balance that disagreed with the row's own stored EOY, so the
  // grid showed year N ending on one number and year N+1 opening on another.
  const baseEoy =
    base.boy_cents + base.income_cents - base.spending_cents + base.growth_cents;

  let income = base.income_cents;
  let spending = base.spending_cents;
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
      eoy_cents: baseEoy,
      updated_at: new Date().toISOString(),
    });
  }

  for (const row of all.filter((r) => r.year > fromYear)) {
    income = Math.round(income * (1 + incomePct / 100));
    spending = Math.round(spending * (1 + inflationPct / 100));
    const growth = Math.round((carry * returnPct) / 100);
    const eoy = carry + income - spending + growth;
    updates.push({
      household_id: householdId,
      year: row.year,
      age: row.age,
      boy_cents: carry,
      income_cents: income,
      spending_cents: spending,
      growth_cents: growth,
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
