"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { currentMonthFirst } from "@/lib/snapshots";
import { syncAccountFromBuckets, syncAllBucketedAccounts, adjustBucketBalance } from "@/lib/buckets";
import { adjustAccountLedger } from "@/lib/account-ledger";
import { adjustDebtBalance } from "@/lib/debts";

// Every account type presented in the Accounts add flow. Rewards cards remain
// ordinary cards unless payoff tracking is explicitly enabled in Edit details.
const ALLOWED_KINDS = ["cash", "checking", "savings_bucket", "investment", "credit_card", "debt_loan"];

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

function revalidate() {
  revalidatePath("/accounts");
  // The transaction modal's account dropdown lives on /budget.
  revalidatePath("/budget");
  // Net Worth mirrors account names/grouping in its grid.
  revalidatePath("/networth");
  revalidatePath("/snowball");
  // The sidebar's account totals live in the shared (app) layout.
  revalidatePath("/", "layout");
}

async function ensureDebtCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
) {
  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .eq("kind", "debt")
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("categories")
    .insert({ household_id: householdId, name: "Debt", kind: "debt", sort_order: (last?.sort_order ?? -1) + 1 })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the Debt category.");
  return data.id as string;
}

async function ensurePayoffDebt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  input: {
    accountId: string;
    name: string;
    balanceCents: number;
    originalBalanceCents?: number;
    minPaymentCents: number;
    targetPaymentCents: number;
    apr: number;
    dueDay: number | null;
    debtKind: string | null;
    escrowCents?: number;
    termMonths?: number | null;
    loanStartDate?: string | null;
    promoAprEndsOn?: string | null;
    interestMethod: "monthly_estimate" | "statement_manual";
  },
) {
  const { data: linked } = await supabase
    .from("debts")
    .select("id, subcategory_id, original_balance_cents")
    .eq("household_id", householdId)
    .eq("account_id", input.accountId)
    .maybeSingle();

  let subcategoryId = linked?.subcategory_id as string | undefined;
  if (!subcategoryId) {
    const categoryId = await ensureDebtCategory(supabase, householdId);
    const { data: sameName } = await supabase
      .from("subcategories")
      .select("id")
      .eq("household_id", householdId)
      .eq("category_id", categoryId)
      .eq("name", input.name)
      .maybeSingle();
    if (sameName) {
      subcategoryId = sameName.id as string;
    } else {
      const { data: last } = await supabase
        .from("subcategories")
        .select("sort_order")
        .eq("household_id", householdId)
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: inserted, error } = await supabase
        .from("subcategories")
        .insert({
          household_id: householdId,
          category_id: categoryId,
          name: input.name,
          due_day: input.dueDay,
          sort_order: (last?.sort_order ?? -1) + 1,
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "Couldn't create the Budget debt item.");
      subcategoryId = inserted.id as string;
    }
  }

  const originalBalance = Math.max(
    input.balanceCents,
    input.originalBalanceCents ?? 0,
    Number(linked?.original_balance_cents ?? 0),
  );
  const { error: debtError } = await supabase.from("debts").upsert({
    household_id: householdId,
    subcategory_id: subcategoryId,
    account_id: input.accountId,
    current_balance_cents: Math.max(0, input.balanceCents),
    original_balance_cents: originalBalance,
    min_payment_cents: Math.max(0, input.minPaymentCents),
    target_payment_cents: Math.max(input.minPaymentCents, input.targetPaymentCents),
    apr: Math.max(0, input.apr),
    due_day: input.dueDay,
    debt_kind: input.debtKind,
    escrow_cents: Math.max(0, input.escrowCents ?? 0),
    term_months: input.termMonths,
    loan_start_date: input.loanStartDate,
    promo_apr_ends_on: input.promoAprEndsOn,
    interest_method: input.interestMethod,
    tracking_enabled: true,
    paid_off_at: input.balanceCents <= 0 ? new Date().toISOString().slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "household_id,subcategory_id" });
  if (debtError) throw new Error(debtError.message);

  if (input.targetPaymentCents > 0) {
    await supabase.from("budget_plans").upsert({
      household_id: householdId,
      month: currentMonthFirst(),
      subcategory_id: subcategoryId,
      planned_cents: input.targetPaymentCents,
      updated_at: new Date().toISOString(),
    }, { onConflict: "household_id,month,subcategory_id" });
  }
  await supabase
    .from("subcategories")
    .update({ active: true, due_day: input.dueDay })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);
  return subcategoryId;
}

