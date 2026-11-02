import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfAny, unwrap } from "@/lib/supabase-result";
import { buildClosePlan, type CloseChange, type CloseChangeRow, type CloseContext, type ClosePlan } from "@/lib/close-adjustments";

export type LoadedClosePlan = ClosePlan & { context: CloseContext; changeIds: string[] };

// The changes still waiting on an answer, worked out against today's saved
// closes. `onlyIds` holds Update to exactly what the popup showed, so a change
// arriving while it's open can't be written without being seen.
export async function loadClosePlan(
  supabase: SupabaseClient,
  householdId: string,
  currentMonth: string,
  onlyIds?: string[],
): Promise<LoadedClosePlan | null> {
  let query = supabase
    .from("closed_month_changes")
    .select("id, old_row, new_row, changed_at")
    .eq("household_id", householdId)
    .is("resolved_at", null);
  if (onlyIds) query = query.in("id", onlyIds);
  const rows = unwrap(await query.order("changed_at"), "closed month changes") ?? [];
  // Most page loads stop here, at one small read.
  if (rows.length === 0) return null;

  const changes: CloseChange[] = rows.map((r) => ({
    id: r.id as string,
    oldRow: (r.old_row as CloseChangeRow | null) ?? null,
    newRow: (r.new_row as CloseChangeRow | null) ?? null,
    changedAt: r.changed_at as string,
  }));
  const earliest = changes
    .flatMap((c) => [c.oldRow?.occurred_on, c.newRow?.occurred_on])
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const firstMonth = `${earliest.slice(0, 7)}-01`;
  const payeeIds = [
    ...new Set(changes.flatMap((c) => [c.oldRow?.payee_id, c.newRow?.payee_id]).filter((id): id is string => Boolean(id))),
  ];

  const [accounts, buckets, categories, subs, accountSnaps, bucketSnaps, payees] = await Promise.all([
    supabase.from("accounts").select("id, name, kind").eq("household_id", householdId),
    supabase.from("buckets").select("id, account_id, name").eq("household_id", householdId),
    supabase.from("categories").select("id, kind").eq("household_id", householdId),
    supabase.from("subcategories").select("id, linked_bucket_id, linked_account_id").eq("household_id", householdId),
    supabase
      .from("account_snapshots")
      .select("month, account_id, balance_cents, updated_at")
      .eq("household_id", householdId)
      .gte("month", firstMonth)
      .lt("month", currentMonth),
    supabase
      .from("bucket_snapshots")
      .select("month, bucket_id, balance_cents, updated_at")
      .eq("household_id", householdId)
      .gte("month", firstMonth)
      .lt("month", currentMonth),
    payeeIds.length
      ? supabase.from("payees").select("id, name").in("id", payeeIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  throwIfAny({
    accounts: accounts.error,
    buckets: buckets.error,
    categories: categories.error,
    subcategories: subs.error,
    "account closes": accountSnaps.error,
    "bucket closes": bucketSnaps.error,
    payees: payees.error,
  });

  const context: CloseContext = {
    accounts: (accounts.data ?? []).map((a) => ({ id: a.id as string, name: a.name as string, kind: a.kind as string })),
    buckets: (buckets.data ?? []).map((b) => ({ id: b.id as string, accountId: b.account_id as string, name: b.name as string })),
    categoryKind: new Map((categories.data ?? []).map((c) => [c.id as string, c.kind as string])),
    subLinks: new Map(
      (subs.data ?? []).map((s) => [
        s.id as string,
        { linkedBucketId: (s.linked_bucket_id as string | null) ?? null, linkedAccountId: (s.linked_account_id as string | null) ?? null },
      ]),
    ),
    payeeNames: new Map((payees.data ?? []).map((p) => [p.id as string, p.name as string])),
    accountSnapshots: (accountSnaps.data ?? []).map((s) => ({
      month: s.month as string,
      targetId: s.account_id as string,
      balanceCents: (s.balance_cents as number) ?? 0,
      updatedAt: s.updated_at as string,
    })),
    bucketSnapshots: (bucketSnaps.data ?? []).map((s) => ({
      month: s.month as string,
      targetId: s.bucket_id as string,
      balanceCents: (s.balance_cents as number) ?? 0,
      updatedAt: s.updated_at as string,
    })),
  };

  return { ...buildClosePlan(changes, context, currentMonth), context, changeIds: changes.map((c) => c.id) };
}
