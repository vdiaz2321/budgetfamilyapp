"use server";

import { revalidatePath } from "next/cache";
import { displayToCents, moneyExpressionToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { resolvePayeeId } from "@/lib/payees";
import { adjustBucketBalance } from "@/lib/buckets";
import { adjustDebtBalance } from "@/lib/debts";
import { saveDebt } from "@/lib/save-debt";
import { adjustAccountLedger, categoryKindOf, ledgerDelta } from "@/lib/account-ledger";
import { unwrap } from "@/lib/supabase-result";
import { getSessionContext } from "@/lib/auth-context";
import { fetchTripPlans } from "@/lib/trip-budget-plans";

// travel_trip_expenses.category keys — the rows on a trip's Spending table.
import { bookingColumns, bookingRefOf, resolveBookingRef, syncBookingPayment, type BookingRef } from "@/app/(app)/travel/booking-payments";
import type { TripPurchaseCandidate, TripTagging } from "./types";

const TRAVEL_CATEGORY_KEYS = new Set(["restaurants", "groceries", "entertainment", "transport", "fuel_tolls", "parking", "cash", "other"]);

// "Points used" typed beside a booking payment. Blank means "leave the
// booking's own figure"; a number (0 included) is written onto the booking.
function bookingPointsOf(formData: FormData): number | null {
  const raw = String(formData.get("bookingPoints") ?? "").replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The Travel Log row picked on the form for a trip purchase on the catch-all
// item (its own row is "Other"). Kept only when it applies — a trip, no
// booking, that item — and only when it differs from the item's row, so
// null always means "the item decides".
function travelCategoryOf(
  formData: FormData,
  itemCategory: string | null | undefined,
  tripId: string | null,
  booking: BookingRef | null,
): string | null {
  if (!tripId || booking || itemCategory !== "other") return null;
  const raw = String(formData.get("travelCategory") ?? "").trim();
  return TRAVEL_CATEGORY_KEYS.has(raw) && raw !== "other" ? raw : null;
}

// Trip spending belongs on the trip items (Restaurant Travel, Traveling/Trips —
// subcategories.receives_trip_plans), never on everyday Groceries, Fuel or
// Entertainment, or it eats their monthly budget. A trip purchase on another
// item with a Travel Log row moves to the trip item for that row when there is
// one (Restaurants → Restaurant Travel), else to the catch-all, keeping its
// row on the purchase (Groceries → Traveling/Trips, Groceries column). The
// form shows the same move; this is where it is enforced, one split at a time.
// Booking payments are left alone — they settle a booking, not a column.
const TRIP_SUB_SELECT = "id, category_id, name, linked_bucket_id, linked_account_id, travel_category, receives_trip_plans, categories(kind)";
type TripRoutableSub = {
  category_id: string;
  name: string;
  linked_bucket_id: string | null;
  linked_account_id: string | null;
  travel_category: string | null;
  receives_trip_plans: boolean;
  categories: { kind: string } | null;
};
async function routeTripPurchase<S extends TripRoutableSub>(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
  sub: S,
  tripId: string | null,
  booking: BookingRef | null,
): Promise<{ subcategoryId: string; sub: S; forcedCategory: string | null }> {
  const keep = { subcategoryId, sub, forcedCategory: null };
  if (!tripId || booking || !sub.travel_category || sub.receives_trip_plans) return keep;
  const tripItems = unwrap(
    await supabase
      .from("subcategories")
      .select(TRIP_SUB_SELECT)
      .eq("household_id", householdId)
      .eq("receives_trip_plans", true)
      .returns<(TripRoutableSub & { id: string })[]>(),
    "trip budget items",
  ) ?? [];
  const target =
    tripItems.find((t) => t.travel_category === sub.travel_category) ??
    tripItems.find((t) => t.travel_category === "other");
  if (!target) return keep;
  return {
    subcategoryId: target.id,
    sub: target as unknown as S,
    forcedCategory: target.travel_category === "other" ? sub.travel_category : null,
  };
}

// The bucket a Savings subcategory contributes to, if any linked — null when
// not a savings item or not linked, so callers can skip the bucket math.
async function getLinkedBucketId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const data = unwrap(
    await supabase
      .from("subcategories")
      .select("linked_bucket_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  return data?.linked_bucket_id ?? null;
}

// Same, but for the direct-account link used by Savings items pointing at a
// bare investment account (TSP, M1, Charles Schwab, …) with no buckets.
async function getLinkedAccountId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const data = unwrap(
    await supabase
      .from("subcategories")
      .select("linked_account_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  return (data as { linked_account_id?: string | null } | null)?.linked_account_id ?? null;
}

// Move an investment account's balance directly (contributions/withdrawals
// from a linked savings sub). Bypasses the usual "investment accounts are
// hand-reconciled" guard in adjustAccountLedger because the user opted in by
// linking. Still refuses if the account has buckets — those are the source
// of truth for their parent.
async function adjustLinkedAccountBalance(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  accountId: string,
  deltaCents: number,
): Promise<boolean> {
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (accountError) throw new Error(`Could not read the linked account: ${accountError.message}`);
  if (!account) return false;

  // A failed count is falsy, which would let a bucketed account fall through
  // to the direct balance write below — same trap as adjustAccountLedger.
  const { count, error: countError } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (countError) throw new Error(`Could not check the account's buckets: ${countError.message}`);
  if (count) return false;

  await supabase
    .from("accounts")
    .update({
      current_balance_cents: (account.current_balance_cents ?? 0) + deltaCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("household_id", householdId);
  return true;
}

// The shared, request-cached session: the sign-in is verified locally (no
// auth-server trip) and profile + household come in one query. The page
// re-render that follows a save in the same request reuses the same result.
async function requireHousehold() {
  const { supabase, household } = await getSessionContext();
  return { supabase, householdId: household.id };
}

const CUSTOM_GROUP_KINDS = new Set(["income", "bills", "expenses", "savings"]);

// Payee autocomplete list, fetched on demand instead of shipped with every
// budget page render — the full list is ~28KB of RSC payload for a control
// most page loads never open. Read-only, so no revalidate.
export async function listPayees(): Promise<{ id: string; name: string }[]> {
  const { supabase, householdId } = await requireHousehold();
  const data = unwrap(
    await supabase
      .from("payees")
      .select("id, name")
      .eq("household_id", householdId),
    "payees",
  );
  return data ?? [];
}


export async function addCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!name) return { error: "Enter a group name." };
  if (!CUSTOM_GROUP_KINDS.has(kind)) return { error: "Choose Income, Bills, Expenses, or Savings." };

  const last = unwrap(
    await supabase
      .from("categories")
      .select("sort_order")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "categories",
  );

  const { error } = await supabase.from("categories").insert({
    household_id: householdId,
    name,
    kind,
    sort_order: (last?.sort_order ?? -1) + 1,
    is_system: false,
  });
  if (error) {
    if (error.code === "23505") return { error: "A group with that name already exists." };
    return { error: "The group could not be created." };
  }

  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
  return {};
}

export async function renameCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Enter a group name." };

  // System groups rename too. `kind` is what every query keys off — the name is
  // a label, so "Savings" can read "Invest/Savings" without changing behaviour.
  // The old `.eq("is_system", false)` guard matched zero rows for those groups
  // and returned no error, so the modal reported success and changed nothing.
  const { data: renamed, error } = await supabase
    .from("categories")
    .update({ name })
    .eq("id", id)
    .eq("household_id", householdId)
    .select("id");
  if (error?.code === "23505") return { error: "A group with that name already exists." };
  if (error) return { error: "The group could not be renamed." };
  if (!renamed?.length) return { error: "That group no longer exists." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
  return {};
}

export async function moveCategoryGroup(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !["up", "down"].includes(direction)) return;

  const target = unwrap(
    await supabase
      .from("categories")
      .select("id, is_system")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "categories",
  );
  if (!target || target.is_system) return;

  const categories = unwrap(
    await supabase
      .from("categories")
      .select("id")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    "categories",
  );
  const orderedIds = (categories ?? []).map((category) => category.id);
  const index = orderedIds.indexOf(id);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
  [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];

  await Promise.all(
    orderedIds.map((categoryId, sortOrder) =>
      supabase
        .from("categories")
        .update({ sort_order: sortOrder })
        .eq("id", categoryId)
        .eq("household_id", householdId),
    ),
  );
  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
}

export async function deleteCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Group not found." };

  const { count } = await supabase
    .from("subcategories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("category_id", id);
  if ((count ?? 0) > 0) return { error: "Move or delete the group’s items first." };

  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId)
    .eq("is_system", false);
  if (error) return { error: "The group could not be deleted." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
  return {};
}

// ---------- Planned amounts (per subcategory per month) ----------

/**
 * Move planned dollars from one budget item to another within a month.
 *
 * Covering an overspent category by taking the money from somewhere that has
 * room is the single most-used action in an envelope budget, and there was no
 * way to do it here — the only route was editing two Planned fields by hand and
 * remembering what the numbers had been.
 *
 * The two writes aren't wrapped in a transaction: PostgREST has no cross-call
 * transaction, and the failure mode is benign (the source keeps its money and
 * nothing is created from nothing). Guarding the source amount matters more,
 * and that is enforced below.
 */
export async function coverOverspend(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const fromSubId = String(formData.get("fromSubcategoryId") ?? "");
  const toSubId = String(formData.get("toSubcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const amountCents = moneyExpressionToCents(String(formData.get("amount") ?? "0"));

  if (!fromSubId || !toSubId || !month) return { error: "Missing details." };
  if (fromSubId === toSubId) return { error: "Pick a different category to move from." };
  if (amountCents <= 0) return { error: "Enter an amount above zero." };

  const plans = unwrap(
    await supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .in("subcategory_id", [fromSubId, toSubId]),
    "budget_plans",
  );

  const plannedOf = (id: string) =>
    (plans ?? []).find((p) => p.subcategory_id === id)?.planned_cents ?? 0;
  const fromPlanned = plannedOf(fromSubId);
  if (fromPlanned < amountCents) {
    return { error: "That category doesn't have enough planned to move." };
  }

  const now = new Date().toISOString();
  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: fromSubId, planned_cents: fromPlanned - amountCents, updated_at: now },
    { onConflict: "household_id,month,subcategory_id" },
  );
  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: toSubId, planned_cents: plannedOf(toSubId) + amountCents, updated_at: now },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

/**
 * Add to an item's planned amount, rather than replacing it.
 *
 * Used when assigning unallocated income from the hero card — the money has no
 * source category to come out of, so this is a one-sided increase rather than
 * the two-sided move that `coverOverspend` performs.
 */
export async function addToPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const addCents = moneyExpressionToCents(String(formData.get("addAmount") ?? "0"));
  if (!subcategoryId || !month || addCents <= 0) return { error: "Missing details." };

  // This read is the base of the number written back, so a swallowed error
  // wouldn't add to the plan — it would REPLACE it with just `addCents`.
  const { data: existing, error: existingError } = await supabase
    .from("budget_plans")
    .select("planned_cents")
    .eq("household_id", householdId)
    .eq("month", month)
    .eq("subcategory_id", subcategoryId)
    .maybeSingle();
  if (existingError) return { error: "Couldn't read the current plan. Try again." };

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: (existing?.planned_cents ?? 0) + addCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

/**
 * Reduce an item's planned amount — the mirror of `addToPlan`.
 *
 * Used from the hero card when planned outflow exceeds income: the money isn't
 * moving anywhere in particular, it's just being un-budgeted, so this is a
 * one-sided decrease rather than the two-sided move `coverOverspend` performs.
 * Refuses to cut below zero or below what the item has already spent, which
 * would silently manufacture an overspent row.
 */
export async function trimFromPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const trimCents = moneyExpressionToCents(String(formData.get("trimAmount") ?? "0"));
  if (!subcategoryId || !month || trimCents <= 0) return { error: "Missing details." };

  const existing = unwrap(
    await supabase
      .from("budget_plans")
      .select("planned_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .eq("subcategory_id", subcategoryId)
      .maybeSingle(),
    "budget_plans",
  );

  const planned = existing?.planned_cents ?? 0;
  if (planned < trimCents) return { error: "That item doesn't have that much planned." };

  const actual = unwrap(
    await supabase
      .from("v_monthly_actuals")
      .select("actual_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .eq("subcategory_id", subcategoryId)
      .maybeSingle(),
    "v_monthly_actuals",
  );

  const spent = actual?.actual_cents ?? 0;
  if (planned - trimCents < spent) {
    return { error: "That would drop the plan below what's already spent." };
  }

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: planned - trimCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

export async function upsertPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  if (!subcategoryId || !month) return;

  const typedCents = moneyExpressionToCents(String(formData.get("planned") ?? "0"));
  // The Budget shows an item's plan WITH its trips (Travel Log) added in, so
  // the figure typed here is that total. Only the part above the trips is
  // stored — the trips are read live, and storing them too would count them
  // twice. Typing less than the trips alone stores $0 extra.
  const tripCents = (await fetchTripPlans(supabase, householdId, { months: [month] }))
    .filter((r) => r.subcategory_id === subcategoryId)
    .reduce((sum, r) => sum + r.planned_cents, 0);
  const plannedCents = Math.max(0, typedCents - tripCents);

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: plannedCents,
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
  // A debt item's plan is the Pay Card prefill on Accounts and Travel Log,
  // and Debt/Loans projects from it.
  revalidatePath("/snowball");
  revalidatePath("/accounts");
  revalidatePath("/travel");
}

// Move `amountCents` of planned budget from one subcategory to another for a
// given month. Both rows in budget_plans are updated atomically-ish (best effort
// — Supabase JS lacks true multi-row transactions from the client; we upsert in
// sequence and swallow no errors). Read the source's current planned amount,
// subtract, then upsert both.
export async function reassignPlanned(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const fromSubId = String(formData.get("fromSubId") ?? "");
  const toSubId = String(formData.get("toSubId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  const amountCents = moneyExpressionToCents(String(formData.get("amount") ?? "0"));

  if (!fromSubId || !toSubId || !month || amountCents <= 0 || fromSubId === toSubId) {
    return { error: "Missing or invalid inputs" };
  }

  // Both plans are rewritten from this one read; losing it would zero the
  // source item and overwrite the destination with just the moved amount.
  const { data: existing, error: existingError } = await supabase
    .from("budget_plans")
    .select("subcategory_id, planned_cents")
    .eq("household_id", householdId)
    .eq("month", month)
    .in("subcategory_id", [fromSubId, toSubId]);
  if (existingError) return { error: "Couldn't read the current plans. Try again." };

  const fromPlan = existing?.find((r) => r.subcategory_id === fromSubId)?.planned_cents ?? 0;
  const toPlan = existing?.find((r) => r.subcategory_id === toSubId)?.planned_cents ?? 0;

  await supabase.from("budget_plans").upsert(
    [
      { household_id: householdId, month, subcategory_id: fromSubId, planned_cents: Math.max(0, fromPlan - amountCents) },
      { household_id: householdId, month, subcategory_id: toSubId, planned_cents: toPlan + amountCents },
    ],
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return { ok: true };
}

// ---------- Subcategories (the budget rows) ----------

export async function reorderSubcategories(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

  await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("subcategories")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  revalidatePath("/budget");
}

export async function addSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const categoryId = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue ? Math.min(31, Math.max(1, parseInt(rawDue, 10))) : null;
  const isRecurring = formData.get("isRecurring") === "on";

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

  await supabase.from("subcategories").insert({
    household_id: householdId,
    category_id: categoryId,
    name,
    due_day: dueDay,
    sort_order: nextSort,
    is_recurring: isRecurring,
  });

  revalidatePath("/budget");
}

// Flip an existing item's recurring flag. Items created before this feature
// (Internet, Mobile, the paycheck deductions) all start false, so this is the
// only way to opt them in without re-creating them.
export async function setSubcategoryRecurring(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;
  const isRecurring = formData.get("isRecurring") === "on";

  await supabase
    .from("subcategories")
    .update({ is_recurring: isRecurring })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  revalidatePath("/budget");
}

export async function moveSubcategoryToGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const targetCategoryId = String(formData.get("categoryId") ?? "");
  if (!subcategoryId || !targetCategoryId) return { error: "Choose a category group." };

  const subcategory = unwrap(
    await supabase
      .from("subcategories")
      .select("category_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  if (!subcategory || subcategory.category_id === targetCategoryId) return {};

  const categories = unwrap(
    await supabase
      .from("categories")
      .select("id, kind")
      .eq("household_id", householdId)
      .in("id", [subcategory.category_id, targetCategoryId]),
    "categories",
  );
  const kindById = new Map((categories ?? []).map((category) => [category.id, category.kind]));
  if (!kindById.has(targetCategoryId) || kindById.get(subcategory.category_id) !== kindById.get(targetCategoryId)) {
    return { error: "Items can move only between groups of the same type." };
  }

  const last = unwrap(
    await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("household_id", householdId)
      .eq("category_id", targetCategoryId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "subcategories",
  );

  const { error } = await supabase
    .from("subcategories")
    .update({ category_id: targetCategoryId, sort_order: (last?.sort_order ?? -1) + 1 })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);
  if (error?.code === "23505") return { error: "That group already has an item with this name." };
  if (error) return { error: "The item could not be moved." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/insights");
  return {};
}

// Creates one subcategory per non-empty pasted line, skipping names that
// already exist in that category (case-insensitive) — a paste-a-list
// accelerator for entering many items at once instead of one at a time.
export async function addSubcategoriesBulk(
  formData: FormData,
): Promise<{ added: number; skipped: number }> {
  const { supabase, householdId } = await requireHousehold();
  const categoryId = String(formData.get("categoryId") ?? "");
  const raw = String(formData.get("names") ?? "");
  const names = raw
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  if (!categoryId || names.length === 0) return { added: 0, skipped: 0 };

  // This read is the duplicate check. Losing it makes every existing name look
  // new, and the bulk add then inserts a second copy of each one.
  const { data: existing, error: existingError } = await supabase
    .from("subcategories")
    .select("name, sort_order")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false });
  if (existingError) throw new Error(`Could not read existing items: ${existingError.message}`);

  const existingLower = new Set((existing ?? []).map((s) => s.name.toLowerCase()));
  let nextSort = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows: { household_id: string; category_id: string; name: string; sort_order: number }[] = [];
  const seenThisBatch = new Set<string>();
  let skipped = 0;
  for (const name of names) {
    const key = name.toLowerCase();
    if (existingLower.has(key) || seenThisBatch.has(key)) {
      skipped++;
      continue;
    }
    seenThisBatch.add(key);
    rows.push({ household_id: householdId, category_id: categoryId, name, sort_order: nextSort++ });
  }

  if (rows.length > 0) {
    await supabase.from("subcategories").insert(rows);
  }

  revalidatePath("/budget");
  return { added: rows.length, skipped };
}

export async function updateSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  // Accept either "subcategoryId" (preferred — a hidden input named "id" in a
  // React 19 form breaks the form action, see PlannedForm) or "id" for older
  // callers like the inline rename form.
  const id = String(formData.get("subcategoryId") ?? formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));

  const update: { name: string; due_day: number | null; payment_account_id?: string | null; travel_category?: string | null } = { name, due_day: dueDay };
  // Which Travel Log spending row this item's trip-tagged purchases count in.
  // Only the full item form carries it; the inline rename leaves it alone.
  if (formData.has("travelCategory")) {
    const raw = String(formData.get("travelCategory") ?? "").trim();
    update.travel_category = TRAVEL_CATEGORY_KEYS.has(raw) ? raw : null;
  }
  // The small inline rename form does not carry this input. Only change the
  // payment link when the full item form submitted one.
  if (formData.has("paymentAccountId")) {
    const rawPaymentAccountId = String(formData.get("paymentAccountId") ?? "").trim();
    if (!rawPaymentAccountId) {
      update.payment_account_id = null;
    } else {
      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", rawPaymentAccountId)
        .eq("household_id", householdId)
        .in("kind", ["checking", "savings_bucket", "cash", "credit_card"])
        .maybeSingle();
      // Falling back to null here would silently unlink the payment account
      // the user just picked, on what they think is a rename.
      if (accountError) throw new Error(`Could not verify the payment account: ${accountError.message}`);
      update.payment_account_id = account?.id ?? null;
    }
  }

  unwrap(
    await supabase
      .from("subcategories")
      .update(update)
      .eq("id", id)
      .eq("household_id", householdId),
    "saving the budget item",
  );

  // If this subcategory is bound to any active subscriptions, shift each
  // subscription's next_renewal_date to the new day-of-month. Without this
  // sync, the "Due this week" strip and the Subscriptions page keep showing
  // the old due date because they read next_renewal_date, not due_day.
  if (dueDay != null) {
    const subs = unwrap(
      await supabase
        .from("subscriptions")
        .select("id, next_renewal_date")
        .eq("household_id", householdId)
        .eq("subcategory_id", id),
      "subscriptions",
    );
    for (const sub of subs ?? []) {
      if (!sub.next_renewal_date) continue;
      const [y, m] = sub.next_renewal_date.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const day = Math.min(dueDay, lastDay);
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso === sub.next_renewal_date) continue;
      unwrap(
        await supabase
          .from("subscriptions")
          .update({ next_renewal_date: iso, updated_at: new Date().toISOString() })
          .eq("id", sub.id)
          .eq("household_id", householdId),
        "moving the subscription's due date",
      );
    }
  }

  revalidatePath("/budget");
}

export async function deleteSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("subcategories")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/budget");
}

// ---------- Savings & sinking funds (detail panel) ----------

export async function upsertSavingsGoal(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  const goalCents = displayToCents(String(formData.get("goal") ?? "0"));
  const startCents = displayToCents(String(formData.get("start") ?? "0"));
  const monthlyCents = displayToCents(String(formData.get("monthly") ?? "0"));
  const targetDate = String(formData.get("targetDate") ?? "").trim() || null;

  await supabase.from("savings_goals").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      goal_cents: goalCents,
      start_cents: startCents,
      monthly_contribution_cents: monthlyCents,
      target_date: targetDate,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  revalidatePath("/budget");
  revalidatePath("/invest");
}

// Links (or unlinks) a Savings item to a real bucket in Accounts. Once
// linked, transactions logged under this item add straight to the bucket's
// balance — no re-typing the contribution over on Accounts.
export async function updateSavingsLink(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  // The form sends `linkTarget` — a plain UUID for a bucket, or
  // `account:<uuid>` for a bare investment account. Legacy callers may still
  // send `bucketId`; treat it as a bucket UUID.
  const raw = String(
    formData.get("linkTarget") ?? formData.get("bucketId") ?? "",
  ).trim();

  let bucketId: string | null = null;
  let accountId: string | null = null;

  if (raw.startsWith("account:")) {
    const candidate = raw.slice("account:".length);
    // Both branches feed the update below, which writes BOTH columns — so a
    // swallowed error unlinks the savings goal from its bucket/account and the
    // item just stops tracking, with no sign anything went wrong.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", candidate)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  } else if (raw) {
    const { data: bucket, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", raw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    bucketId = bucket?.id ?? null;
  }

  await supabase
    .from("subcategories")
    .update({ linked_bucket_id: bucketId, linked_account_id: accountId })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// Combined save for the Savings panel: goal fields + bucket link in one
// action, so there's a single Save button instead of two.
export async function upsertSavingsGoalAndLink(formData: FormData) {
  await Promise.all([
    upsertSavingsGoal(formData),
    upsertPlan(formData),
    updateSavingsLink(formData),
  ]);
}

// ---------- Debt (detail panel) ----------

export async function upsertDebt(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  const minPaymentCents = displayToCents(String(formData.get("minPayment") ?? "0"));
  const aprRaw = String(formData.get("apr") ?? "").trim();
  const apr = aprRaw === "" ? 0 : parseFloat(aprRaw);
  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));
  const debtKind = String(formData.get("debtKind") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const promoAprEndsOn = String(formData.get("promoAprEndsOn") ?? "").trim() || null;

  // Linked account (only if it belongs to this household).
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  let accountId: string | null = null;
  if (accountIdRaw) {
    // Same reasoning as resolvePayeeId: a failed lookup used to collapse to
    // `null` and write an account-less row. Only a genuine "not in this
    // household" answer is allowed to null it out.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  }

  // `paid_off_at` is stamped/cleared inside saveDebt, so a debt zeroed out here
  // still drops off the Snowball page next year without this action repeating
  // the rule.
  const existing = unwrap(
    await supabase
      .from("debts")
      .select("original_balance_cents")
      .eq("subcategory_id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "debts",
  );
  // Seed the opening balance when the debt is first created here. Debts made
  // from Budget used to leave `original_balance_cents` at 0 forever — only the
  // Accounts editor set it — so Snowball's "principal paid" percentage was
  // measured against a zero baseline and reported progress that never happened.
  // An existing value is preserved: it's the historical opening balance and a
  // later balance edit must not overwrite it.
  const originalBalanceCents =
    existing?.original_balance_cents && existing.original_balance_cents > 0
      ? existing.original_balance_cents
      : balanceCents;

  // Single shared write path (lib/save-debt.ts). Fields this editor doesn't
  // manage — escrow, term, loan start, interest method, target payment — are
  // omitted and therefore preserved, instead of being blanked by a partial
  // upsert as they were before.
  await saveDebt(supabase, householdId, {
    subcategoryId,
    balanceCents,
    minPaymentCents,
    apr: Number.isNaN(apr) ? 0 : apr,
    originalBalanceCents,
    accountId,
    dueDay,
    debtKind,
    notes,
    promoAprEndsOn,
  });

  // Keep subcategories.due_day in sync — the budget row list badge and the
  // Rename form read from there, not from debts.due_day. Without this, the
  // due day set here silently didn't show up anywhere else.
  await supabase
    .from("subcategories")
    .update({ due_day: dueDay })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId, { force: true });
  revalidatePath("/budget");
  // Same debt row Debt/Loans, Accounts, Travel Log and Net Worth read.
  revalidatePath("/snowball");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  revalidatePath("/networth");
}

// Combined save for the Debt panel: planned amount + debt details + optional
// linked bucket in one action, so there's a single Save button. The bucket
// link reuses subcategories.linked_bucket_id — the same column savings goals
// use — so `addTransaction` already routes payments through the right bucket
// via `getLinkedBucketId`.
export async function upsertDebtAndPlan(formData: FormData) {
  await upsertPlan(formData);
  await upsertDebt(formData);
  await updateSavingsLink(formData);
}

// ---------- Transactions (the Log, right rail) ----------

/**
 * Resolve the "which property is this for?" tag to an id we can store.
 *
 * Verified the same way accountId is: only a genuine "not a property of this
 * household" answer nulls it out, so a slow or failing lookup can't silently
 * drop the tag off a row the user did tag.
 */
// The trip a purchase is tagged to, checked to be this household's. Its
// spending then shows on the Travel Log as Actual for the item's travel row.
async function resolveTripTag(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  raw: string,
): Promise<string | null> {
  if (!raw) return null;
  const { data, error } = await supabase
    .from("travel_trips")
    .select("id")
    .eq("id", raw)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify the trip: ${error.message}`);
  return data?.id ?? null;
}

// Everything the transaction modal's trip pickers need, in ONE server call:
// every trip (newest first, with dates so the one covering the transaction's
// date is picked on its own) and each trip's live bookings for "Pays for".
// ALL trips, not just this year's: a purchase tagged to last December's trip
// must still find its trip when edited in January, or saving would untag it
// and drop its booking link. The modal narrows what the dropdown lists. Loaded when the page opens and kept on the client
// (trip-tagging-cache.ts), so the pickers are there the moment the modal is —
// two calls made on open took over a second, since server actions run one at
// a time.
export async function listTripTagging(): Promise<TripTagging> {
  const { supabase, householdId } = await requireHousehold();
  const { data, error } = await supabase
    .from("travel_trips")
    .select("id, name, start_on, end_on")
    .eq("household_id", householdId)
    .order("start_on", { ascending: false, nullsFirst: true });
  if (error) throw new Error(`Could not load the trips: ${error.message}`);
  const trips = (data ?? []).map((t) => ({ id: t.id, name: t.name, startOn: t.start_on ?? null, endOn: t.end_on ?? null }));
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) return { trips, bookingsByTrip: {} };

  const [stays, flights, cars, legs] = await Promise.all([
    supabase.from("travel_stays").select("id, trip_id, property_name, check_in, nights, pocket_cost_cents, is_estimate, cancelled_at, points_cost, points_used, account_id").eq("household_id", householdId).in("trip_id", tripIds).is("cancelled_at", null),
    supabase.from("travel_flights").select("id, trip_id, airline, first_flight_on, pocket_cost_cents, is_estimate, cancelled_at, points_cost, points_used, account_id").eq("household_id", householdId).in("trip_id", tripIds).is("cancelled_at", null),
    supabase.from("travel_cars").select("id, trip_id, company, pickup_on, return_on, pocket_cost_cents, is_estimate, cancelled_at, points_cost, points_used, account_id").eq("household_id", householdId).in("trip_id", tripIds).is("cancelled_at", null),
    supabase.from("travel_flight_legs").select("flight_id, flight_on").eq("household_id", householdId),
  ]);
  const problem = stays.error ?? flights.error ?? cars.error ?? legs.error;
  if (problem) throw new Error(`Could not load the trips' bookings: ${problem.message}`);
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${Number(d)}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}-${y.slice(2)}`;
  };
  const base = (b: { trip_id: string | null; pocket_cost_cents: number | null; is_estimate: boolean | null; points_cost: number | null; points_used: boolean | null; account_id: string | null }) => ({
    tripId: b.trip_id as string,
    pocketCents: Number(b.pocket_cost_cents ?? 0),
    isEstimate: Boolean(b.is_estimate),
    pointsCost: Number(b.points_cost ?? 0),
    pointsUsed: Boolean(b.points_used),
    hasCard: Boolean(b.account_id),
  });
  const rows = [
    ...(stays.data ?? []).map((s) => ({ ref: `stay:${s.id}`, on: s.check_in, label: `Stay · ${s.property_name} · ${day(s.check_in)}`, ...base(s) })),
    ...(flights.data ?? []).map((f) => ({ ref: `flight:${f.id}`, on: f.first_flight_on, label: `Flight · ${f.airline} · ${day(f.first_flight_on)}`, ...base(f) })),
    ...(cars.data ?? []).map((c) => ({ ref: `car:${c.id}`, on: c.pickup_on, label: `Rental · ${c.company ?? "Car"} · ${day(c.pickup_on)}`, ...base(c) })),
  ].sort((a, b) => a.on.localeCompare(b.on));
  const bookingsByTrip: TripTagging["bookingsByTrip"] = {};
  for (const { on: _on, tripId, ...r } of rows) (bookingsByTrip[tripId] ??= []).push(r);

  // A trip with no dates of its own (Barcelona · Oct 2026 has only bookings)
  // takes its bookings' span — the same rule the Travel Log's trip rows use
  // (summarizeTrips) — so a purchase on those days still picks the trip.
  const lastLeg = new Map<string, string>();
  for (const l of legs.data ?? []) {
    if (l.flight_on && l.flight_on > (lastLeg.get(l.flight_id) ?? "")) lastLeg.set(l.flight_id, l.flight_on);
  }
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const span = new Map<string, { from: string; to: string }>();
  const widen = (tripId: string | null, from: string, to: string) => {
    if (!tripId) return;
    const cur = span.get(tripId);
    span.set(tripId, {
      from: cur && cur.from < from ? cur.from : from,
      to: cur && cur.to > to ? cur.to : to,
    });
  };
  for (const s of stays.data ?? []) widen(s.trip_id, s.check_in, addDays(s.check_in, Number(s.nights ?? 0)));
  for (const f of flights.data ?? []) widen(f.trip_id, f.first_flight_on, lastLeg.get(f.id) ?? f.first_flight_on);
  for (const c of cars.data ?? []) widen(c.trip_id, c.pickup_on, c.return_on ?? c.pickup_on);
  const datedTrips = trips.map((t) => {
    const b = span.get(t.id);
    return {
      ...t,
      startOn: t.startOn ?? b?.from ?? null,
      endOn: t.endOn ?? b?.to ?? null,
    };
  });
  return { trips: datedTrips, bookingsByTrip };
}

// ---- "Match purchases": back-tagging a trip's purchases in one go --------
//
// Trip tagging only reached purchases entered after it was built, so every
// trip before it carried hand-typed actuals that never matched the cards. The
// trip popup lists the untagged purchases dated inside the trip and tags the
// ticked ones exactly as the transaction modal would (routeTripPurchase):
// trip spending moves onto the trip items, keeping its Travel Log column.

// Purchases that can be tagged: bills/expenses spending on a travel-type item
// with no savings/investment link, off the kids' accounts, not a transfer, not a
// booking payment and not already on a trip. Changing their budget item never
// moves an account balance (only income flips the ledger's sign).
const TRIP_CANDIDATE_SELECT =
  "id, occurred_on, amount_cents, subcategory_id, paid_to_account_id, is_withdrawal, " +
  "account_id, subcategories(id, category_id, name, linked_bucket_id, linked_account_id, travel_category, receives_trip_plans, categories(kind)), " +
  "payees(name)";
type TripCandidateRow = {
  id: string;
  occurred_on: string;
  amount_cents: number;
  subcategory_id: string | null;
  paid_to_account_id: string | null;
  is_withdrawal: boolean | null;
  account_id: string | null;
  subcategories: (TripRoutableSub & { id: string }) | null;
  payees: { name: string } | null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isTaggableCandidate(t: TripCandidateRow, kidsAccounts: Set<string>): boolean {
  const sub = t.subcategories;
  if (!sub || !t.subcategory_id) return false;
  // Card payments and investment transfers are money moving, not spending;
  // the kids' own money is never family trip spending.
  if (t.paid_to_account_id || t.is_withdrawal) return false;
  if (t.account_id && kidsAccounts.has(t.account_id)) return false;
  if (sub.linked_bucket_id || sub.linked_account_id) return false;
  // Only travel-type items (those with a Travel Log row — Restaurant Travel,
  // Traveling/Trips, Groceries, Fuel, Cash…). Everyday buys that happen to
  // fall on trip days (Hygienes, clothing, school supplies) are not trip
  // spending and never appear — Victor's call, 2026-09-23.
  if (!sub.travel_category) return false;
  const kind = sub.categories?.kind;
  return kind === "bills" || kind === "expenses";
}

async function loadTripCandidates(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  from: string,
  to: string,
  ids?: string[],
): Promise<TripCandidateRow[]> {
  let q = supabase
    .from("transactions")
    .select(TRIP_CANDIDATE_SELECT)
    .eq("household_id", householdId)
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .is("trip_id", null)
    .is("travel_stay_id", null)
    .is("travel_flight_id", null)
    .is("travel_car_id", null)
    .not("subcategory_id", "is", null);
  if (ids) q = q.in("id", ids);
  // Two FKs join transactions to accounts (account_id, paid_to_account_id),
  // so the kids' accounts are read on their own rather than embedded.
  const [rows, kids] = await Promise.all([
    q.order("occurred_on").returns<TripCandidateRow[]>().then((r) => unwrap(r, "trip purchases") ?? []),
    supabase.from("accounts").select("id").eq("household_id", householdId).eq("is_kids_account", true)
      .then((r) => unwrap(r, "kids accounts") ?? []),
  ]);
  const kidsAccounts = new Set(kids.map((a) => a.id as string));
  return rows.filter((t) => isTaggableCandidate(t, kidsAccounts));
}

export async function listTripPurchaseCandidates(
  tripId: string,
  from: string,
  to: string,
): Promise<TripPurchaseCandidate[]> {
  const { supabase, householdId } = await requireHousehold();
  const trip = await resolveTripTag(supabase, householdId, tripId);
  if (!trip || !ISO_DAY.test(from) || !ISO_DAY.test(to)) return [];

  const [rows, stays, flights, cars] = await Promise.all([
    loadTripCandidates(supabase, householdId, from, to),
    supabase.from("travel_stays").select("property_name, brand").eq("household_id", householdId).eq("trip_id", trip).is("cancelled_at", null),
    supabase.from("travel_flights").select("airline").eq("household_id", householdId).eq("trip_id", trip).is("cancelled_at", null),
    supabase.from("travel_cars").select("company").eq("household_id", householdId).eq("trip_id", trip).is("cancelled_at", null),
  ]);
  const problem = stays.error ?? flights.error ?? cars.error;
  if (problem) throw new Error(`Could not load the trip's bookings: ${problem.message}`);

  // A payee sharing a real word (4+ letters) with one of the trip's bookings
  // is most likely that booking's payment — it already counts under Hotels /
  // Flights, so it starts unticked with the booking named beside it.
  // Each booking name with the Travel Log column it already counts under.
  const bookingNames: { name: string; column: "Hotels" | "Flights" | "Rental" }[] = [
    ...(stays.data ?? []).flatMap((s) => [s.property_name, s.brand].map((name) => ({ name, column: "Hotels" as const }))),
    ...(flights.data ?? []).map((f) => ({ name: f.airline, column: "Flights" as const })),
    ...(cars.data ?? []).map((c) => ({ name: c.company, column: "Rental" as const })),
  ].filter((b): b is { name: string; column: "Hotels" | "Flights" | "Rental" } => Boolean(b.name));
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const looksLike = (payee: string | null) => {
    if (!payee) return null;
    const mine = new Set(words(payee));
    return bookingNames.find((b) => words(b.name).some((w) => mine.has(w))) ?? null;
  };

  return rows.map((t) => {
    const sub = t.subcategories!;
    const payee = t.payees?.name ?? null;
    const booking = looksLike(payee);
    return {
      id: t.id,
      date: t.occurred_on,
      amountCents: Number(t.amount_cents),
      payee,
      itemName: sub.name,
      column: sub.travel_category ?? "other",
      // Traveling/Trips itself: the purchase picks its own column.
      catchAll: sub.travel_category === "other",
      looksLike: booking?.name ?? null,
      looksLikeColumn: booking?.column ?? null,
    };
  });
}

export async function tagTripPurchases(
  tripId: string,
  from: string,
  to: string,
  // Each purchase to tag, with the Travel Log column picked for it when it
  // lands on the catch-all trip item (Parking, Public transport…). Ignored
  // for anything the item's own row decides.
  picks: { id: string; column?: string | null }[],
): Promise<{ tagged: number }> {
  const { supabase, householdId } = await requireHousehold();
  const trip = await resolveTripTag(supabase, householdId, tripId);
  if (!trip) throw new Error("That trip no longer exists.");
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) throw new Error("The trip has no dates to match purchases against.");
  const columnOf = new Map(picks.map((p) => [p.id, p.column ?? null]));
  const ids = [...columnOf.keys()].filter(Boolean);
  if (ids.length === 0) return { tagged: 0 };

  // Re-read and re-check on the server: only purchases still untagged, inside
  // the trip's dates and taggable at all are touched, whatever was sent.
  const rows = await loadTripCandidates(supabase, householdId, from, to, ids);
  // Same destination the transaction modal picks (routeTripPurchase).
  const updates = new Map<string, { subcategory_id: string; category_id: string; travel_category: string | null; pre_trip_subcategory_id: string | null; ids: string[] }>();
  for (const t of rows) {
    const sub = t.subcategories!;
    // Reassigned below when the catch-all takes a picked column.
    let target: { subcategoryId: string; sub: TripRoutableSub; forcedCategory: string | null } =
      await routeTripPurchase(supabase, householdId, sub.id, sub, trip, null);
    // On the catch-all item the purchase carries its own column: the one
    // picked in the list, else the routed item's row. "other" is stored as
    // null, same as the transaction modal.
    if (target.sub.travel_category === "other") {
      const picked = columnOf.get(t.id);
      const column = picked && TRAVEL_CATEGORY_KEYS.has(picked) ? picked : target.forcedCategory;
      target = { ...target, forcedCategory: column && column !== "other" ? column : null };
    }
    // Moved off its own item (Groceries -> Traveling/Trips)? Record where it
    // was (transactions.pre_trip_subcategory_id).
    const moved = target.subcategoryId !== sub.id ? sub.id : null;
    const key = `${target.subcategoryId}|${target.forcedCategory ?? ""}|${moved ?? ""}`;
    const cur = updates.get(key) ?? {
      subcategory_id: target.subcategoryId,
      category_id: target.sub.category_id,
      travel_category: target.forcedCategory,
      pre_trip_subcategory_id: moved,
      ids: [],
    };
    cur.ids.push(t.id);
    updates.set(key, cur);
  }

  let tagged = 0;
  for (const u of updates.values()) {
    unwrap(
      await supabase
        .from("transactions")
        .update({
          trip_id: trip,
          subcategory_id: u.subcategory_id,
          category_id: u.category_id,
          travel_category: u.travel_category,
          pre_trip_subcategory_id: u.pre_trip_subcategory_id,
        })
        .eq("household_id", householdId)
        .is("trip_id", null)
        .in("id", u.ids),
      "tagging the purchases",
    );
    tagged += u.ids.length;
  }

  revalidatePath("/travel");
  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/annual");
  revalidatePath("/insights");
  return { tagged };
}

// A payment linked to a booking sets that booking's pocket cost and marks it
// Booked; the balance of the card follows through the reward ledger.
async function syncBookings(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  // Points typed on the form go onto the LAST ref (the booking being paid).
  pointsTyped: number | null,
  ...refs: Array<BookingRef | null>
): Promise<string | null> {
  const seen = new Set<string>();
  const problems: string[] = [];
  const target = refs[refs.length - 1];
  // Compared by id, not identity: on an edit the "before" and "after" refs
  // are usually the same booking read twice.
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  for (const ref of refs) {
    const key = `${ref?.kind}:${ref?.id}`;
    if (!ref || seen.has(key)) continue;
    seen.add(key);
    const problem = await syncBookingPayment(supabase, householdId, ref, key === targetKey ? pointsTyped : null);
    if (problem) {
      console.error("[syncBookingPayment]", problem);
      problems.push(problem);
    }
  }
  revalidatePath("/travel");
  // The payment itself is saved by now; this is only what the booking
  // couldn't take, for the form to show.
  return problems.length ? problems.join(" ") : null;
}

async function resolvePropertyId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  raw: string,
): Promise<string | null> {
  if (!raw) return null;
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", raw)
    .eq("household_id", householdId)
    .eq("kind", "property")
    .maybeSingle();
  if (error) throw new Error(`Could not verify the property: ${error.message}`);
  return data?.id ?? null;
}

type SaveOutcome = { bookingWarning: string | null; balancesMoved: boolean; touchedDebt: boolean };

// One transaction written with all its side effects (bucket, debt, account
// ledger, booking) — everything except re-taking the snapshot and
// revalidating pages, which the caller does once for the whole save. A split
// runs this once per part. Null when the form is missing a required field.
async function insertTransactionCore(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  formData: FormData,
  splitGroupId: string | null,
): Promise<SaveOutcome | null> {
  const pickedSubId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const enteredCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const propertyIdRaw = String(formData.get("propertyId") ?? "").trim();
  const tripIdRaw = String(formData.get("tripId") ?? "").trim();
  const bookingRefRaw = String(formData.get("bookingRef") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  const isRefund = formData.get("isRefund") === "on";
  const cleared = formData.get("cleared") === "on";
  if (!pickedSubId || !occurredOn || enteredCents <= 0) return null;
  // Refund posts as a negative amount on the same subcategory + account.
  // Everything downstream — v_monthly_actuals (sums), account ledger
  // (via ledgerDelta which multiplies by ±1 per kind), Annual Overview,
  // Insights — handles the sign naturally, so no other code has to know.
  const amountCents = isRefund ? -enteredCents : enteredCents;

  // Every lookup the insert needs, fired at once. None depends on another
  // (only the booking waits on its trip), and each is a round trip to a
  // database an ocean away — run one after another they were most of the
  // wait on Add / Clear. Every one still throws on a failed read.
  const [pickedSub, tripAndBooking, payeeId, accountId, propertyId] = await Promise.all([
    // Every subcategory field the rest of this action needs, in ONE query —
    // the linked bucket/account ids and the category's kind (via FK join).
    supabase
      .from("subcategories")
      .select(TRIP_SUB_SELECT)
      .eq("id", pickedSubId)
      .eq("household_id", householdId)
      .maybeSingle<TripRoutableSub>()
      .then((r) => unwrap(r, "subcategories")),
    resolveTripTag(supabase, householdId, tripIdRaw).then(async (tripId) => ({
      tripId,
      booking: await resolveBookingRef(supabase, householdId, bookingRefRaw, tripId),
    })),
    // Case-insensitive: "aldi" reuses the existing "Aldi" rather than creating
    // a second payee that then splits the shop's totals on the Annual Overview.
    payeeName ? resolvePayeeId(supabase, householdId, payeeName) : Promise.resolve(null),
    // Only attach the account if it belongs to this household. A failed
    // lookup throws rather than writing an account-less row; only a genuine
    // "not in this household" answer nulls it out.
    accountIdRaw
      ? supabase
          .from("accounts")
          .select("id")
          .eq("id", accountIdRaw)
          .eq("household_id", householdId)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw new Error(`Could not verify the account: ${error.message}`);
            return (data?.id as string | undefined) ?? null;
          })
      : Promise.resolve(null),
    resolvePropertyId(supabase, householdId, propertyIdRaw),
  ]);
  if (!pickedSub) return null;
  const { tripId, booking } = tripAndBooking;
  const routed = await routeTripPurchase(supabase, householdId, pickedSubId, pickedSub, tripId, booking);
  const subcategoryId = routed.subcategoryId;
  const sub = routed.sub;

  // Choosing the shared Irregular Bills budget item is intentionally enough to
  // start tracking a one-off bill. The entered payee becomes a managed detail
  // row automatically, while its transaction still posts to the single Bills
  // subcategory that Budget and Annual Overview already use.
  if (sub.name.toLowerCase() === "irregular bills" && payeeName) {
    const existingBill = unwrap(
      await supabase
        .from("irregular_bills")
        .select("id")
        .eq("household_id", householdId)
        .eq("subcategory_id", subcategoryId)
        .ilike("name", payeeName)
        .maybeSingle(),
      "irregular_bills",
    );
    if (!existingBill) {
      const lastBill = unwrap(
        await supabase
          .from("irregular_bills")
          .select("sort_order")
          .eq("household_id", householdId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "irregular_bills",
      );
      await supabase.from("irregular_bills").insert({
        household_id: householdId,
        name: payeeName,
        typical_amount_cents: amountCents,
        subcategory_id: subcategoryId,
        account_id: accountId,
        sort_order: (lastBill?.sort_order ?? 0) + 1,
      });
    }
  }

  // Optional direct bucket attribution (investment sub-accounts like
  // Fidelity → Roth IRA Vic). Only valid when the bucket belongs to the
  // account we just verified. Distinct from the subcategory.linked_bucket_id
  // path used by savings goals below.
  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    directBucketId = b?.id ?? null;
  }

  unwrap(await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    category_id: sub.category_id,
    subcategory_id: subcategoryId,
    payee_id: payeeId,
    account_id: accountId,
    bucket_id: directBucketId,
    property_id: propertyId,
    trip_id: tripId,
    ...bookingColumns(booking),
    travel_category: routed.forcedCategory ?? travelCategoryOf(formData, sub.travel_category, tripId, booking),
    // The item it was picked on, when a trip tag moved it (Groceries ->
    // Traveling/Trips) — a record of where it came from.
    pre_trip_subcategory_id: routed.subcategoryId !== pickedSubId ? pickedSubId : null,
    memo,
    is_withdrawal: isWithdrawal,
    cleared,
    source: "manual",
    split_group_id: splitGroupId,
  }), "saving the transaction");
  const bookingWarning = booking ? await syncBookings(supabase, householdId, bookingPointsOf(formData), booking) : null;

  // A contribution adds to the linked bucket; a withdrawal (e.g. using the
  // Real Estate bucket for a down payment) subtracts from it instead. All
  // of these ids come from the enriched sub select above — no extra queries.
  // Refunds are skipped: they only affect the source account + monthly
  // spend actuals; touching a savings bucket or a debt principal on a refund
  // would double-count.
  // Any balance moved below means this month's snapshot is re-taken — once, at
  // the end, after every balance has moved (it reads them all fresh).
  let balancesMoved = false;
  const bucketId = sub.linked_bucket_id;
  if (!isRefund && bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    balancesMoved = true;
  }

  // Direct-bucket attribution (investment sub-account). adjustBucketBalance
  // also rolls the parent account total via syncAccountFromBuckets.
  if (!isRefund && directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    balancesMoved = true;
  }

  // Bare investment account link (TSP, M1, …) — contribution posts straight
  // to the account balance. Only fires when there's no linked bucket.
  if (!isRefund && !bucketId && sub.linked_account_id) {
    await adjustLinkedAccountBalance(supabase, householdId, sub.linked_account_id, isWithdrawal ? -amountCents : amountCents);
    balancesMoved = true;
  }

  // A payment logged against a debt lowers its outstanding balance, and the
  // chosen account's running ledger moves (income adds, everything else
  // spends out — skipped for investment/bucketed accounts, which stay
  // manual). Different tables, so the two run side by side.
  const [touchedDebt, touchedLedger] = await Promise.all([
    !isRefund ? adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents) : Promise.resolve(false),
    accountId
      ? adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(sub.categories?.kind ?? null, amountCents))
      : Promise.resolve(false),
  ]);
  return { bookingWarning, balancesMoved: balancesMoved || touchedLedger, touchedDebt };
}

