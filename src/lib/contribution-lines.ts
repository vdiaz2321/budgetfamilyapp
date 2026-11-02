import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { contributionSlotOf, signedContributionCents } from "@/lib/fund-contributions";
import { throwIfAny } from "@/lib/supabase-result";

export type ContributionLine = {
  id: string;
  date: string;
  accountId: string;
  bucketId: string | null;
  holding: string;
  from: string | null;
  payee: string | null;
  cents: number;
};

type TxRow = {
  id: string;
  occurred_on: string;
  amount_cents: number;
  is_withdrawal: boolean;
  account_id: string | null;
  bucket_id: string | null;
  movement_type: string | null;
  subcategories: { linked_bucket_id: string | null; linked_account_id: string | null } | null;
  payees: { name: string } | null;
};

// Every transaction the contributions view counts, newest first, for the Contrib
// popup on Investments. It comes with the page so the popup opens with its rows
// already there: asking the server per click took over a second from Germany.
export async function loadContributionLines(supabase: SupabaseClient, householdId: string): Promise<ContributionLine[]> {
  const [accounts, buckets, subs] = await Promise.all([
    supabase.from("accounts").select("id, name, kind, is_kids_account").eq("household_id", householdId),
    supabase.from("buckets").select("id, account_id, name").eq("household_id", householdId),
    supabase
      .from("subcategories")
      .select("id")
      .eq("household_id", householdId)
      .or("linked_bucket_id.not.is.null,linked_account_id.not.is.null"),
  ]);
  throwIfAny({ accounts: accounts.error, buckets: buckets.error, subcategories: subs.error });

  const accountRows = accounts.data ?? [];
  const bucketRows = buckets.data ?? [];
  const accountName = new Map(accountRows.map((a) => [a.id as string, a.name as string]));
  const bucketName = new Map(bucketRows.map((b) => [b.id as string, b.name as string]));
  const accountIdByBucket = new Map(bucketRows.map((b) => [b.id as string, b.account_id as string]));
  const fundIds = accountRows.filter((a) => a.kind === "investment" || a.is_kids_account).map((a) => a.id as string);
  const fundAccounts = new Set(fundIds);
  const linkedSubIds = (subs.data ?? []).map((s) => s.id as string);

  // Narrows the read to what could count; contributionSlotOf has the last word.
  const filters = [
    "bucket_id.not.is.null",
    fundIds.length ? `account_id.in.(${fundIds.join(",")})` : null,
    linkedSubIds.length ? `subcategory_id.in.(${linkedSubIds.join(",")})` : null,
  ].filter(Boolean);

  const rows = await fetchAllRows<TxRow>((from, to) =>
    supabase
      .from("transactions")
      .select("id, occurred_on, amount_cents, is_withdrawal, account_id, bucket_id, movement_type, subcategories(linked_bucket_id, linked_account_id), payees(name)")
      .eq("household_id", householdId)
      .is("movement_type", null)
      .or(filters.join(","))
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: TxRow[] | null; error: { message: string } | null }>,
  );

  const lines: ContributionLine[] = [];
  for (const tx of rows) {
    const slot = contributionSlotOf(
      {
        account_id: tx.account_id,
        bucket_id: tx.bucket_id,
        movement_type: tx.movement_type,
        linked_bucket_id: tx.subcategories?.linked_bucket_id ?? null,
        linked_account_id: tx.subcategories?.linked_account_id ?? null,
      },
      (id) => fundAccounts.has(id),
      accountIdByBucket,
    );
    if (!slot) continue;
    lines.push({
      id: tx.id,
      date: tx.occurred_on,
      accountId: slot.accountId,
      bucketId: slot.bucketId,
      holding: (slot.bucketId ? bucketName.get(slot.bucketId) : accountName.get(slot.accountId)) ?? "Account",
      // Where the money came from; a row posted on the fund itself has no bank.
      from: tx.account_id && !fundAccounts.has(tx.account_id) ? accountName.get(tx.account_id) ?? null : null,
      payee: tx.payees?.name ?? null,
      cents: signedContributionCents(tx),
    });
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date) || a.holding.localeCompare(b.holding));
}
