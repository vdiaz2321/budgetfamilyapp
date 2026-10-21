"use server";

import { revalidatePath } from "next/cache";
import { displayToCents } from "@/lib/money";
import { getSessionContext } from "@/lib/auth-context";
import { unwrap } from "@/lib/supabase-result";
import { captureSnapshots, currentMonthFirst } from "@/lib/snapshots";
import { adjustDebtBalance } from "@/lib/debts";
import { saveDebt } from "@/lib/save-debt";

// Uses the shared, request-cached session context rather than re-running the
// getUser → profile → household chain by hand (see AGENTS.md). The chain was
// duplicated here, costing extra auth round-trips on every debt action.
async function requireHousehold() {
  const { supabase, household } = await getSessionContext();
  return { supabase, householdId: household.id };
}

// Manual statement interest is authoritative for revolving cards and is also
// available as a lender-statement correction for standard loans.
export async function recordDebtInterest(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const debtId = String(formData.get("debtId") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const occurredOn = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!debtId || amountCents <= 0) return { error: "Enter an interest amount greater than zero." };

  const debt = unwrap(
    await supabase
      .from("debts")
      .select("id, current_balance_cents, interest_paid_cents")
      .eq("id", debtId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "debts",
  );
  if (!debt) return { error: "Debt not found." };

  const { data: entry, error: entryError } = await supabase
    .from("debt_interest_entries")
    .insert({ household_id: householdId, debt_id: debtId, occurred_on: occurredOn, amount_cents: amountCents, memo })
    .select("id")
    .single();
  if (entryError || !entry) return { error: "Couldn't record the interest charge." };

  const { error: updateError } = await supabase
    .from("debts")
    .update({
      current_balance_cents: Number(debt.current_balance_cents) + amountCents,
      interest_paid_cents: Number(debt.interest_paid_cents ?? 0) + amountCents,
      paid_off_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", debtId)
    .eq("household_id", householdId);
  if (updateError) {
    await supabase.from("debt_interest_entries").delete().eq("id", entry.id).eq("household_id", householdId);
    return { error: "Couldn't update the debt balance." };
  }

  // Every other debt-balance change recaptures this month's snapshot; without
  // it Net Worth kept the pre-interest balance until something else moved.
  await captureSnapshots(supabase, householdId, { force: true });
  revalidatePath("/snowball");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  // Travel Log's Pay Card popup shows the debt balance too.
  revalidatePath("/travel");
  revalidatePath("/networth");
  return { error: null };
}


/**
 * Commit a simulated payment to the plan.
 *
 * The Payoff Simulator could show that paying $X clears a debt N months
 * sooner, but nothing carried that answer anywhere — the figure had to be
 * remembered and re-typed into the Budget page by hand, which is where most of
 * its value leaked away.
 *
 * Writes both places the payment is read from:
 *   - `budget_plans` for the given month, which is what Budget displays and
 *     what Snowball's "My Plan" mode projects from;
 *   - `debts.target_payment_cents`, the standing amount used as a fallback for
 *     months that haven't been planned yet.
 */
export async function applyPayoffPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const paymentCents = displayToCents(String(formData.get("payment") ?? "0"));

  if (!subcategoryId || !month) return { error: "Missing details." };
  if (paymentCents <= 0) return { error: "Enter a payment above zero." };

  // A payment below the minimum isn't a plan the lender will accept, and
  // silently storing one would make every downstream projection optimistic.
  const { data: debt, error: debtError } = await supabase
    .from("debts")
    .select("min_payment_cents")
    .eq("household_id", householdId)
    .eq("subcategory_id", subcategoryId)
    .maybeSingle();
  // A swallowed error gives minCents = 0, which disables the very guard this
  // read exists for and stores the below-minimum payment anyway.
  if (debtError) return { error: "Couldn't check the minimum payment. Try again." };
  const minCents = debt?.min_payment_cents ?? 0;
  if (paymentCents < minCents) {
    return { error: "That's below this debt's minimum payment." };
  }

  const now = new Date().toISOString();
  const { error: planError } = await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: paymentCents,
      updated_at: now,
    },
    { onConflict: "household_id,month,subcategory_id" },
  );
  if (planError) return { error: "Couldn't update the budget plan." };

  await supabase
    .from("debts")
    .update({ target_payment_cents: paymentCents, updated_at: now })
    .eq("household_id", householdId)
    .eq("subcategory_id", subcategoryId);

  revalidatePath("/snowball");
  revalidatePath("/budget");
  revalidatePath("/annual");
  // The Pay Card popup prefills this month's plan on both card pages.
  revalidatePath("/accounts");
  revalidatePath("/travel");
  return { error: null };
}

/**
 * Put the Classic Snowball schedule into Budget: one plan per debt per month
 * until it's paid off. Writing every month, not just this one, matters — the
 * monthly auto roll-in copies last month's plan forward, so applying only
 * October would carry VentureJ's $150 into November when Classic pays $817
 * there. Months already written are overwritten; anything later is left alone.
 */