// After one or more inserts: re-take this month's snapshot once if any
// balance moved (it reads every balance fresh), and revalidate once.
async function finishTransactionSave(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  outcomes: SaveOutcome[],
) {
  const touchedDebt = outcomes.some((o) => o.touchedDebt);
  if (touchedDebt) revalidatePath("/snowball");
  if (touchedDebt || outcomes.some((o) => o.balancesMoved)) {
    await captureSnapshots(supabase, householdId, { force: true });
  }
  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  revalidatePath("/networth");
  revalidatePath("/annual");
  revalidatePath("/insights");
  revalidatePath("/invest");
  const warnings = outcomes.map((o) => o.bookingWarning).filter((w): w is string => Boolean(w));
  return warnings.length ? { warning: warnings.join(" ") } : undefined;
}

export async function addTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const outcome = await insertTransactionCore(supabase, householdId, formData, null);
  if (!outcome) return;
  return finishTransactionSave(supabase, householdId, [outcome]);
}

// The parts of a split, as the modal sends them: JSON in "splits",
// [{ subcategoryId, amountCents }]. Everything else on the form is shared.
function splitPartsOf(formData: FormData): { subcategoryId: string; amountCents: number }[] {
  try {
    const raw = JSON.parse(String(formData.get("splits") ?? "[]"));
    return Array.isArray(raw)
      ? raw
          .map((p) => ({ subcategoryId: String(p?.subcategoryId ?? ""), amountCents: Math.trunc(Number(p?.amountCents)) }))
          .filter((p) => p.subcategoryId && Number.isFinite(p.amountCents) && p.amountCents > 0)
      : [];
  } catch {
    return [];
  }
}