export { syncAllBucketedAccounts };

export async function addAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const institution = String(formData.get("institution") ?? "").trim() || null;
  const accountNumber = String(formData.get("accountNumber") ?? "").trim() || null;
  const ownership = formData.get("ownership") === "joint" ? "joint" : "sole";
  const subtype = String(formData.get("subtype") ?? "").trim() || null;
  const isKidsAccount = formData.get("kidsAccount") === "on";
  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  if (!name) return { error: "Account name is required." };
  if (!ALLOWED_KINDS.includes(kind)) return { error: "Invalid account type." };

  const { data: maxRow } = await supabase
    .from("accounts")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  // Banking accounts get their Checking/Savings badge set immediately from
  // the type picked in the add form, instead of staying null until someone
  // opens Edit — that gap made the badge look like it needed a Holder value
  // to "unlock" it, when the two were unrelated.
  const bankGroup =
    kind === "savings_bucket" ? "savings" : kind === "checking" || kind === "cash" ? "spending" : null;

  const isCreditCard = kind === "credit_card";
  const isDebtAccount = kind === "debt_loan";

  const row: Record<string, unknown> = {
    household_id: householdId,
    name,
    kind,
    holder,
    institution,
    account_number: accountNumber,
    ownership,
    subtype,
    is_kids_account: isKidsAccount,
    include_net_worth: isCreditCard || isDebtAccount ? false : !isKidsAccount,
    // Linked Budget debt is the canonical liability so Net Worth never counts
    // an account-created loan twice.
    debt_tracking_mode: "budget",
    current_balance_cents: balanceCents,
    sort_order: sortOrder,
    bank_group: bankGroup,
  };

  if (isCreditCard) {
    row.annual_fee_cents = displayToCents(String(formData.get("annualFee") ?? "0"));
    row.fee_waived = formData.get("feeWaived") === "on";
    const dateOpened = String(formData.get("dateOpened") ?? "").trim();
    if (dateOpened) row.date_opened = dateOpened;
    const dateClosed = String(formData.get("dateClosed") ?? "").trim();
    if (dateClosed) row.date_closed = dateClosed;
  }

  const { data: inserted, error } = await supabase
    .from("accounts")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    return {
      error: error.code === "23505"
        ? `You already have an account named "${name}". Pick a different name.`
        : "Couldn't save that account — please try again.",
      id: null,
    };
  }

  if (isDebtAccount && inserted?.id) {
    const numberField = (key: string, fallback = 0) => {
      const value = Number(String(formData.get(key) ?? "").trim());
      return Number.isFinite(value) ? value : fallback;
    };
    const rawDue = numberField("dueDay", 0);
    const dueDay = rawDue > 0 ? Math.min(31, Math.max(1, Math.trunc(rawDue))) : null;
    const rawTerm = numberField("termMonths", 0);
    const loanStartDate = String(formData.get("loanStartDate") ?? "").trim() || null;
    const rawPromoAprEndsOn = String(formData.get("promoAprEndsOn") ?? "").trim();
    const promoAprEndsOn = /^\d{4}-\d{2}-\d{2}$/.test(rawPromoAprEndsOn) ? rawPromoAprEndsOn : null;
    const minPaymentCents = displayToCents(String(formData.get("minPayment") ?? "0"));
    const enteredPlannedPaymentCents = displayToCents(String(formData.get("plannedPayment") ?? "0"));
    const plannedPaymentCents = enteredPlannedPaymentCents > 0 ? enteredPlannedPaymentCents : minPaymentCents;
    try {
      await ensurePayoffDebt(supabase, householdId, {
        accountId: inserted.id,
        name,
        balanceCents: Math.max(0, balanceCents),
        originalBalanceCents: displayToCents(String(formData.get("originalBalance") ?? "0")),
        minPaymentCents,
        targetPaymentCents: plannedPaymentCents,
        apr: Math.max(0, numberField("apr")),
        dueDay,
        debtKind: subtype,
        escrowCents: displayToCents(String(formData.get("escrow") ?? "0")),
        termMonths: rawTerm > 0 ? Math.trunc(rawTerm) : null,
        loanStartDate,
        promoAprEndsOn,
        interestMethod: "monthly_estimate",
      });
    } catch (linkError) {
      // Avoid leaving a half-created loan account if its linked payoff profile
      // could not be created.
      await supabase.from("accounts").delete().eq("id", inserted.id).eq("household_id", householdId);
      console.error("[addAccount debt link]", linkError);
      return { error: "The loan wasn't saved because its Budget payoff item could not be created.", id: null };
    }
  }

  await captureSnapshots(supabase, householdId);
  revalidate();
  return { error: null, id: inserted?.id ?? null };
}

