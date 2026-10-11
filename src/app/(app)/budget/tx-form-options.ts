"use server";

import { getSessionContext } from "@/lib/auth-context";
import { resolveMonth } from "@/lib/month";
import { loadTxFormData, type TxFormOptions } from "@/lib/tx-form-options";
import { throwIfAny } from "@/lib/supabase-result";
import { attachSplitParts } from "@/lib/split-parts";
import type { CategoryKind } from "@/lib/categories";
import type { TxData } from "./types";

// The transaction modal's pickers for a page that opens the modal without
// loading them up front (Travel Log's "Add transaction"). Fetched when the
// button is tapped, so the page itself loads no slower.
export async function loadTxFormOptions(): Promise<TxFormOptions & { month: { key: string; firstOfMonth: string } }> {
  const { supabase, household } = await getSessionContext();
  const month = resolveMonth(undefined);
  const { options } = await loadTxFormData(supabase, household.id, month.firstOfMonth);
  return { ...options, month: { key: month.key, firstOfMonth: month.firstOfMonth } };
}

// One saved transaction, shaped for the edit form — for a page that opens a
// single purchase on demand (a booking's Spent on Travel Log) rather than
// loading a whole month of them. A split part comes back with the whole split.
export async function loadTransactionForEdit(id: string): Promise<TxData> {
  const { supabase, household } = await getSessionContext();
  const select =
    "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, bucket_id, property_id, trip_id, travel_category, travel_stay_id, travel_flight_id, travel_car_id, paid_to_account_id, paid_to_bucket_id, movement_type, cleared, is_withdrawal, split_group_id";
  const { data: row, error } = await supabase
    .from("transactions")
    .select(select)
    .eq("household_id", household.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("That transaction no longer exists.");

  const siblings = row.split_group_id
    ? await supabase
        .from("transactions")
        .select(select)
        .eq("household_id", household.id)
        .eq("split_group_id", row.split_group_id)
        .order("created_at", { ascending: true })
    : null;
  if (siblings?.error) throw siblings.error;
  const rows = siblings?.data?.length ? siblings.data : [row];

  const subIds = [...new Set(rows.map((r) => r.subcategory_id).filter(Boolean) as string[])];
  const [subs, payee, accounts, categories] = await Promise.all([
    subIds.length
      ? supabase.from("subcategories").select("id, name, category_id").in("id", subIds)
      : Promise.resolve({ data: [], error: null }),
    row.payee_id
      ? supabase.from("payees").select("name").eq("id", row.payee_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("accounts").select("id, name, kind").eq("household_id", household.id),
    supabase.from("categories").select("id, kind").eq("household_id", household.id),
  ]);
  throwIfAny({ subs: subs.error, payee: payee.error, accounts: accounts.error, categories: categories.error });
  const kindByCat = new Map((categories.data ?? []).map((c) => [c.id as string, c.kind as CategoryKind]));

  const subById = new Map(
    (subs.data ?? []).map((s) => [s.id as string, { name: s.name as string, kind: kindByCat.get(s.category_id as string) ?? null }]),
  );
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id as string, a]));

  // The same shaping as the Transactions page's rows.
  const toTx = (t: typeof row): TxData => {
    const movementType = t.movement_type ?? (
      t.paid_to_account_id
        ? accountById.get(t.paid_to_account_id)?.kind === "credit_card"
          ? "card_payment"
          : accountById.get(t.account_id ?? "")?.kind === "investment"
            ? "investment_transfer"
            : "account_transfer"
        : null
    );
    const sub = t.subcategory_id ? subById.get(t.subcategory_id) : undefined;
    return {
      id: t.id,
      date: t.occurred_on,
      amountCents: t.amount_cents,
      memo: t.memo,
      payee: t.paid_to_account_id
        ? accountById.get(t.paid_to_account_id)?.name ?? "Destination account"
        : (payee.data?.name as string | undefined) ?? null,
      subId: t.subcategory_id ?? null,
      subName: sub?.name ?? "Uncategorized",
      accountId: t.account_id ?? null,
      propertyId: t.property_id ?? null,
      tripId: t.trip_id ?? null,
      travelCategory: t.travel_category ?? null,
      bookingRef: t.travel_stay_id ? `stay:${t.travel_stay_id}` : t.travel_flight_id ? `flight:${t.travel_flight_id}` : t.travel_car_id ? `car:${t.travel_car_id}` : null,
      toAccountId: t.paid_to_account_id ?? null,
      fromBucketId: t.bucket_id ?? null,
      toBucketId: t.paid_to_bucket_id ?? null,
      kind: sub?.kind ?? null,
      movementType,
      isCardPayment: movementType === "card_payment",
      isTransfer: movementType === "account_transfer",
      isInvestmentTransfer: movementType === "investment_transfer",
      cleared: t.cleared ?? false,
      isWithdrawal: t.is_withdrawal ?? false,
      splitGroupId: t.split_group_id ?? null,
    };
  };
  const all = attachSplitParts(rows.map(toTx));
  return all.find((t) => t.id === id) ?? toTx(row);
}