// Write each part as its own transaction under one split_group_id, in ONE
// server call — one sign-in check, one snapshot, one page refresh — where the
// modal used to send a full save per part. Parts go one after another, not
// side by side: they usually share an account, and each moves its balance.
async function insertSplitParts(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  formData: FormData,
  parts: { subcategoryId: string; amountCents: number }[],
  splitGroupId: string | null,
): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  for (const [i, part] of parts.entries()) {
    const fd = new FormData();
    formData.forEach((v, k) => {
      if (k !== "id" && k !== "subcategoryId" && k !== "amount" && k !== "splits") fd.append(k, v);
    });
    fd.set("subcategoryId", part.subcategoryId);
    fd.set("amount", (part.amountCents / 100).toFixed(2));
    try {
      const outcome = await insertTransactionCore(supabase, householdId, fd, splitGroupId);
      if (outcome) outcomes.push(outcome);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(i > 0 ? `Saved ${i} of ${parts.length} split items, then failed — ${detail}` : detail);
    }
  }
  return outcomes;
}

export async function addSplitTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const parts = splitPartsOf(formData);
  if (parts.length === 0) return;
  const outcomes = await insertSplitParts(supabase, householdId, formData, parts, parts.length > 1 ? crypto.randomUUID() : null);
  return finishTransactionSave(supabase, householdId, outcomes);
}