// Credit cards are created with their rewards details in one save so the
// Accounts screen does not have to refresh between a basic card and its setup.
export async function addCreditCardWithDetails(formData: FormData) {
  const result = await addAccount(formData);
  if (result?.error || !result?.id) return result;

  formData.set("accountId", result.id);
  formData.set("id", result.id);
  formData.set("isCreditCard", "on");
  formData.set("active", "on");
  const detailsResult = await upsertCardDetails(formData);
  if (detailsResult?.error) {
    return { error: `Card was created, but its details could not be saved: ${detailsResult.error}`, id: result.id };
  }
  return { error: null, id: result.id };
}

export async function updateAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const institution = String(formData.get("institution") ?? "").trim() || null;
  const accountNumber = String(formData.get("accountNumber") ?? "").trim() || null;
  const ownership = formData.get("ownership") === "joint" ? "joint" : "sole";
  const subtype = String(formData.get("subtype") ?? "").trim() || null;
  const isKidsAccount = formData.get("kidsAccount") === "on";
  const active = formData.get("active") === "on";
  if (!id || !name) return;

  const isCreditCard = formData.get("isCreditCard") === "on";

  const update: Record<string, unknown> = {
    name,
    holder,
    institution,
    account_number: accountNumber,
    ownership,
    subtype,
    is_kids_account: isKidsAccount,
    include_net_worth: isCreditCard ? false : !isKidsAccount,
    active,
    updated_at: new Date().toISOString(),
  };
  // Only the Banking edit form submits bankGroup; leave it untouched otherwise.
  if (formData.has("bankGroup")) {
    const bankGroup = String(formData.get("bankGroup") ?? "");
    update.bank_group = bankGroup === "savings" ? "savings" : "spending";
  }
  if (isCreditCard) {
    update.annual_fee_cents = displayToCents(String(formData.get("annualFee") ?? "0"));
    update.fee_waived = formData.get("feeWaived") === "on";
    const dateOpened = String(formData.get("dateOpened") ?? "").trim();
    update.date_opened = dateOpened || null;
    const dateClosed = String(formData.get("dateClosed") ?? "").trim();
    update.date_closed = dateClosed || null;
  }

  await supabase
    .from("accounts")
    .update(update)
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

// Rename-only, for inline editing from the Net Worth grid — unlike
// updateAccount, this never touches holder/subtype/active/kidsAccount, so a
// quick rename there can't accidentally clear those fields.
export async function renameAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  await supabase
    .from("accounts")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

