"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";
import { subscriptionChargesIn } from "@/lib/planned-by-sub";

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

function revalidate() {
  // The management UI now lives in a modal on Budget itself; the payee
  // autocomplete + auto-fill in the transaction modal lives on both pages.
  revalidatePath("/budget");
  revalidatePath("/transactions");
}

// After any subscription change, recompute the total monthly-equivalent cost of
// all active subscriptions and write it as the planned amount for the current
// month on the "Subscriptions" Bills subcategory — so the budget row never
// shows an unexpected overspent state.
async function syncSubscriptionsPlanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  subcategoryId: string,
) {
  // The total computed here is written straight to planned_cents, so a failed
  // read would plan $0 for Subscriptions and show the row as fully overspent.
  const { data: subs, error: subsError } = await supabase
    .from("subscriptions")
    .select("amount_cents, billing_cycle, is_active")
    .eq("household_id", householdId)
    .eq("is_active", true);
  if (subsError) throw new Error(`Could not read subscriptions: ${subsError.message}`);

  const monthlyTotal = (subs ?? []).reduce((sum, s) => {
    let mo = s.amount_cents;
    if (s.billing_cycle === "annual") mo = Math.round(s.amount_cents / 12);
    else if (s.billing_cycle === "quarterly") mo = Math.round(s.amount_cents / 3);
    else if (s.billing_cycle === "weekly") mo = Math.round(s.amount_cents * (52 / 12));
    return sum + mo;
  }, 0);

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: subcategoryId, planned_cents: monthlyTotal },
    { onConflict: "household_id,month,subcategory_id" },
  );
}

async function findOrCreateBillsSubcategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  name: "Subscriptions" | "Irregular Bills",
): Promise<string> {
  const billsCat = unwrap(
    await supabase
      .from("categories")
      .select("id")
      .eq("household_id", householdId)
      .eq("kind", "bills")
      .single(),
    "categories",
  );
  if (!billsCat) throw new Error("Bills category not found");

  const existing = unwrap(
    await supabase
      .from("subcategories")
      .select("id")
      .eq("household_id", householdId)
      .eq("category_id", billsCat.id)
      .ilike("name", name)
      .maybeSingle(),
    "subcategories",
  );
  if (existing) return existing.id;

  const maxRow = unwrap(
    await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("category_id", billsCat.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "subcategories",
  );
  const nextSort = (maxRow?.sort_order ?? 0) + 1;

  const created = unwrap(
    await supabase
      .from("subcategories")
      .insert({ household_id: householdId, category_id: billsCat.id, name, sort_order: nextSort })
      .select("id")
      .single(),
    "subcategories",
  );
  if (!created) throw new Error(`Failed to create "${name}" subcategory`);
  return created.id;
}

export async function upsertSubscription(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const billingCycle = String(formData.get("billingCycle") ?? "monthly");
  const nextRenewalDate = String(formData.get("nextRenewalDate") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";
  const isRecurring = formData.get("isRecurring") === "on";
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  if (!name) return { error: "Name is required." };

  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Subscriptions");

  const row = {
    household_id: householdId,
    name,
    amount_cents: amountCents,
    billing_cycle: billingCycle,
    next_renewal_date: nextRenewalDate,
    subcategory_id: subcategoryId,
    account_id: accountId,
    notes,
    is_active: isActive,
    is_recurring: isRecurring,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.from("subscriptions").update(row).eq("id", id).eq("household_id", householdId);
  } else {
    const maxRow = unwrap(
      await supabase
        .from("subscriptions")
        .select("sort_order")
        .eq("household_id", householdId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "subscriptions",
    );
    await supabase.from("subscriptions").insert({ ...row, sort_order: (maxRow?.sort_order ?? 0) + 1 });
  }
  await syncSubscriptionsPlanned(supabase, householdId, subcategoryId);
  revalidate();
}

export async function deleteSubscription(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  await supabase.from("subscriptions").delete().eq("id", id).eq("household_id", householdId);
  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Subscriptions");
  await syncSubscriptionsPlanned(supabase, householdId, subcategoryId);
  revalidate();
}

// Advances a subscription's next_renewal_date forward by one billing cycle.
// Called when the user marks it Paid from the Due-this-week panel so the
// next-due date reflects reality without them opening the edit modal.
export async function advanceSubscriptionRenewal(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const row = unwrap(
    await supabase
      .from("subscriptions")
      .select("next_renewal_date, billing_cycle")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subscriptions",
  );
  if (!row?.next_renewal_date) return;

  const [y, m, d] = row.next_renewal_date.split("-").map(Number);
  const current = new Date(y, m - 1, d);
  const next = new Date(current);
  switch (row.billing_cycle) {
    case "weekly":    next.setDate(current.getDate() + 7); break;
    case "quarterly": next.setMonth(current.getMonth() + 3); break;
    case "annual":    next.setFullYear(current.getFullYear() + 1); break;
    case "monthly":
    default:          next.setMonth(current.getMonth() + 1); break;
  }
  const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;

  await supabase
    .from("subscriptions")
    .update({ next_renewal_date: iso, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);
  revalidate();
}

export async function updateSubscriptionDueDate(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  const nextRenewalDate = String(formData.get("nextRenewalDate") ?? "").trim() || null;
  if (!id) return;

  await supabase
    .from("subscriptions")
    .update({ next_renewal_date: nextRenewalDate, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);
  revalidate();
}

/**
 * Set a subscription's charge amount from the Budget card's Plan column.
 *
 * The Plan cell shows this month's charge, which for a row billed this month
 * IS the subscription's amount — so editing it in place edits the amount, and
 * the Bills group's planned total (derived from these rows) follows on the
 * revalidate.
 */
export async function updateSubscriptionAmount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (amountCents < 0) return;
  const month = String(formData.get("month") ?? "").trim(); // YYYY-MM-01
  const validMonth = /^\d{4}-\d{2}-01$/.test(month);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  // Does this month already carry its own figure? Then the Plan cell is
  // showing that figure, and editing it must edit it — not the price.
  const hasOverride = validMonth
    ? Boolean(
        unwrap(
          await supabase
            .from("subscription_plans")
            .select("id")
            .eq("household_id", householdId)
            .eq("subscription_id", id)
            .eq("month", month)
            .maybeSingle(),
          "subscription month plan",
        ),
      )
    : false;
  // Three cases budget one month alone (subscription_plans) and leave the
  // subscription's own amount untouched: a month it doesn't bill in (no
  // sticker price there), a past month (its plan is history — changing the
  // price from August would rewrite every month since), and a month that
  // already has its own figure.
  const perMonth =
    validMonth && (formData.get("perMonth") === "1" || month < currentMonth || hasOverride);
  if (perMonth) {
    // $0 only clears the override where the month wouldn't bill anyway. In a
    // month the sub does charge (a free month, a skipped bill), deleting would
    // fall back to the sticker price — so a $0 there is saved as its own plan.
    const chargesThisMonth =
      amountCents === 0 &&
      subscriptionChargesIn(
        unwrap(
          await supabase
            .from("subscriptions")
            .select("subcategory_id, is_active, next_renewal_date, billing_cycle")
            .eq("id", id)
            .eq("household_id", householdId)
            .maybeSingle(),
          "subscription",
        ) ?? { subcategory_id: null, is_active: false, next_renewal_date: null, billing_cycle: "monthly" },
        month,
      );
    if (amountCents === 0 && !chargesThisMonth) {
      await supabase
        .from("subscription_plans")
        .delete()
        .eq("household_id", householdId)
        .eq("subscription_id", id)
        .eq("month", month);
    } else {
      await supabase
        .from("subscription_plans")
        .upsert(
          {
            household_id: householdId,
            subscription_id: id,
            month,
            planned_cents: amountCents,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "household_id,subscription_id,month" },
        );
    }
    revalidate();
    return;
  }
  // A real price change. The Budget page derives every month's plan from
  // amount_cents, so before changing it, freeze the old price into each
  // earlier month the sub billed in that has no figure of its own — the
  // months already paid at the old price keep the plan they had.
  const sub = unwrap(
    await supabase
      .from("subscriptions")
      .select("amount_cents, billing_cycle, next_renewal_date, is_active, subcategory_id, created_at")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subscription",
  );
  if (!sub) return;
  if (sub.amount_cents !== amountCents && validMonth && sub.subcategory_id && sub.is_active && sub.next_renewal_date) {
    const existing = unwrap(
      await supabase
        .from("subscription_plans")
        .select("month")
        .eq("household_id", householdId)
        .eq("subscription_id", id)
        .lt("month", month),
      "subscription month plans",
    );
    const covered = new Set((existing ?? []).map((row) => String(row.month)));
    // From the month the sub was added, up to (not including) the edited one.
    const start = new Date(`${String(sub.created_at).slice(0, 7)}-01T00:00:00Z`);
    const snapshots: { household_id: string; subscription_id: string; month: string; planned_cents: number }[] = [];
    for (const d = start; d.toISOString().slice(0, 10) < month; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const key = d.toISOString().slice(0, 7);
      const first = `${key}-01`;
      if (covered.has(first)) continue;
      // Same billing rule as subscriptionChargesIn on the Budget page.
      const charges =
        sub.billing_cycle === "monthly" ||
        (sub.billing_cycle === "annual" && sub.next_renewal_date.slice(5, 7) === key.slice(5)) ||
        sub.next_renewal_date.slice(0, 7) === key;
      if (!charges) continue;
      snapshots.push({ household_id: householdId, subscription_id: id, month: first, planned_cents: sub.amount_cents });
    }
    if (snapshots.length > 0) {
      unwrap(await supabase.from("subscription_plans").insert(snapshots), "saving past subscription plans");
    }
  }
  unwrap(
    await supabase
      .from("subscriptions")
      .update({ amount_cents: amountCents, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("household_id", householdId),
    "saving subscription amount",
  );
  revalidate();
}

export async function upsertIrregularBill(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const typicalAmountCents = displayToCents(String(formData.get("typicalAmount") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  if (!name) return { error: "Name is required." };

  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Irregular Bills");

  const row = {
    household_id: householdId,
    name,
    typical_amount_cents: typicalAmountCents,
    subcategory_id: subcategoryId,
    account_id: accountId,
    notes,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.from("irregular_bills").update(row).eq("id", id).eq("household_id", householdId);
  } else {
    await supabase.from("irregular_bills").insert(row);
  }
  revalidate();
}

export async function updateIrregularBillTypical(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const typicalAmountCents = displayToCents(String(formData.get("typicalAmount") ?? "0"));
  await supabase
    .from("irregular_bills")
    .update({ typical_amount_cents: typicalAmountCents, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);
  revalidate();
}

// Planned amount for one irregular bill in one month. These items don't
// recur monthly, so the plan is stored per month and an untouched month
// simply has no row (= $0 planned) rather than inheriting the last amount.
export async function setIrregularBillMonthPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim(); // YYYY-MM-01
  if (!id || !/^\d{4}-\d{2}-01$/.test(month)) return;
  const plannedCents = displayToCents(String(formData.get("planned") ?? "0"));
  if (plannedCents === 0) {
    await supabase
      .from("irregular_bill_plans")
      .delete()
      .eq("household_id", householdId)
      .eq("bill_id", id)
      .eq("month", month);
  } else {
    await supabase
      .from("irregular_bill_plans")
      .upsert(
        {
          household_id: householdId,
          bill_id: id,
          month,
          planned_cents: plannedCents,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "household_id,bill_id,month" },
      );
  }
  revalidate();
}

export async function deleteIrregularBill(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  await supabase.from("irregular_bills").delete().eq("id", id).eq("household_id", householdId);
  revalidate();
}

// Persist the complete visible order in one request from the board. This is
// safer than replaying several up/down swaps after a drag, especially when a
// user moves an item across multiple rows.
export async function reorderSubscriptions(orderedIds: string[]) {
  const { supabase, householdId } = await requireHousehold();
  const rows = unwrap(
    await supabase
      .from("subscriptions")
      .select("id, sort_order")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    "subscriptions",
  );
  if (!rows) return;

  const knownIds = new Set(rows.map((row) => row.id));
  const requested = [...new Set(orderedIds)].filter((id) => knownIds.has(id));
  const requestedSet = new Set(requested);
  const finalIds = [...requested, ...rows.filter((row) => !requestedSet.has(row.id)).map((row) => row.id)];

  await Promise.all(
    finalIds.map((id, index) =>
      supabase
        .from("subscriptions")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  revalidate();
}

export async function reorderIrregularBills(orderedIds: string[]) {
  const { supabase, householdId } = await requireHousehold();
  const rows = unwrap(
    await supabase
      .from("irregular_bills")
      .select("id, sort_order")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    "irregular_bills",
  );
  if (!rows) return;

  const knownIds = new Set(rows.map((row) => row.id));
  const requested = [...new Set(orderedIds)].filter((id) => knownIds.has(id));
  const requestedSet = new Set(requested);
  const finalIds = [...requested, ...rows.filter((row) => !requestedSet.has(row.id)).map((row) => row.id)];

  await Promise.all(
    finalIds.map((id, index) =>
      supabase
        .from("irregular_bills")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  revalidate();
}

// Match Spent for Subscriptions. That budget row's plan is the sum of each
// subscription's month plan, so matching it sets each picked subscription's
// plan for this one month (a subscription_plans row) to what it was charged —
// never its price, so next month still plans the usual amount. A $0 is saved
// as its own row, since deleting would fall back to the price. The spent
// figures come from the board's payee matcher. Returns the month's old
// override rows (null = there wasn't one) so the board can offer Undo.
export async function matchSubscriptionPlansToSpent(
  month: string,
  items: Array<{ subscriptionId: string; cents: number }>,
): Promise<{ error?: string; snapshot?: Array<{ subscription_id: string; planned_cents: number | null }> }> {
  const { supabase, householdId } = await requireHousehold();
  const picked = items.filter((i) => i.subscriptionId && Number.isFinite(i.cents) && i.cents >= 0);
  if (!/^\d{4}-\d{2}-01$/.test(month) || picked.length === 0) return { error: "Nothing to match." };
  const ids = picked.map((i) => i.subscriptionId);

  const [subs, plans] = await Promise.all([
    supabase.from("subscriptions").select("id").eq("household_id", householdId).in("id", ids),
    supabase.from("subscription_plans").select("subscription_id, planned_cents").eq("household_id", householdId).eq("month", month).in("subscription_id", ids),
  ]);
  const ours = new Set((unwrap(subs, "subscriptions") ?? []).map((s) => s.id as string));
  const before = new Map((unwrap(plans, "subscription_plans") ?? []).map((p) => [p.subscription_id as string, p.planned_cents as number]));
  const rows = picked.filter((i) => ours.has(i.subscriptionId));
  if (rows.length === 0) return { error: "Nothing to match." };

  const now = new Date().toISOString();
  const { error } = await supabase.from("subscription_plans").upsert(
    rows.map((r) => ({ household_id: householdId, subscription_id: r.subscriptionId, month, planned_cents: Math.round(r.cents), updated_at: now })),
    { onConflict: "household_id,subscription_id,month" },
  );
  if (error) return { error: "Couldn't save the new subscription plans. Try again." };

  revalidate();
  return { snapshot: rows.map((r) => ({ subscription_id: r.subscriptionId, planned_cents: before.get(r.subscriptionId) ?? null })) };
}

export async function restoreSubscriptionPlansSnapshot(
  month: string,
  snapshot: Array<{ subscription_id: string; planned_cents: number | null }>,
) {
  const { supabase, householdId } = await requireHousehold();
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;
  const toUpsert = snapshot
    .filter((s) => s.planned_cents != null)
    .map((s) => ({ household_id: householdId, subscription_id: s.subscription_id, month, planned_cents: s.planned_cents! }));
  const toDelete = snapshot.filter((s) => s.planned_cents == null).map((s) => s.subscription_id);
  if (toUpsert.length > 0) {
    unwrap(
      await supabase.from("subscription_plans").upsert(toUpsert, { onConflict: "household_id,subscription_id,month" }),
      "subscription_plans undo",
    );
  }
  if (toDelete.length > 0) {
    unwrap(
      await supabase.from("subscription_plans").delete().eq("household_id", householdId).eq("month", month).in("subscription_id", toDelete),
      "subscription_plans undo",
    );
  }
  revalidate();
}

// "Skip" on a Due-this-week subscription: a free or skipped month. Nothing was
// charged, so no transaction is logged — the renewal date just moves to the
// next cycle (same as Pay does) and the month it was due in plans $0, so the
// budget doesn't wait on a charge that won't come.
export async function skipSubscriptionCycle(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim(); // YYYY-MM-DD
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
  unwrap(
    await supabase.from("subscription_plans").upsert(
      {
        household_id: householdId,
        subscription_id: id,
        month: `${dueDate.slice(0, 7)}-01`,
        planned_cents: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,subscription_id,month" },
    ),
    "skipping subscription month",
  );
  await advanceSubscriptionRenewal(formData);
}