// Editing a split (or splitting a plain transaction): every existing part is
// deleted the normal way — so each one's balances are put back — and the parts
// on the form are written fresh. A split kept as a split keeps its group id.
export async function replaceWithSplit(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const parts = splitPartsOf(formData);
  if (!id || parts.length === 0) return;
  const ids = await splitGroupIdsOf(supabase, householdId, id);
  const existing = unwrap(
    await supabase.from("transactions").select("split_group_id, cleared").eq("id", id).eq("household_id", householdId).maybeSingle(),
    "transactions",
  );
  const existingGroup = (existing?.split_group_id as string | null | undefined) ?? null;
  // The edit form has no Cleared field; a cleared purchase stays cleared.
  if (existing?.cleared && !formData.get("cleared")) formData.set("cleared", "on");
  const removed: DeleteOutcome[] = [];
  for (const rowId of ids) {
    const result = await deleteSingleTransaction(supabase, householdId, rowId);
    if ("error" in result) return { warning: result.error };
    removed.push(result);
  }
  const groupId = parts.length > 1 ? existingGroup ?? crypto.randomUUID() : null;
  const outcomes = await insertSplitParts(supabase, householdId, formData, parts, groupId);
  // One snapshot and one refresh for the removals and the new parts together.
  return finishTransactionSave(supabase, householdId, [...outcomes, ...removed.map((r) => ({ ...r, bookingWarning: null }))]);
}