export async function updateBalance(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  await supabase
    .from("accounts")
    .update({ current_balance_cents: balanceCents, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

// Reconcile the account's balance from its transaction history — sums every
// ledger delta on the account (income adds, everything else subtracts) and
// sets current_balance_cents to that total. Assumes a starting balance of $0
// (the current balance is discarded — call this only when you want a pure
// rebuild from the tx log). Skipped for investment / bucketed accounts, which
// aren't ledger-driven.
export async function recalculateBalance(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: account } = await supabase
    .from("accounts")
    .select("id, kind")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account || account.kind === "investment") return;

  const { count } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);
  if (count) return; // bucketed accounts already re-sum from buckets

  const { data: txs } = await supabase
    .from("transactions")
    .select("amount_cents, category_id")
    .eq("household_id", householdId)
    .eq("account_id", id);

  // Cache category → kind lookups since many txs share categories.
  const kindCache = new Map<string, string | null>();
  let sum = 0;
  for (const t of txs ?? []) {
    let kind: string | null;
    if (kindCache.has(t.category_id)) {
      kind = kindCache.get(t.category_id) ?? null;
    } else {
      const { data: cat } = await supabase
        .from("categories")
        .select("kind")
        .eq("id", t.category_id)
        .maybeSingle();
      kind = cat?.kind ?? null;
      kindCache.set(t.category_id, kind);
    }
    sum += kind === "income" ? t.amount_cents : -t.amount_cents;
  }

  await supabase
    .from("accounts")
    .update({ current_balance_cents: sum, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

// Persist a manual drag/arrow reorder of a section's accounts. `orderedIds` is
// that section's account ids in their new top-to-bottom order — only those
// rows' sort_order changes, so other sections are untouched.
export async function reorderAccounts(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { error: null };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("accounts")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: `Couldn't save the new order — ${failed.error.message}` };
  }

  revalidate();
  return { error: null };
}

export async function deleteAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Remove any linked payoff/loan debt (and its budget subcategory) so
  // the debts don't linger in Debt/Loans, Budget, and the sidebar totals.
  const { data: linkedDebts } = await supabase
    .from("debts")
    .select("subcategory_id")
    .eq("household_id", householdId)
    .eq("account_id", id);
  const subIds = (linkedDebts ?? [])
    .map((d) => d.subcategory_id as string | null)
    .filter((s): s is string => !!s);
  if (subIds.length > 0) {
    await supabase.from("debts").delete().eq("household_id", householdId).in("subcategory_id", subIds);
    await supabase.from("subcategories").delete().eq("household_id", householdId).in("id", subIds);
  }

  // transactions.account_id is ON DELETE SET NULL, so past transactions keep
  // their history — they just lose the account link. buckets/bucket_snapshots
  // cascade-delete with the account.
  await supabase
    .from("accounts")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

export async function closeCard(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const dateClosed = String(formData.get("dateClosed") ?? "").trim();

  await supabase
    .from("accounts")
    .update({
      date_closed: dateClosed || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

export async function reopenCard(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("accounts")
    .update({
      date_closed: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

// Upsert the rewards-tracker fields for one credit card. First save creates
// the credit_card_details row; subsequent saves update it in place.
export async function upsertCardDetails(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Missing account." };

  const { data: cardAccount } = await supabase
    .from("accounts")
    .select("id, name, kind")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!cardAccount || cardAccount.kind !== "credit_card") return { error: "Card not found." };

  const { data: existingDetails } = await supabase
    .from("credit_card_details")
    .select("debt_subcategory_id")
    .eq("account_id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();

  const optText = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  };
  const optCents = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? displayToCents(v) : null;
  };
  const optDate = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  };
  const optInt = (k: string) => {
    const v = String(formData.get(k) ?? "").trim().replace(/,/g, "");
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const optMicros = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : null;
  };

  const trackAsPayoffDebt = formData.get("trackAsPayoffDebt") === "on";
  let debtSubcategoryId = (existingDetails?.debt_subcategory_id as string | null) ?? null;
  if (trackAsPayoffDebt) {
    const aprValue = Number(String(formData.get("payoffApr") ?? "0"));
    const rawDue = Number(String(formData.get("payoffDueDay") ?? "0"));
    try {
      const rawPromo = String(formData.get("promoAprEndsOn") ?? "").trim();
      const promoAprEndsOn = /^\d{4}-\d{2}-\d{2}$/.test(rawPromo) ? rawPromo : null;
      debtSubcategoryId = await ensurePayoffDebt(supabase, householdId, {
        accountId,
        name: cardAccount.name,
        balanceCents: Math.max(0, displayToCents(String(formData.get("payoffBalance") ?? "0"))),
        minPaymentCents: Math.max(0, displayToCents(String(formData.get("payoffMinimum") ?? "0"))),
        targetPaymentCents: Math.max(0, displayToCents(String(formData.get("payoffPlanned") ?? "0"))),
        apr: Number.isFinite(aprValue) ? Math.max(0, aprValue) : 0,
        dueDay: rawDue > 0 ? Math.min(31, Math.max(1, Math.trunc(rawDue))) : null,
        debtKind: "credit_card",
        interestMethod: "statement_manual",
        promoAprEndsOn,
      });
    } catch (payoffError) {
      console.error("[upsertCardDetails payoff]", payoffError);
      return { error: "Card details were not saved because payoff tracking could not be linked." };
    }
  } else if (debtSubcategoryId) {
    // Hide from Debt/Loans without deleting its payment or interest history.
    await supabase
      .from("debts")
      .update({ tracking_enabled: false, updated_at: new Date().toISOString() })
      .eq("household_id", householdId)
      .eq("subcategory_id", debtSubcategoryId);
  }

  const row = {
    account_id: accountId,
    household_id: householdId,
    rewards_category: ["travel", "hotel"].includes(String(formData.get("rewardsCategory") ?? "")) ? String(formData.get("rewardsCategory")) : null,
    rewards_program: optText("rewardsProgram"),
    points_value_micros: optMicros("pointsValue"),
    five24_countable: formData.get("five24Countable") === "on",
    bank: optText("bank"),
    auth_user: optText("authUser"),
    charging: optText("charging"),
    bonus_info: optText("bonusInfo"),
    bonus_spend_cents: optCents("bonusSpend"),
    bonus_spend_deadline: optDate("bonusDeadline"),
    bonus_earned: formData.get("bonusEarned") === "on",
    current_points: optInt("currentPoints"),
    fees_paid_cents: optCents("feesPaid") ?? 0,
    free_night_credit_cents: optCents("freeNightCredit"),
    free_night_expires_on: optDate("freeNightExpires"),
    free_night_points_limit: optInt("freeNightPointsLimit") || null,
    benefit_used_on: optDate("benefitUsedOn"),
    spending_limit_cents: optCents("spendingLimit"),
    remarks: optText("remarks"),
    card_url: optText("cardUrl"),
    benefit_cadence: optText("benefitCadence"),
    is_revolving_debt: trackAsPayoffDebt,
    debt_subcategory_id: debtSubcategoryId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("credit_card_details").upsert(row, { onConflict: "account_id" });
  if (error) {
    console.error("[upsertCardDetails]", error);
    // Migration 0026 adds benefit_used_on + free_night_points_limit — if those
    // columns aren't in the schema yet, retry without them so other fields save.
    if (error.code === "PGRST204") {
      const rowWithout = { ...row } as Record<string, unknown>;
      delete rowWithout.benefit_used_on;
      delete rowWithout.free_night_points_limit;
      delete rowWithout.rewards_category;
      delete rowWithout.rewards_program;
      delete rowWithout.points_value_micros;
      delete rowWithout.five24_countable;
      const { error: e2 } = await supabase
        .from("credit_card_details")
        .upsert(rowWithout, { onConflict: "account_id" });
      if (e2) {
        console.error("[upsertCardDetails] retry failed", e2);
        return { error: "Couldn't save — " + e2.message };
      }
      revalidate();
      return { error: null, missingMigration: true };
    }
    return { error: "Couldn't save — " + error.message };
  }
  revalidate();
  return { error: null };
}


// Surgical single-field update for the inline-edit UI on Accounts → Credit Cards.
// Never touches other columns, so an empty save can't wipe adjacent data (which
// upsertCardDetails would, since that action rewrites the whole row).
export async function updateCardField(input: {
  accountId: string;
  field: string;
  value: string;
}): Promise<{ error?: string; ok?: true }> {
  const { supabase, householdId } = await requireHousehold();
  const { accountId, field, value } = input;
  if (!accountId || !field) return { error: "Missing field." };

  const { data: cardAccount } = await supabase
    .from("accounts")
    .select("id, kind")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!cardAccount || cardAccount.kind !== "credit_card") return { error: "Card not found." };

  const raw = value.trim();
  const asCentsOrNull = () => (raw ? displayToCents(raw) : null);
  const asIntOrNull = () => {
    if (!raw) return null;
    const n = parseInt(raw.replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  };
  const asDateOrNull = () => (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
  const asTextOrNull = () => raw || null;
  const asBool = () => raw === "true" || raw === "on" || raw === "1";

  // Fields that live on the accounts table.
  const accountUpdates: Record<string, unknown> = {};
  switch (field) {
    case "name":
      if (!raw) return { error: "Card name is required." };
      accountUpdates.name = raw;
      break;
    case "holder":
      accountUpdates.holder = asTextOrNull();
      break;
    case "institution":
      accountUpdates.institution = asTextOrNull();
      break;
    case "dateOpened":
      accountUpdates.date_opened = asDateOrNull();
      break;
    case "dateClosed":
      accountUpdates.date_closed = asDateOrNull();
      break;
    case "annualFee":
      accountUpdates.annual_fee_cents = asCentsOrNull();
      break;
    case "feeWaived":
      accountUpdates.fee_waived = asBool();
      break;
  }
  if (Object.keys(accountUpdates).length > 0) {
    const { error } = await supabase
      .from("accounts")
      .update({ ...accountUpdates, updated_at: new Date().toISOString() })
      .eq("id", accountId)
      .eq("household_id", householdId);
    if (error) return { error: "Couldn't save — " + error.message };
    revalidate();
    return { ok: true };
  }

  // Fields that live on the credit_card_details table.
  const detailUpdates: Record<string, unknown> = {};
  switch (field) {
    case "bank":
      detailUpdates.bank = asTextOrNull();
      break;
    case "authUser":
      detailUpdates.auth_user = asTextOrNull();
      break;
    case "charging":
      detailUpdates.charging = asTextOrNull();
      break;
    case "currentPoints":
      detailUpdates.current_points = asIntOrNull() ?? 0;
      break;
    case "spendingLimit":
      detailUpdates.spending_limit_cents = asCentsOrNull();
      break;
    case "cardUrl":
      detailUpdates.card_url = asTextOrNull();
      break;
    case "rewardsCategory":
      detailUpdates.rewards_category = ["travel", "hotel"].includes(raw) ? raw : null;
      break;
    case "remarks":
      detailUpdates.remarks = asTextOrNull();
      break;
    default:
      return { error: `Unknown field: ${field}` };
  }

  // Upsert requires household_id + account_id since the row may not exist yet.
  const { error } = await supabase
    .from("credit_card_details")
    .upsert(
      {
        account_id: accountId,
        household_id: householdId,
        ...detailUpdates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
  if (error) return { error: "Couldn't save — " + error.message };
  revalidate();
  return { ok: true };
}


// Pay a credit card: one transaction row that debits the source bank AND
// (via paid_to_account_id) reduces the card's auto-computed "owed" tally.
// For revolving cards with a linked debt subcategory, also lowers that debt.
export async function payCard(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const cardId = String(formData.get("cardId") ?? "");
  const sourceAccountId = String(formData.get("sourceAccountId") ?? "");
  const bucketId = String(formData.get("bucketId") ?? "").trim() || null;
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const dateStr = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!cardId) return { error: "Missing card." };
  if (!sourceAccountId) return { error: "Pick a source account." };
  if (amountCents <= 0) return { error: "Enter a payment amount." };

  // Insert one transaction: account_id = source (debit), paid_to_account_id =
  // card (reduces owed). subcategory_id stays null — CC payments aren't
  // budget-category spending; the original charges already were.
  const { error: txError } = await supabase.from("transactions").insert({
    household_id: householdId,
    account_id: sourceAccountId,
    paid_to_account_id: cardId,
    amount_cents: amountCents,
    occurred_on: dateStr,
    memo: notes,
    is_withdrawal: false,
  });
  if (txError) return { error: "Couldn't record the payment — please try again." };

  // Debit the source: prefer bucket if the source has buckets, else account.
  if (bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, -amountCents);
  } else {
    await adjustAccountLedger(supabase, householdId, sourceAccountId, -amountCents);
  }

  // If this card is revolving-debt and linked to a debt subcategory, also
  // decrement that debt balance so Budget/Net Worth stay honest.
  const { data: details } = await supabase
    .from("credit_card_details")
    .select("is_revolving_debt, debt_subcategory_id")
    .eq("account_id", cardId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (details?.is_revolving_debt && details.debt_subcategory_id) {
    await adjustDebtBalance(supabase, householdId, details.debt_subcategory_id, -amountCents);
  }

  await captureSnapshots(supabase, householdId);
  revalidate();
  revalidatePath("/transactions");
  return { error: null };
}

// ---- Buckets: virtual sinking funds inside one account (Amex Savings case) ----

export async function addBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  const bankGroupRaw = String(formData.get("bankGroup") ?? "");
  const bankGroup = bankGroupRaw === "savings" || bankGroupRaw === "spending" ? bankGroupRaw : null;
  if (!accountId) return { error: "Missing account." };
  if (!name) return { error: "Bucket name is required." };

  const { data: maxRow } = await supabase
    .from("buckets")
    .select("sort_order")
    .eq("account_id", accountId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("buckets").insert({
    household_id: householdId,
    account_id: accountId,
    name,
    balance_cents: balanceCents,
    sort_order: sortOrder,
    bank_group: bankGroup,
  });

  if (error) {
    return {
      error: error.code === "23505"
        ? `This account already has a bucket named "${name}". Pick a different name.`
        : "Couldn't save that bucket — please try again.",
    };
  }

  await syncAccountFromBuckets(supabase, householdId, accountId);
  await captureSnapshots(supabase, householdId);
  revalidate();
  return { error: null };
}

export async function updateBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Bucket name is required." };

  const { error } = await supabase
    .from("buckets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  if (error) {
    return {
      error: error.code === "23505"
        ? `This account already has a bucket named "${name}". Pick a different name.`
        : "Couldn't rename that bucket — please try again.",
    };
  }

  revalidate();
  return { error: null };
}

// Persist a manual reorder of one account's buckets — `orderedIds` is that
// account's bucket ids in their new top-to-bottom order.
export async function reorderBuckets(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { error: null };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("buckets")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: `Couldn't save the new order — ${failed.error.message}` };
  }

  revalidate();
  return { error: null };
}

// Lets one bucket carry its own Checking/Savings tag — e.g. an account with
// both a "Checking" and a "Savings" bucket no longer has to force the whole
// account into one type.
export async function updateBucketBankGroup(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const bankGroupRaw = String(formData.get("bankGroup") ?? "");
  const bankGroup = bankGroupRaw === "savings" || bankGroupRaw === "spending" ? bankGroupRaw : null;

  await supabase
    .from("buckets")
    .update({ bank_group: bankGroup, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

export async function updateBucketBalance(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const { data: bucket } = await supabase
    .from("buckets")
    .update({ balance_cents: balanceCents, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId)
    .select("account_id")
    .single();

  if (bucket) await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
  await captureSnapshots(supabase, householdId);
  revalidate();
}

export async function deleteBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: bucket } = await supabase
    .from("buckets")
    .select("account_id")
    .eq("id", id)
    .eq("household_id", householdId)
    .single();

  // bucket_snapshots cascade-delete with the bucket.
  await supabase
    .from("buckets")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  if (bucket) await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
  await captureSnapshots(supabase, householdId);
  revalidate();
}
