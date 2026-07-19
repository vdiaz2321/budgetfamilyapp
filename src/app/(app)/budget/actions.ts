"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { adjustBucketBalance } from "@/lib/buckets";
import { adjustDebtBalance } from "@/lib/debts";
import { adjustAccountLedger, categoryKindOf, ledgerDelta } from "@/lib/account-ledger";

// The bucket a Savings subcategory contributes to, if any linked — null when
// not a savings item or not linked, so callers can skip the bucket math.
async function getLinkedBucketId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("subcategories")
    .select("linked_bucket_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  return data?.linked_bucket_id ?? null;
}

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

// ---------- Planned amounts (per subcategory per month) ----------

export async function upsertPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  if (!subcategoryId || !month) return;

  const plannedCents = displayToCents(String(formData.get("planned") ?? "0"));

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
}

// ---------- Subcategories (the budget rows) ----------

export async function addSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const categoryId = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue ? Math.min(31, Math.max(1, parseInt(rawDue, 10))) : null;

  const { data: siblings } = await supabase
    .from("subcategories")
    .select("sort_order")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort = (siblings?.[0]?.sort_order ?? -1) + 1;

  await supabase.from("subcategories").insert({
    household_id: householdId,
    category_id: categoryId,
    name,
    due_day: dueDay,
    sort_order: nextSort,
  });

  revalidatePath("/budget");
}

export async function updateSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));

  await supabase
    .from("subcategories")
    .update({ name, due_day: dueDay })
    .eq("id", id)
    .eq("household_id", householdId);

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
}