// Every row of the split this transaction belongs to — or just itself.
async function splitGroupIdsOf(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  id: string,
): Promise<string[]> {
  const row = unwrap(
    await supabase.from("transactions").select("split_group_id").eq("id", id).eq("household_id", householdId).maybeSingle(),
    "transactions",
  );
  if (!row?.split_group_id) return [id];
  const rows = unwrap(
    await supabase.from("transactions").select("id").eq("household_id", householdId).eq("split_group_id", row.split_group_id),
    "split transactions",
  ) ?? [];
  return rows.length ? rows.map((r) => r.id as string) : [id];
}

export async function updateTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const pickedSubId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const enteredCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const propertyIdRaw = String(formData.get("propertyId") ?? "").trim();
  const tripIdRaw = String(formData.get("tripId") ?? "").trim();
  const bookingRefRaw = String(formData.get("bookingRef") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  const isRefund = formData.get("isRefund") === "on";
  if (!id || !pickedSubId || !occurredOn || enteredCents <= 0) return;
  // Refund posts as negative on the same sub/account; toggling the pill
  // off restores a positive spend. Bucket/debt side-effects are skipped in
  // both directions so we never double-count.
  const amountCents = isRefund ? -enteredCents : enteredCents;

  // Snapshot the pre-edit values so we can undo their bucket effect below —
  // the old subcategory/amount/direction may differ from the new ones. Pull
  // the linked bucket/account ids for the OLD subcategory in the same round
  // trip via FK join, so the undo path doesn't need extra lookups.
  const prevTx = unwrap(
    await supabase
      .from("transactions")
      .select(
        "subcategory_id, category_id, account_id, bucket_id, amount_cents, is_withdrawal, subcategories(linked_bucket_id, linked_account_id), categories(kind)",
      )
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle<{
        subcategory_id: string;
        category_id: string;
        account_id: string | null;
        bucket_id: string | null;
        amount_cents: number;
        is_withdrawal: boolean;
        subcategories: { linked_bucket_id: string | null; linked_account_id: string | null } | null;
        categories: { kind: string } | null;
      }>(),
    "transactions",
  );

  // New subcategory's category + link ids + kind, all in one query. The rest
  // of this action reads these fields from memory instead of firing three
  // more sequential lookups (getLinkedBucketId, getLinkedAccountId,
  // categoryKindOf) as it used to — the biggest source of save latency.
  const pickedSub = unwrap(
    await supabase
      .from("subcategories")
      .select(TRIP_SUB_SELECT)
      .eq("id", pickedSubId)
      .eq("household_id", householdId)
      .maybeSingle<TripRoutableSub>(),
    "subcategories",
  );
  if (!pickedSub) return;
  const tripId = await resolveTripTag(supabase, householdId, tripIdRaw);
  const booking = await resolveBookingRef(supabase, householdId, bookingRefRaw, tripId);
  const routed = await routeTripPurchase(supabase, householdId, pickedSubId, pickedSub, tripId, booking);
  const subcategoryId = routed.subcategoryId;
  const sub = routed.sub;
  const prevLinkedBucketId = prevTx?.subcategories?.linked_bucket_id ?? null;
  const prevLinkedAccountId = prevTx?.subcategories?.linked_account_id ?? null;
  const prevKind = prevTx?.categories?.kind ?? null;
  // A previous refund was stored as a negative amount, and we deliberately
  // never wrote to its bucket or debt at add time (see addTransaction). Skip
  // the undo of those side effects here so we don't credit balances that
  // were never debited.
  const wasRefund = (prevTx?.amount_cents ?? 0) < 0;

  // Case-insensitive: "aldi" reuses the existing "Aldi" rather than creating a
  // second payee that then splits the shop's totals on the Annual Overview.
  const payeeId = payeeName ? await resolvePayeeId(supabase, householdId, payeeName) : null;

  let accountId: string | null = null;
  if (accountIdRaw) {
    // Same reasoning as resolvePayeeId: a failed lookup used to collapse to
    // `null` and write an account-less row. Only a genuine "not in this
    // household" answer is allowed to null it out.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  }

  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    directBucketId = b?.id ?? null;
  }

  // The booking this payment was on before, so an unlinked or moved payment
  // is taken back off it.
  const prevBooking = bookingRefOf(
    unwrap(
      await supabase
        .from("transactions")
        .select("travel_stay_id, travel_flight_id, travel_car_id")
        .eq("id", id)
        .eq("household_id", householdId)
        .maybeSingle(),
      "transactions",
    ) ?? {},
  );
  unwrap(await supabase
    .from("transactions")
    .update({
      occurred_on: occurredOn,
      amount_cents: amountCents,
      category_id: sub.category_id,
      subcategory_id: subcategoryId,
      payee_id: payeeId,
      account_id: accountId,
      bucket_id: directBucketId,
      property_id: await resolvePropertyId(supabase, householdId, propertyIdRaw),
      trip_id: tripId,
      ...bookingColumns(booking),
      travel_category: routed.forcedCategory ?? travelCategoryOf(formData, sub.travel_category, tripId, booking),
      // See the insert path: remembers the item a trip tag moved it off. An
      // edit that keeps the trip without moving it again (fixing the amount
      // of the Commissary run already on Traveling/Trips) must not forget
      // where it came from, so the field is left alone then; dropping the
      // trip clears it.
      ...(routed.subcategoryId !== pickedSubId
        ? { pre_trip_subcategory_id: pickedSubId }
        : tripId
          ? {}
          : { pre_trip_subcategory_id: null }),
      memo,
      is_withdrawal: isWithdrawal,
    })
    .eq("id", id)
    .eq("household_id", householdId), "saving the transaction");
  const bookingWarning = prevBooking || booking
    ? await syncBookings(supabase, householdId, booking ? bookingPointsOf(formData) : null, prevBooking, booking)
    : null;

  // Undo the old transaction's bucket effect (it may have hit a different
  // bucket, or none at all), then apply the new one's. All linked-id lookups
  // come from the enriched selects above — no extra round trips. Refunds
  // (both the previous and new sides) skip bucket/debt writes entirely.
  let touchedBucket = false;
  if (prevTx && !wasRefund) {
    if (prevLinkedBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevLinkedBucketId, undoDelta);
      touchedBucket = true;
    }
    // Undo previous direct-bucket attribution (investment sub-account).
    if (prevTx.bucket_id && prevTx.bucket_id !== prevLinkedBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevTx.bucket_id, undoDelta);
      touchedBucket = true;
    }
  }
  const bucketId = sub.linked_bucket_id;
  if (!isRefund && bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  // Apply new direct-bucket attribution.
  if (!isRefund && directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }

  // Bare-account link (TSP/M1/…) — same undo-then-reapply pattern. Only
  // fires on the leg where there's no linked bucket for that sub.
  if (prevTx && !wasRefund && !prevLinkedBucketId && prevLinkedAccountId) {
    const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
    await adjustLinkedAccountBalance(supabase, householdId, prevLinkedAccountId, undoDelta);
    touchedBucket = true;
  }
  if (!isRefund && !bucketId && sub.linked_account_id) {
    await adjustLinkedAccountBalance(supabase, householdId, sub.linked_account_id, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  if (touchedBucket) await captureSnapshots(supabase, householdId, { force: true });

  // Undo the old payment's effect on its debt balance, then apply the new one's
  // — the edit may have changed the amount or moved it off/onto a debt entirely.
  // Skip both sides when refund is involved: refunds never wrote to a debt
  // principal, and reversing that non-write would credit the debt in error.
  let touchedDebt = false;
  if (prevTx && !wasRefund) {
    touchedDebt = await adjustDebtBalance(supabase, householdId, prevTx.subcategory_id, prevTx.amount_cents);
  }
  if (!isRefund) {
    if (await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents)) touchedDebt = true;
  }
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/snowball");
  }

  // Undo the old posting to its account (may be a different account than the
  // new one, or none), then post the new one. Both category kinds come from
  // the enriched selects above — no per-post categoryKindOf query.
  let touchedAccount = false;
  if (prevTx?.account_id) {
    if (await adjustAccountLedger(supabase, householdId, prevTx.account_id, -ledgerDelta(prevKind, prevTx.amount_cents))) {
      touchedAccount = true;
    }
  }
  if (accountId) {
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(sub.categories?.kind ?? null, amountCents))) {
      touchedAccount = true;
    }
  }
  if (touchedAccount) await captureSnapshots(supabase, householdId, { force: true });

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  revalidatePath("/networth");
  revalidatePath("/annual");
  revalidatePath("/insights");
  revalidatePath("/invest");
  return bookingWarning ? { warning: bookingWarning } : undefined;
}

