import type { SupabaseClient } from "@supabase/supabase-js";
import { kidMoveBlock, kidTypeOf } from "./kids-funding";
import { throwIfAny } from "./supabase-result";

type Side = { accountId: string; bucketId: string | null };

/**
 * Whether the law lets this money move, for any path that takes money out of an
 * account (Move Money's transfer and withdrawal). Null for every account that
 * isn't Kids Funding, so household moves pay one small read and nothing else.
 */
export async function kidMoveBlockFor(
  supabase: SupabaseClient,
  householdId: string,
  from: Side,
  to: Side,
): Promise<string | null> {
  const accountIds = [from.accountId, to.accountId];
  const bucketIds = [from.bucketId, to.bucketId].filter((id): id is string => !!id);
  const [
    { data: accounts, error: accountsError },
    { data: buckets, error: bucketsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, is_kids_account, subtype, retirement_kind, kid_id")
      .eq("household_id", householdId)
      .in("id", accountIds),
    supabase
      .from("buckets")
      .select("id, subtype, retirement_kind, kid_id")
      .eq("household_id", householdId)
      .in("id", bucketIds.length > 0 ? bucketIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  throwIfAny({ accounts: accountsError, buckets: bucketsError });

  const account = (id: string) => (accounts ?? []).find((a) => a.id === id);
  const bucket = (id: string | null) => (buckets ?? []).find((b) => b.id === id);
  const fromAccount = account(from.accountId);
  if (!fromAccount?.is_kids_account) return null;

  const fromBucket = bucket(from.bucketId);
  const toAccount = account(to.accountId);
  const toBucket = bucket(to.bucketId);
  const fromKidId = (fromBucket?.kid_id ?? fromAccount.kid_id ?? null) as string | null;
  const toKidId = toAccount?.is_kids_account ? ((toBucket?.kid_id ?? toAccount.kid_id ?? null) as string | null) : null;

  let kid: { name: string; birth_month: string } | null = null;
  if (fromKidId) {
    const { data, error } = await supabase
      .from("kids")
      .select("name, birth_month")
      .eq("id", fromKidId)
      .eq("household_id", householdId)
      .maybeSingle();
    throwIfAny({ kids: error });
    kid = data;
  }

  return kidMoveBlock({
    fromType: kidTypeOf(fromBucket?.subtype ?? fromAccount.subtype, fromBucket?.retirement_kind ?? fromAccount.retirement_kind),
    fromKidId,
    fromKidName: kid?.name ?? null,
    fromBirthMonth: kid?.birth_month ?? null,
    toKidId,
    today: new Date().toISOString().slice(0, 10),
  });
}