// Links (or unlinks) a Savings item to a real bucket in Accounts. Once
// linked, transactions logged under this item add straight to the bucket's
// balance — no re-typing the contribution over on Accounts.
export async function updateSavingsLink(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  let bucketId: string | null = null;
  if (bucketIdRaw) {
    const { data: bucket } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    bucketId = bucket?.id ?? null;
  }

  await supabase
    .from("subcategories")
    .update({ linked_bucket_id: bucketId })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// Combined save for the Savings panel: goal fields + bucket link in one
// action, so there's a single Save button instead of two.
export async function upsertSavingsGoalAndLink(formData: FormData) {
  await upsertSavingsGoal(formData);
  await updateSavingsLink(formData);
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
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  // Manual balance edits stamp/clear paid_off_at the same way a payment does,
  // so a debt zeroed out here still drops off the Snowball page next year.
  const { data: existing } = await supabase
    .from("debts")
    .select("paid_off_at")
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  const paidOffAt =
    balanceCents <= 0 ? existing?.paid_off_at ?? new Date().toISOString().slice(0, 10) : null;

  await supabase.from("debts").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      current_balance_cents: balanceCents,
      paid_off_at: paidOffAt,
      min_payment_cents: minPaymentCents,
      apr: Number.isNaN(apr) ? 0 : apr,
      due_day: dueDay,
      debt_kind: debtKind,
      notes,
      promo_apr_ends_on: promoAprEndsOn,
      account_id: accountId,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  // Keep subcategories.due_day in sync — the budget row list badge and the
  // Rename form read from there, not from debts.due_day. Without this, the
  // due day set here silently didn't show up anywhere else.
  await supabase
    .from("subcategories")
    .update({ due_day: dueDay })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidatePath("/budget");
}

// Combined save for the Debt panel: planned amount + debt details in one
// action, so there's a single Save button instead of two.
export async function upsertDebtAndPlan(formData: FormData) {
  await upsertPlan(formData);
  await upsertDebt(formData);
}

// ---------- Transactions (the Log, right rail) ----------

export async function addTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  if (!subcategoryId || !occurredOn || amountCents <= 0) return;

  // Keep category_id consistent with the chosen subcategory.
  const { data: sub } = await supabase
    .from("subcategories")
    .select("category_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!sub) return;

  let payeeId: string | null = null;
  if (payeeName) {
    const { data: payee } = await supabase
      .from("payees")
      .upsert(
        { household_id: householdId, name: payeeName },
        { onConflict: "household_id,name" },
      )
      .select("id")
      .single();
    payeeId = payee?.id ?? null;
  }

  // Only attach the account if it belongs to this household.
  let accountId: string | null = null;
  if (accountIdRaw) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    category_id: sub.category_id,
    subcategory_id: subcategoryId,
    payee_id: payeeId,
    account_id: accountId,
    memo,
    is_withdrawal: isWithdrawal,
    source: "manual",
  });

  // A contribution adds to the linked bucket; a withdrawal (e.g. using the
  // Real Estate bucket for a down payment) subtracts from it instead.
  const bucketId = await getLinkedBucketId(supabase, householdId, subcategoryId);
  if (bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId);
  }

  // A payment logged against a debt lowers its outstanding balance.
  const touchedDebt = await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents);
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId);
    revalidatePath("/snowball");
  }

  // Post to the chosen account's running ledger (income adds, everything
  // else spends out) — skipped for investment/bucketed accounts, which stay
  // manual.
  if (accountId) {
    const kind = await categoryKindOf(supabase, sub.category_id);
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(kind, amountCents))) {
      await captureSnapshots(supabase, householdId);
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

export async function updateTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  if (!id || !subcategoryId || !occurredOn || amountCents <= 0) return;

  // Snapshot the pre-edit values so we can undo their bucket effect below —
  // the old subcategory/amount/direction may differ from the new ones.
  const { data: prevTx } = await supabase
    .from("transactions")
    .select("subcategory_id, category_id, account_id, amount_cents, is_withdrawal")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

  const { data: sub } = await supabase
    .from("subcategories")
    .select("category_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!sub) return;

  let payeeId: string | null = null;
  if (payeeName) {
    const { data: payee } = await supabase
      .from("payees")
      .upsert(
        { household_id: householdId, name: payeeName },
        { onConflict: "household_id,name" },
      )
      .select("id")
      .single();
    payeeId = payee?.id ?? null;
  }

  let accountId: string | null = null;
  if (accountIdRaw) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  await supabase
    .from("transactions")
    .update({
      occurred_on: occurredOn,
      amount_cents: amountCents,
      category_id: sub.category_id,
      subcategory_id: subcategoryId,
      payee_id: payeeId,
      account_id: accountId,
      memo,
      is_withdrawal: isWithdrawal,
    })
    .eq("id", id)
    .eq("household_id", householdId);

  // Undo the old transaction's bucket effect (it may have hit a different
  // bucket, or none at all), then apply the new one's.
  let touchedBucket = false;
  if (prevTx) {
    const prevBucketId = await getLinkedBucketId(supabase, householdId, prevTx.subcategory_id);
    if (prevBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevBucketId, undoDelta);
      touchedBucket = true;
    }
  }
  const bucketId = await getLinkedBucketId(supabase, householdId, subcategoryId);
  if (bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  if (touchedBucket) await captureSnapshots(supabase, householdId);

  // Undo the old payment's effect on its debt balance, then apply the new one's
  // — the edit may have changed the amount or moved it off/onto a debt entirely.
  let touchedDebt = false;
  if (prevTx) {
    touchedDebt = await adjustDebtBalance(supabase, householdId, prevTx.subcategory_id, prevTx.amount_cents);
  }
  if (await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents)) touchedDebt = true;
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId);
    revalidatePath("/snowball");
  }

  // Undo the old posting to its account (may be a different account than the
  // new one, or none), then post the new one.
  let touchedAccount = false;
  if (prevTx?.account_id) {
    const prevKind = prevTx.category_id ? await categoryKindOf(supabase, prevTx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, prevTx.account_id, -ledgerDelta(prevKind, prevTx.amount_cents))) {
      touchedAccount = true;
    }
  }
  if (accountId) {
    const kind = await categoryKindOf(supabase, sub.category_id);
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(kind, amountCents))) {
      touchedAccount = true;
    }
  }
  if (touchedAccount) await captureSnapshots(supabase, householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

export async function deleteTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: tx } = await supabase
    .from("transactions")
    .select("subcategory_id, category_id, account_id, amount_cents, is_withdrawal")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

  await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  if (tx?.subcategory_id) {
    const bucketId = await getLinkedBucketId(supabase, householdId, tx.subcategory_id);
    if (bucketId) {
      const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
      await adjustBucketBalance(supabase, householdId, bucketId, undoDelta);
      await captureSnapshots(supabase, householdId);
    }

    // Deleting a debt payment adds its amount back to the outstanding balance.
    if (await adjustDebtBalance(supabase, householdId, tx.subcategory_id, tx.amount_cents)) {
      await captureSnapshots(supabase, householdId);
      revalidatePath("/snowball");
    }
  }

  if (tx?.account_id) {
    const kind = tx.category_id ? await categoryKindOf(supabase, tx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, tx.account_id, -ledgerDelta(kind, tx.amount_cents))) {
      await captureSnapshots(supabase, householdId);
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
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

  await supabase
    .from("transactions")
    .update({ cleared: formData.get("cleared") === "true" })
    .eq("id", id)
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