// Lightweight inline edit used by the transaction register. It changes only
// the amount while preserving the same ledger, bucket, and debt side effects
// as the full transaction editor.
export async function updateTransactionAmount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (!id || amountCents <= 0) return;

  const tx = unwrap(
    await supabase
      .from("transactions")
      .select("occurred_on, amount_cents, memo, subcategory_id, category_id, account_id, bucket_id, paid_to_account_id, paid_to_bucket_id, movement_type, is_withdrawal")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "transactions",
  );
  if (!tx || tx.amount_cents === amountCents) return;

  if (tx.movement_type === "account_transfer") {
    const { error } = await supabase.rpc("mutate_account_transfer", {
      p_action: "update",
      p_transaction_id: id,
      p_occurred_on: tx.occurred_on,
      p_amount_cents: amountCents,
      p_from_account_id: tx.account_id,
      p_to_account_id: tx.paid_to_account_id,
      p_from_bucket_id: tx.bucket_id,
      p_to_bucket_id: tx.paid_to_bucket_id,
      p_memo: tx.memo,
    });
    if (!error) await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/budget");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/travel");
    revalidatePath("/networth");
    return;
  }

  const deltaCents = amountCents - tx.amount_cents;
  await supabase
    .from("transactions")
    .update({ amount_cents: amountCents })
    .eq("id", id)
    .eq("household_id", householdId);

  const signedDelta = tx.is_withdrawal ? -deltaCents : deltaCents;
  let touchedSnapshot = false;
  if (tx.subcategory_id) {
    const linkedBucketId = await getLinkedBucketId(supabase, householdId, tx.subcategory_id);
    if (linkedBucketId) {
      await adjustBucketBalance(supabase, householdId, linkedBucketId, signedDelta);
      touchedSnapshot = true;
    }
    if (tx.bucket_id && tx.bucket_id !== linkedBucketId) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, signedDelta);
      touchedSnapshot = true;
    }
    if (!linkedBucketId) {
      const linkedAccountId = await getLinkedAccountId(supabase, householdId, tx.subcategory_id);
      if (linkedAccountId) {
        await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, signedDelta);
        touchedSnapshot = true;
      }
    }
    if (await adjustDebtBalance(supabase, householdId, tx.subcategory_id, -deltaCents)) {
      touchedSnapshot = true;
      revalidatePath("/snowball");
    }
  }
  if (tx.account_id) {
    const kind = tx.category_id ? await categoryKindOf(supabase, tx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, tx.account_id, ledgerDelta(kind, deltaCents))) {
      touchedSnapshot = true;
    }
  }
  if (touchedSnapshot) await captureSnapshots(supabase, householdId, { force: true });

  // A changed amount changes what the linked booking has been paid.
  const linked = bookingRefOf(
    unwrap(
      await supabase
        .from("transactions")
        .select("travel_stay_id, travel_flight_id, travel_car_id")
        .eq("id", id)
        .eq("household_id", householdId)
        .maybeSingle(),
      "transactions",
    ) ?? {},
  );
  if (linked) await syncBookings(supabase, householdId, null, linked);

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  revalidatePath("/networth");
  revalidatePath("/annual");
  revalidatePath("/insights");
  revalidatePath("/invest");
}

