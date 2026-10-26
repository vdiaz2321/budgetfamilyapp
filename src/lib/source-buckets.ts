// A bank account that holds buckets (Amex Savings → Real Estate, Emergency
// Fund, …) has no balance of its own — it is the sum of its buckets — so a
// payment out of it has to name the bucket the money left. These are the
// buckets the transaction modal offers as "From bucket", keyed by account.
//
// Investment accounts are left out: their buckets are the fund a contribution
// goes INTO (the modal's separate bucketsByAccount), not where money comes
// from. Property and loans hold no spendable money.
export type SourceBucketOption = { id: string; name: string };

export function sourceBucketsByAccount(
  accounts: { id: string; kind: string | null }[],
  buckets: { id: string; account_id: string; name: string }[],
): Map<string, SourceBucketOption[]> {
  const bankIds = new Set(
    accounts
      .filter((a) => a.kind !== "investment" && a.kind !== "property" && a.kind !== "debt_loan")
      .map((a) => a.id),
  );
  const byAccount = new Map<string, SourceBucketOption[]>();
  for (const b of buckets) {
    if (!bankIds.has(b.account_id)) continue;
    const list = byAccount.get(b.account_id) ?? [];
    list.push({ id: b.id, name: b.name });
    byAccount.set(b.account_id, list);
  }
  return byAccount;
}
