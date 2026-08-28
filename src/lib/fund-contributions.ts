// One definition of "how much went into this fund", shared by /savings and
// /invest.
//
// The two pages show the same funds from different angles — Savings asks
// "did I contribute what I planned this month?", Investments asks "what is it
// worth and how did it grow?" — but the contribution figure underneath is the
// same money, and it must be the same number. It wasn't: each page had grown
// its own copy of the netting rule, the period rule and the seed-vs-ledger
// rule, and the copies disagreed. For 2026 the same four funds read
//
//     Fidelity (Taxable)   Savings $2,138.63   Investments $4,877.26
//     Fidelity Roth Vic    Savings $4,198.00   Investments $7,813.00
//     Fidelity Roth Jo     Savings $3,600.00   Investments $6,700.00
//     TSP                  Savings $3,298.41   Investments $2,748.74
//
// — the first three because the Investments page added a hand-entered seed to
// the very ledger rows the seed was standing in for, the fourth because its
// account-linked goal never reached the ledger view at all.
//
// The rules below are the single copy. Both pages import them; neither
// reimplements them.

/** A savings subcategory's pointer at the thing it funds. */
export type FundLink = {
  linkedBucketId: string | null;
  linkedAccountId: string | null;
};

/** The (account, bucket) slot an investment figure is filed under. */
export type FundSlot = { accountId: string; bucketId: string | null };

/**
 * The contribution period is the calendar year — the same window on both
 * pages.
 *
 * Savings goals are annual targets (every `target_date` is a Dec 31, and each
 * 529's goal is exactly 12x its monthly), so a goal's period is the calendar
 * year its target falls in. Goals with no target date use the current year.
 * `v_investment_contributions` groups by `EXTRACT(year FROM occurred_on)`,
 * which is the same window — keep them that way.
 */
function contributionYearFor(targetDate: string | null, now: Date): number {
  return targetDate ? Number(targetDate.slice(0, 4)) : now.getFullYear();
}

/** First day of the contribution period, as a `YYYY-MM-DD` string. */
export function periodStartFor(targetDate: string | null, now: Date): string {
  return `${contributionYearFor(targetDate, now)}-01-01`;
}

/**
 * Signed value of one transaction toward a fund.
 *
 * Amounts are stored unsigned with the direction in `is_withdrawal`, so a
 * withdrawal subtracts. This mirrors `net_contribution_cents` in
 * `v_investment_contributions` exactly; if one changes, change both.
 */
export function signedContributionCents(tx: {
  amount_cents: number;
  is_withdrawal: boolean;
}): number {
  return tx.is_withdrawal ? -tx.amount_cents : tx.amount_cents;
}

/**
 * Key for one (account, bucket, year) slot.
 *
 * `"_"` stands in for the account-level slot so a bucket id and "no bucket"
 * can't collide.
 */
export function investSlotKey(
  accountId: string,
  bucketId: string | null,
  year: number,
): string {
  return `${accountId}:${bucketId ?? "_"}:${year}`;
}

/**
 * Which investment slot a savings goal's money lands in, or null when the goal
 * isn't linked to one.
 *
 * Bucket link wins over account link — it's the more specific of the two, and
 * it's the precedence `v_investment_contributions` uses when resolving the
 * same transaction. A goal linked to neither (an untracked fund) returns null
 * rather than guessing.
 */
export function fundSlotFor(
  link: FundLink,
  accountIdByBucket: Map<string, string>,
): FundSlot | null {
  if (link.linkedBucketId) {
    const accountId = accountIdByBucket.get(link.linkedBucketId);
    return accountId ? { accountId, bucketId: link.linkedBucketId } : null;
  }
  if (link.linkedAccountId) {
    return { accountId: link.linkedAccountId, bucketId: null };
  }
  return null;
}

/**
 * The contributed figure for one slot and year: ledger for the year in
 * progress, reviewed row for years already closed.
 *
 * `investment_years` is documented (0020_investment_performance.sql) as the
 * authoritative reviewed value, used when nothing can be derived live — not as
 * a base to accumulate on. So while a year is still open the transaction
 * ledger is the live truth and supersedes any seed standing in for it; once
 * the year is closed its reviewed row is the lock-in and stands.
 *
 * `hasLive` is presence, not amount: a slot whose deposits and withdrawals net
 * to zero is still covered by the ledger and must not fall back to the seed. A
 * slot with no ledger coverage at all keeps its stored value either way, so
 * hand-entered accounts don't drop to zero.
 */
export function resolveContributedCents(input: {
  storedCents: number | null;
  liveCents: number;
  hasLive: boolean;
  isCurrentYear: boolean;
}): number {
  const { storedCents, liveCents, hasLive, isCurrentYear } = input;
  if (isCurrentYear && hasLive) return liveCents;
  if (storedCents != null) return storedCents;
  return liveCents;
}