/**
 * Undo the balance side effects of a movement row (a transaction with a
 * `paid_to_account_id`: card payment or investment transfer), then delete it.
 *
 * Account transfers are NOT handled here — they have their own RPC that moves
 * both legs inside one database transaction.
 *
 * This exists because the generic delete path below only knows about
 * `account_id`; it never touches `paid_to_account_id`. Deleting a card payment
 * or an investment transfer through it left the destination leg untouched —
 * the money came back to the source account and *also* stayed on the card /
 * in the destination bank, quietly inventing cash. Worse, for a bucketed
 * source it re-applied the debit instead of reversing it, because
 * `is_withdrawal` is false on a card payment.
 */
async function reverseMovementTransaction(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  tx: {
    id: string;
    amount_cents: number;
    account_id: string | null;
    bucket_id: string | null;
    paid_to_account_id: string | null;
    movement_type: string | null;
  },
) {
  const amount = tx.amount_cents;

  if (tx.movement_type === "card_payment") {
    // payCard debited the source (bucket when the source has buckets, else the
    // account ledger) — give it back.
    if (tx.bucket_id) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, amount);
    } else if (tx.account_id) {
      await adjustAccountLedger(supabase, householdId, tx.account_id, amount);
    }
    // payCard also paid down any debt tracked against the card. Deleting the
    // payment puts that balance back on the debt.
    if (tx.paid_to_account_id) {
      const linkedDebt = unwrap(
        await supabase
          .from("debts")
          .select("subcategory_id")
          .eq("household_id", householdId)
          .eq("account_id", tx.paid_to_account_id)
          .maybeSingle(),
        "debts",
      );
      if (linkedDebt?.subcategory_id) {
        await adjustDebtBalance(supabase, householdId, linkedDebt.subcategory_id, amount);
      }
    }
    // The card's "owed" tally is derived from the payment rows themselves, so
    // deleting the row below is all the card side needs.
  } else if (tx.movement_type === "investment_transfer") {
    // Investment side was decremented on create. adjustAccountLedger refuses
    // investment accounts by design (their balances are hand-reconciled), so
    // a bare investment account is written directly here.
    if (tx.bucket_id) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, amount);
    } else if (tx.account_id) {
      // Read-modify-write on a real balance: a lost read would persist
      // `0 + amount` over the account's actual balance.
      const { data: source, error: sourceError } = await supabase
        .from("accounts")
        .select("current_balance_cents")
        .eq("id", tx.account_id)
        .eq("household_id", householdId)
        .maybeSingle();
      if (sourceError) throw new Error(`Could not read the source account: ${sourceError.message}`);
      await supabase
        .from("accounts")
        .update({
          current_balance_cents: (source?.current_balance_cents ?? 0) + amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.account_id)
        .eq("household_id", householdId);
    }
    // Destination banking account was incremented on create — take it back.
    if (tx.paid_to_account_id) {
      const { data: dest, error: destError } = await supabase
        .from("accounts")
        .select("current_balance_cents")
        .eq("id", tx.paid_to_account_id)
        .eq("household_id", householdId)
        .maybeSingle();
      if (destError) throw new Error(`Could not read the destination account: ${destError.message}`);
      await supabase
        .from("accounts")
        .update({
          current_balance_cents: (dest?.current_balance_cents ?? 0) - amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.paid_to_account_id)
        .eq("household_id", householdId);
    }
  }

  await supabase.from("transactions").delete().eq("id", tx.id).eq("household_id", householdId);
  await captureSnapshots(supabase, householdId, { force: true });
}

// Deleting any part of a split deletes the whole purchase — from the modal
// and from a row's trash icon alike. Each row is removed the normal way, so
// its balances are put back.
export async function deleteTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const outcomes: DeleteOutcome[] = [];
  for (const rowId of await splitGroupIdsOf(supabase, householdId, id)) {
    const result = await deleteSingleTransaction(supabase, householdId, rowId);
    if ("error" in result) return { error: result.error };
    outcomes.push(result);
  }
  await finishTransactionDelete(supabase, householdId, outcomes);
}

type DeleteOutcome = { balancesMoved: boolean; touchedDebt: boolean };

// After one or more deletes: one snapshot if any balance moved, one refresh.
async function finishTransactionDelete(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  outcomes: DeleteOutcome[],
) {
  if (outcomes.some((o) => o.touchedDebt)) revalidatePath("/snowball");
  if (outcomes.some((o) => o.balancesMoved || o.touchedDebt)) {
    await captureSnapshots(supabase, householdId, { force: true });
  }
  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  revalidatePath("/networth");
  revalidatePath("/annual");
  revalidatePath("/insights");
  revalidatePath("/invest");
}