export async function applyClassicPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  let plans: { subId: string; month: string; cents: number }[];
  try {
    plans = JSON.parse(String(formData.get("plans") ?? "[]"));
  } catch {
    return { error: "Couldn't read the plan." };
  }
  plans = plans.filter(
    (p) => typeof p.subId === "string" && /^\d{4}-\d{2}-01$/.test(p.month) && Number.isInteger(p.cents) && p.cents >= 0,
  );
  if (!plans.length) return { error: "Nothing to apply." };

  // Only debts that belong to this household.
  const debts = unwrap(
    await supabase
      .from("debts")
      .select("subcategory_id")
      .eq("household_id", householdId)
      .in("subcategory_id", [...new Set(plans.map((p) => p.subId))]),
    "debts",
  );
  const ownSubIds = new Set((debts ?? []).map((d) => d.subcategory_id as string));
  const now = new Date().toISOString();
  const rows = plans
    .filter((p) => ownSubIds.has(p.subId))
    .map((p) => ({ household_id: householdId, month: p.month, subcategory_id: p.subId, planned_cents: p.cents, updated_at: now }));
  if (!rows.length) return { error: "Nothing to apply." };

  const { error } = await supabase.from("budget_plans").upsert(rows, { onConflict: "household_id,month,subcategory_id" });
  if (error) return { error: "Couldn't update the budget plan." };

  revalidatePath("/snowball");
  revalidatePath("/budget");
  revalidatePath("/annual");
  revalidatePath("/accounts");
  revalidatePath("/travel");
  return { error: null };
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function revalidateDebtPages() {
  revalidatePath("/snowball");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/travel");
  revalidatePath("/networth");
}

/**
 * Move part of one card's balance onto a promo offer on another card.
 *
 * Writes three things, so nothing is counted twice:
 *   - a new debt (its own budget item) for amount + fee, with the offer's end
 *     date and go-to APR — kept apart from any promo already on that card;
 *   - a card payment on the source card for the amount, so its owed figure
 *     drops. No bank moves and it is not spending: the original charges
 *     already were, and stay where they are (a trip still shows them spent);
 *   - this month's plan for the new item.
 * The fee is part of the new balance, so it is paid off with it.
 */
