// How a holding is taxed — the one definition, shared by /invest (which
// displays the split) and /accounts (which lets you correct it).
//
// This used to live privately inside invest-board.tsx, which was fine while
// only one page cared. The moment Accounts needed to show "Auto (Tax-free)"
// next to a dropdown, a second copy would have been born — and a second copy
// of a rule is how /savings and /invest ended up disagreeing about
// contributions. One copy, imported twice.

export type TaxTreatment = "taxable" | "deferred" | "free" | "education";

export const TAX_TREATMENTS: TaxTreatment[] = ["taxable", "deferred", "free", "education"];

export const TAX_LABEL: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  deferred: "Tax-deferred",
  free: "Tax-free",
  education: "Education",
};

/**
 * Compact labels for the tight inline editor on Accounts, where a bucket row
 * gives the control ~85px between the name and the balance column. The full
 * labels clip there; "Tax-deferred" in particular loses its last characters.
 * Display surfaces (the /invest bands) keep TAX_LABEL.
 */
export const TAX_LABEL_SHORT: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  deferred: "Deferred",
  free: "Tax-free",
  education: "Education",
};

// What each band actually means, in plain English. Shown when a band is
// opened, because "tax-deferred" vs "tax-free" is the exact pair people mix up
// — and the answer decides which account the next dollar should go to.
export const TAX_MEANING: Record<TaxTreatment, string> = {
  taxable: "Already-taxed money. You owe tax on dividends and on gains when you sell.",
  deferred: "Goes in before tax and grows untaxed. You pay income tax on withdrawals in retirement.",
  free: "Goes in after tax and grows untaxed. Qualified withdrawals in retirement are not taxed at all.",
  education: "Grows untaxed. Withdrawals are tax-free when spent on qualified education costs.",
};

// Cool tokens only, per the project's no-purple/no-orange rule for data.
export const TAX_COLOR: Record<TaxTreatment, string> = {
  taxable: "var(--viz-expenses)",
  deferred: "var(--viz-income)",
  free: "var(--viz-bills)",
  education: "var(--viz-savings)",
};

/** Narrow an arbitrary string (a DB enum value, a form field) to a treatment. */
export function asTaxTreatment(value: string | null | undefined): TaxTreatment | null {
  return value && (TAX_TREATMENTS as string[]).includes(value)
    ? (value as TaxTreatment)
    : null;
}

/**
 * Guess a treatment from a name or subtype. Null when nothing matches, so the
 * caller can fall through to a less specific source.
 *
 * Order matters: "TSP Roth" has to read as Roth, not as TSP, so the tax-free
 * test runs before the tax-deferred one.
 */
export function classifyTax(label: string | null | undefined): TaxTreatment | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/\b529\b|utma|ugma|coverdell/.test(s)) return "education";
  if (/roth/.test(s)) return "free";
  if (/401|403b|tsp|traditional|sep|simple|\bira\b|pension/.test(s)) return "deferred";
  if (/taxable|brokerage|reit|crypto|individual/.test(s)) return "taxable";
  return null;
}

export type TaxSource = "bucket" | "bucketName" | "account" | "accountSubtype" | "default";

/**
 * The treatment for one holding, and where the answer came from.
 *
 * Most specific wins:
 *   1. the bucket's own stored override
 *   2. the bucket's name
 *   3. the account's stored override
 *   4. the account's subtype
 *   5. taxable
 *
 * Step 2 deliberately beats step 3. An account-level override is a statement
 * about the container, so it sets the default for buckets that say nothing
 * about themselves — but it must not silently reclassify a bucket that names
 * its own treatment. Setting Fidelity to "taxable" should not flip the two
 * Roth buckets sitting inside it.
 */
export function resolveTaxTreatment(input: {
  bucketOverride?: string | null;
  bucketName?: string | null;
  accountOverride?: string | null;
  accountSubtype?: string | null;
}): { treatment: TaxTreatment; source: TaxSource } {
  const bucketOverride = asTaxTreatment(input.bucketOverride);
  if (bucketOverride) return { treatment: bucketOverride, source: "bucket" };

  const byBucketName = classifyTax(input.bucketName);
  if (byBucketName) return { treatment: byBucketName, source: "bucketName" };

  const accountOverride = asTaxTreatment(input.accountOverride);
  if (accountOverride) return { treatment: accountOverride, source: "account" };

  const bySubtype = classifyTax(input.accountSubtype);
  if (bySubtype) return { treatment: bySubtype, source: "accountSubtype" };

  return { treatment: "taxable", source: "default" };
}

/**
 * What the treatment WOULD be with the override at this level cleared — i.e.
 * what "Auto" resolves to. Powers the "Auto (Tax-free)" option label, so the
 * guess is visible and you only override when it's actually wrong.
 */
export function autoTaxTreatment(input: {
  bucketName?: string | null;
  accountOverride?: string | null;
  accountSubtype?: string | null;
  /** Set for an account-level control, where no bucket is in play. */
  accountLevel?: boolean;
}): TaxTreatment {
  if (input.accountLevel) {
    return classifyTax(input.accountSubtype) ?? "taxable";
  }
  return resolveTaxTreatment({
    bucketName: input.bucketName,
    accountOverride: input.accountOverride,
    accountSubtype: input.accountSubtype,
  }).treatment;
}