// One row removed with every balance it moved put back. Transfers and card
// payments settle their own snapshot; an ordinary row reports what it moved
// so the caller re-takes the snapshot once for the whole delete.
async function deleteSingleTransaction(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  id: string,
): Promise<DeleteOutcome | { error: string }> {
  // The row with its item's links and its category's kind in ONE query —
  // they used to be three more lookups after it, one after another.
  const tx = unwrap(
    await supabase
      .from("transactions")
      .select("subcategory_id, category_id, account_id, bucket_id, paid_to_account_id, amount_cents, is_withdrawal, movement_type, travel_stay_id, travel_flight_id, travel_car_id, subcategories(linked_bucket_id, linked_account_id), categories(kind)")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle<{
        subcategory_id: string | null; category_id: string | null; account_id: string | null; bucket_id: string | null;
        paid_to_account_id: string | null; amount_cents: number; is_withdrawal: boolean | null; movement_type: string | null;
        travel_stay_id: string | null; travel_flight_id: string | null; travel_car_id: string | null;
        subcategories: { linked_bucket_id: string | null; linked_account_id: string | null } | null;
        categories: { kind: string } | null;
      }>(),
    "transactions",
  );
  const none: DeleteOutcome = { balancesMoved: false, touchedDebt: false };
  const deletedBooking = tx ? bookingRefOf(tx) : null;

  if (tx?.movement_type === "account_transfer") {
    const { error } = await supabase.rpc("mutate_account_transfer", {
      p_action: "delete",
      p_transaction_id: id,
      p_occurred_on: null,
      p_amount_cents: null,
      p_from_account_id: null,
      p_to_account_id: null,
      p_from_bucket_id: null,
      p_to_bucket_id: null,
      p_memo: null,
    });
    // A failed reversal must not look like a success: the RPC leaves the row
    // in place when it throws, so silently returning here showed the user a
    // transfer that "wouldn't delete" with no reason given.
    if (error) return { error: error.message || "Couldn't delete that transfer — please try again." };
    return { balancesMoved: true, touchedDebt: false };
  }

  // Card payments and investment transfers also carry a destination leg. They
  // must not fall through to the generic path below, which only reverses
  // `account_id` and would leave the destination holding money that no longer
  // has a transaction behind it.
  if (tx?.paid_to_account_id) {
    await reverseMovementTransaction(supabase, householdId, { ...tx, id });
    return { balancesMoved: false, touchedDebt: true };
  }
  if (!tx) return none;

  await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  let balancesMoved = false;
  const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
  const linkedBucketId = tx.subcategory_id ? tx.subcategories?.linked_bucket_id ?? null : null;
  if (linkedBucketId) {
    await adjustBucketBalance(supabase, householdId, linkedBucketId, undoDelta);
    balancesMoved = true;
  } else if (tx.subcategory_id && tx.subcategories?.linked_account_id) {
    // No bucket, but maybe a bare-account link — undo that too.
    await adjustLinkedAccountBalance(supabase, householdId, tx.subcategories.linked_account_id, undoDelta);
    balancesMoved = true;
  }

  // Undo direct-bucket attribution (investment sub-account) — skip if this
  // was the same bucket the savings-linked path already reversed.
  if (tx.bucket_id && tx.bucket_id !== linkedBucketId) {
    await adjustBucketBalance(supabase, householdId, tx.bucket_id, undoDelta);
    balancesMoved = true;
  }

  // A deleted debt payment adds its amount back to the outstanding balance,
  // and the account's ledger is put back. Different tables, side by side.
  const [touchedDebt, touchedLedger] = await Promise.all([
    tx.subcategory_id ? adjustDebtBalance(supabase, householdId, tx.subcategory_id, tx.amount_cents) : Promise.resolve(false),
    tx.account_id
      ? adjustAccountLedger(supabase, householdId, tx.account_id, -ledgerDelta(tx.categories?.kind ?? null, tx.amount_cents))
      : Promise.resolve(false),
  ]);

  // The booking this payment was on now adds up without it.
  if (deletedBooking) await syncBookings(supabase, householdId, null, deletedBooking);

  return { balancesMoved: balancesMoved || touchedLedger, touchedDebt };
}

export async function deleteTransactions(ids: string[]) {
  if (!ids.length) return;
  for (const id of ids) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteTransaction(fd);
  }
}

// The Log tab's Clear column: checked = verified against the bank/card app.
export async function toggleCleared(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Clear / Unclear covers the whole purchase when it's a split.
  const ids = await splitGroupIdsOf(supabase, householdId, id);
  await supabase
    .from("transactions")
    .update({ cleared: formData.get("cleared") === "true" })
    .in("id", ids)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
}

// ---------- Snowball extra periods (time-varying extra) ----------

// A date input gives YYYY-MM-DD; snap to first-of-month.
function toFirstOfMonth(value: string): string | null {
  const v = value.trim();
  if (!/^\d{4}-\d{2}/.test(v)) return null;
  return `${v.slice(0, 7)}-01`;
}

export async function addSnowballPeriod(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const start = toFirstOfMonth(String(formData.get("startMonth") ?? ""));
  const end = toFirstOfMonth(String(formData.get("endMonth") ?? ""));
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (!start) return;

  await supabase.from("snowball_extra_periods").insert({
    household_id: householdId,
    start_month: start,
    end_month: end,
    amount_cents: amountCents,
  });

  revalidatePath("/snowball");
}

export async function deleteSnowballPeriod(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("snowball_extra_periods")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/snowball");
}

// ---------- Household globals (settings popover) ----------

export async function updateGlobals(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const currency = String(formData.get("currency") ?? "$").trim() || "$";
  const snowballStart = String(formData.get("snowballStartDate") ?? "").trim() || null;
  const snowballExtra = displayToCents(String(formData.get("snowballMonthlyExtra") ?? "0"));

  await supabase
    .from("households")
    .update({
      currency,
      snowball_start_date: snowballStart,
      snowball_monthly_extra_cents: snowballExtra,
    })
    .eq("id", householdId);

  revalidatePath("/budget");
  revalidatePath("/snowball");
}

// ---------- Rollover (carry a month's leftover cash into the next) ----------

export async function deletePayee(id: string) {
  const { supabase, householdId } = await requireHousehold();
  await supabase.from("payees").delete().eq("id", id).eq("household_id", householdId);
  revalidatePath("/budget");
}

// Bulk-copy every planned amount from the previous month into the given month.
// Overwrites existing plans for that month so a re-click stays idempotent
// against last month's numbers.
export async function copyPlansFromPreviousMonth(
  formData: FormData,
): Promise<{ snapshot: Array<{ subcategory_id: string; planned_cents: number | null }>; touchedSubIds: string[] }> {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01 (destination month)
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { snapshot: [], touchedSubIds: [] };

  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)); // JS month is 0-indexed; prev = m-2
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const prevPlans = unwrap(
    await supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", prevMonth),
    "budget_plans",
  );

  // Irregular bills are one-off by nature and are planned per month on their
  // own card, so a roll-in must never carry their subcategory forward — a new
  // month starts them at $0.
  const irregularSubIdRows = unwrap(
    await supabase
      .from("irregular_bills")
      .select("subcategory_id")
      .eq("household_id", householdId)
      .not("subcategory_id", "is", null),
    "irregular_bills",
  );
  const irregularSubIds = new Set(
    (irregularSubIdRows ?? []).map((r) => r.subcategory_id as string),
  );

  const positivePrevPlans = (prevPlans ?? [])
    .filter((p) => (p.planned_cents ?? 0) > 0)
    .filter((p) => !irregularSubIds.has(p.subcategory_id as string));
  const candidateSubIds = positivePrevPlans.map((p) => p.subcategory_id as string);
  let paidOffDebtSubIds = new Set<string>();
  if (candidateSubIds.length > 0) {
    const paidOffDebts = unwrap(
      await supabase
        .from("debts")
        .select("subcategory_id")
        .eq("household_id", householdId)
        .in("subcategory_id", candidateSubIds)
        .lte("current_balance_cents", 0),
      "debts",
    );
    paidOffDebtSubIds = new Set((paidOffDebts ?? []).map((debt) => debt.subcategory_id as string));
  }

  // Once a card or loan reaches $0, its old payment plan must not silently
  // reappear in a later month or cross into a new calendar year.
  const rows = positivePrevPlans
    .filter((p) => !paidOffDebtSubIds.has(p.subcategory_id as string))
    .map((p) => ({
      household_id: householdId,
      month,
      subcategory_id: p.subcategory_id,
      planned_cents: p.planned_cents,
    }));

  // Snapshot the destination month's current plans for the sub-ids about to be
  // overwritten, so Undo can restore prior values (or delete rows that didn't
  // exist before).
  const touchedSubIds = rows.map((r) => r.subcategory_id as string);
  let snapshot: Array<{ subcategory_id: string; planned_cents: number | null }> = [];
  if (touchedSubIds.length > 0) {
    const existing = unwrap(
      await supabase
        .from("budget_plans")
        .select("subcategory_id, planned_cents")
        .eq("household_id", householdId)
        .eq("month", month)
        .in("subcategory_id", touchedSubIds),
      "budget_plans",
    );
    const existingMap = new Map(
      (existing ?? []).map((e) => [e.subcategory_id as string, e.planned_cents as number | null]),
    );
    snapshot = touchedSubIds.map((id) => ({
      subcategory_id: id,
      planned_cents: existingMap.has(id) ? (existingMap.get(id) ?? null) : null,
    }));

    unwrap(
      await supabase
        .from("budget_plans")
        .upsert(rows, { onConflict: "household_id,month,subcategory_id" }),
      "budget_plans roll-in",
    );
  }

  revalidatePath("/budget");
  return { snapshot, touchedSubIds };
}

export async function restorePlansSnapshot(
  month: string,
  snapshot: Array<{ subcategory_id: string; planned_cents: number | null }>,
) {
  const { supabase, householdId } = await requireHousehold();
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;

  // A row that existed at $0 is restored to $0, not skipped. Skipping it left
  // Military Pay at August's $8,293.33 after an Undo, because September plans
  // it at $0 until the month-end paycheck lands.
  const toUpsert = snapshot
    .filter((s) => s.planned_cents != null)
    .map((s) => ({
      household_id: householdId,
      month,
      subcategory_id: s.subcategory_id,
      planned_cents: s.planned_cents!,
    }));
  const toDelete = snapshot.filter((s) => s.planned_cents == null).map((s) => s.subcategory_id);

  if (toUpsert.length > 0) {
    unwrap(
      await supabase
        .from("budget_plans")
        .upsert(toUpsert, { onConflict: "household_id,month,subcategory_id" }),
      "budget_plans undo",
    );
  }
  if (toDelete.length > 0) {
    unwrap(
      await supabase
        .from("budget_plans")
        .delete()
        .eq("household_id", householdId)
        .eq("month", month)
        .in("subcategory_id", toDelete),
      "budget_plans undo",
    );
  }

  revalidatePath("/budget");
}

export async function setRollover(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01 (source month)
  const enable = formData.get("enable") === "on";
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;

  if (enable) {
    await supabase
      .from("budget_rollovers")
      .upsert({ household_id: householdId, month }, { onConflict: "household_id,month" });
  } else {
    await supabase
      .from("budget_rollovers")
      .delete()
      .eq("household_id", householdId)
      .eq("month", month);
  }

  revalidatePath("/budget");
}

export async function setRolloverOverride(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;
  const raw = String(formData.get("override") ?? "").trim();
  // Empty string = clear override (back to live calc). Number = cents override.
  const overrideCents = raw === "" ? null : Math.round(parseFloat(raw) * 100);
  if (overrideCents !== null && isNaN(overrideCents)) return;

  await supabase
    .from("budget_rollovers")
    .upsert({ household_id: householdId, month, override_cents: overrideCents }, { onConflict: "household_id,month" });

  revalidatePath("/budget");
}
