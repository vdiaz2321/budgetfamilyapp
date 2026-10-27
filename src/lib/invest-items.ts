import type { InvestItem } from "@/app/(app)/accounts/types";

type SubRow = {
  id: string;
  name: string;
  active: boolean | null;
  linked_bucket_id: string | null;
  linked_account_id: string | null;
  categories: { kind: string } | { kind: string }[] | null;
};

/**
 * Invest/Savings items tied to a fund: where Move Money can send money from a
 * bank. Each names the fund's account, which is also the payee the Budget's
 * own entries use ("Fidelity", "TSP").
 */
export function investItemsFrom(
  subs: SubRow[],
  buckets: { id: string; account_id: string }[],
): InvestItem[] {
  const bucketAccount = new Map(buckets.map((b) => [b.id, b.account_id]));
  return subs.flatMap((s) => {
    const cat = Array.isArray(s.categories) ? s.categories[0] : s.categories;
    if (cat?.kind !== "savings" || s.active === false) return [];
    const accountId = (s.linked_bucket_id ? bucketAccount.get(s.linked_bucket_id) : null) ?? s.linked_account_id;
    return accountId ? [{ subId: s.id, name: s.name, accountId }] : [];
  });
}