export async function createBalanceTransfer(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const fromId = String(formData.get("fromAccountId") ?? "");
  const toId = String(formData.get("toAccountId") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const feePct = Number(String(formData.get("feePct") ?? "0"));
  const promoApr = Number(String(formData.get("promoApr") ?? "0") || "0");
  const rawGoTo = String(formData.get("postPromoApr") ?? "").trim();
  const postPromoApr = rawGoTo === "" ? null : Number(rawGoTo);
  const promoEndsOn = String(formData.get("promoEndsOn") ?? "").trim();
  const occurredOn = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const plannedCents = displayToCents(String(formData.get("planned") ?? "0"));
  const minCents = displayToCents(String(formData.get("minimum") ?? "0"));

  if (!fromId || !toId) return { error: "Pick both cards." };
  if (fromId === toId) return { error: "Pick two different cards." };
  if (amountCents <= 0) return { error: "Enter the amount to transfer." };
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 10) return { error: "Enter the fee as a percent, e.g. 3." };
  if (!Number.isFinite(promoApr) || promoApr < 0) return { error: "Enter the promo APR, e.g. 0." };
  if (postPromoApr != null && (!Number.isFinite(postPromoApr) || postPromoApr < 0)) return { error: "Enter the APR after the promo, e.g. 18.74." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(promoEndsOn)) return { error: "Enter when the promo ends." };
  if (promoEndsOn <= occurredOn) return { error: "The promo has to end after the transfer date." };

  const cards = unwrap(
    await supabase
      .from("accounts")
      .select("id, name, kind, payment_due_day")
      .eq("household_id", householdId)
      .in("id", [fromId, toId]),
    "accounts",
  ) ?? [];
  const from = cards.find((c) => c.id === fromId);
  const to = cards.find((c) => c.id === toId);
  if (!from || !to || from.kind !== "credit_card" || to.kind !== "credit_card") return { error: "Both have to be credit cards." };

  const feeCents = Math.round((amountCents * feePct) / 100);
  const balanceCents = amountCents + feeCents;

  // The Debt group the card payoff debts already live in.
  const category = unwrap(
    await supabase
      .from("categories")
      .select("id")
      .eq("household_id", householdId)
      .eq("kind", "debt")
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
    "categories",
  );
  if (!category) return { error: "There is no Debt group on Budget to add this to." };

  // "3191 VentureJ BT (Oct26)", numbered if that name is already taken.
  const d = new Date(`${occurredOn}T00:00:00`);
  const baseName = `${to.name} BT (${MONTHS_SHORT[d.getMonth()]}${String(d.getFullYear()).slice(2)})`;
  const taken = new Set(
    (unwrap(
      await supabase
        .from("subcategories")
        .select("name")
        .eq("household_id", householdId)
        .eq("category_id", category.id)
        .ilike("name", `${baseName}%`),
      "subcategories",
    ) ?? []).map((s) => s.name as string),
  );
  let name = baseName;
  for (let n = 2; taken.has(name); n++) name = `${baseName} ${n}`;

  const last = unwrap(
    await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("household_id", householdId)
      .eq("category_id", category.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "subcategories",
  );
  const { data: sub, error: subError } = await supabase
    .from("subcategories")
    .insert({
      household_id: householdId,
      category_id: category.id,
      name,
      due_day: to.payment_due_day ?? null,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (subError || !sub) return { error: `Couldn't add the budget item — ${subError?.message ?? "no row returned"}` };

  const undoSub = () => supabase.from("subcategories").delete().eq("id", sub.id).eq("household_id", householdId);

  const { error: debtError } = await saveDebt(supabase, householdId, {
    subcategoryId: sub.id,
    balanceCents,
    originalBalanceCents: balanceCents,
    minPaymentCents: Math.max(0, minCents),
    targetPaymentCents: Math.max(0, plannedCents),
    apr: promoApr,
    postPromoApr,
    promoAprEndsOn: promoEndsOn,
    dueDay: to.payment_due_day ?? null,
    debtKind: "credit_card",
    interestMethod: "statement_manual",
    accountId: null,
    trackingEnabled: true,
  });
  if (debtError) {
    await undoSub();
    return { error: `Couldn't save the transfer — ${debtError}` };
  }

  // If the source card is itself carried as a payoff debt, the transfer pays
  // that debt down, the same way payCard does.
  const sourceDebt = unwrap(
    await supabase
      .from("debts")
      .select("subcategory_id, subcategories(category_id)")
      .eq("household_id", householdId)
      .eq("account_id", fromId)
      .maybeSingle(),
    "debts",
  ) as { subcategory_id: string; subcategories: { category_id: string } | null } | null;

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      household_id: householdId,
      account_id: null,
      paid_to_account_id: fromId,
      movement_type: "card_payment",
      subcategory_id: sourceDebt?.subcategory_id ?? null,
      category_id: sourceDebt?.subcategories?.category_id ?? null,
      amount_cents: amountCents,
      occurred_on: occurredOn,
      memo: `Balance transfer to ${to.name}`,
      is_withdrawal: false,
      cleared: true,
    })
    .select("id")
    .single();
  if (txError || !tx) {
    await undoSub();
    return { error: `Couldn't record the transfer on ${from.name} — ${txError?.message ?? "no row returned"}` };
  }
  if (sourceDebt?.subcategory_id) await adjustDebtBalance(supabase, householdId, sourceDebt.subcategory_id, -amountCents);

  const { error: linkError } = await supabase
    .from("debts")
    .update({ bt_card_account_id: toId, bt_from_account_id: fromId, bt_fee_cents: feeCents, bt_transaction_id: tx.id })
    .eq("household_id", householdId)
    .eq("subcategory_id", sub.id);
  if (linkError) return { error: `Transfer saved, but couldn't link it to ${to.name} — ${linkError.message}` };

  if (plannedCents > 0) {
    await supabase.from("budget_plans").upsert(
      { household_id: householdId, month: currentMonthFirst(), subcategory_id: sub.id, planned_cents: plannedCents, updated_at: new Date().toISOString() },
      { onConflict: "household_id,month,subcategory_id" },
    );
  }

  await captureSnapshots(supabase, householdId, { force: true });
  revalidateDebtPages();
  return { error: null };
}

/**
 * Take a balance transfer back out: the source card owes the amount again and
 * the transfer's budget item (with its plan and snapshots) is removed. Only
 * before any payment is logged on it — after that the payments would lose
 * their item.
 */
export async function undoBalanceTransfer(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const debtId = String(formData.get("debtId") ?? "");
  const debt = unwrap(
    await supabase
      .from("debts")
      .select("subcategory_id, bt_card_account_id, bt_transaction_id")
      .eq("household_id", householdId)
      .eq("id", debtId)
      .maybeSingle(),
    "debts",
  );
  if (!debt || !debt.bt_card_account_id) return { error: "That isn't a balance transfer." };

  const { count, error: countError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("subcategory_id", debt.subcategory_id);
  if (countError) return { error: "Couldn't check for payments. Try again." };
  if ((count ?? 0) > 0) return { error: "Delete this transfer's payments first." };

  if (debt.bt_transaction_id) {
    const tx = unwrap(
      await supabase
        .from("transactions")
        .select("amount_cents, subcategory_id")
        .eq("household_id", householdId)
        .eq("id", debt.bt_transaction_id)
        .maybeSingle(),
      "transactions",
    );
    if (tx) {
      // Put a source-card payoff debt back up by what the transfer took off it.
      if (tx.subcategory_id) await adjustDebtBalance(supabase, householdId, tx.subcategory_id, tx.amount_cents);
      const { error } = await supabase.from("transactions").delete().eq("household_id", householdId).eq("id", debt.bt_transaction_id);
      if (error) return { error: `Couldn't remove the transfer payment — ${error.message}` };
    }
  }

  // Cascades to the debt row, its plans and snapshots.
  const { error } = await supabase.from("subcategories").delete().eq("household_id", householdId).eq("id", debt.subcategory_id);
  if (error) return { error: `Couldn't remove the transfer — ${error.message}` };

  await captureSnapshots(supabase, householdId, { force: true });
  revalidateDebtPages();
  return { error: null };
}
