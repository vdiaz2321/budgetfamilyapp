// Which annual contribution limit governs a holding — the one definition,
// shared by /accounts (which edits it) and /invest (which measures against it).
//
// Kept separate from lib/tax-treatment.ts on purpose. Tax treatment answers
// "how is the growth taxed" (taxable / deferred / free / education) and drives
// the "How it's taxed" bands. This answers "which IRS cap does a contribution
// here count against", and the two do not line up: a Roth IRA and a Roth TSP
// are both tax-FREE, but they are governed by completely different limits.

export type RetirementKind = "traditional_ira" | "roth_ira" | "elective_deferral";

/** Which cap a kind draws on. Traditional and Roth IRAs share one limit. */
export type CapKind = "ira" | "electiveDeferral";

export const RETIREMENT_KINDS: RetirementKind[] = [
  "traditional_ira",
  "roth_ira",
  "elective_deferral",
];

export const RETIREMENT_LABEL: Record<RetirementKind, string> = {
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  elective_deferral: "401(k) / TSP / 403(b) / 457",
};

/** Shown under the picker so the shared-limit rule isn't a surprise. */
export const RETIREMENT_HINT: Record<RetirementKind, string> = {
  traditional_ira: "Shares one annual limit with every other IRA the same person holds.",
  roth_ira: "Shares one annual limit with every other IRA the same person holds.",
  elective_deferral: "Governed by the elective-deferral limit, not the IRA limit.",
};

export const CAP_KIND_LABEL: Record<CapKind, string> = {
  ira: "IRA",
  electiveDeferral: "Elective deferral (TSP / 401k)",
};

export function capKindFor(kind: RetirementKind): CapKind {
  return kind === "elective_deferral" ? "electiveDeferral" : "ira";
}

export function isRetirementKind(value: unknown): value is RetirementKind {
  return typeof value === "string" && (RETIREMENT_KINDS as string[]).includes(value);
}

/**
 * Best guess from a name/subtype, used only where `retirement_kind` hasn't been
 * set. This is the old behaviour, kept as a fallback so existing accounts keep
 * showing up on the cap card before anyone edits them — but it is a guess, and
 * callers are expected to tell the user when they are relying on it.
 *
 * Deferral is tested first: a "TSP Roth" is a deferral account, not an IRA.
 */
export function inferRetirementKind(...parts: (string | null | undefined)[]): RetirementKind | null {
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  if (/401k|401\(k\)|\btsp\b|403b|457/.test(haystack)) return "elective_deferral";
  if (/\btraditional\b.*\bira\b|\bira\b.*\btraditional\b/.test(haystack)) return "traditional_ira";
  if (/roth|\bira\b/.test(haystack)) return "roth_ira";
  return null;
}

/**
 * Resolve a slot's kind: the bucket's own setting wins over the account's,
 * and an explicit setting always wins over inference.
 *
 * `inferred` is reported so the UI can distinguish "you told me this is a Roth
 * IRA" from "it has the word Roth in its name" — the difference matters when
 * the answer decides how much room a cap card says is left.
 */
export function resolveRetirementKind(input: {
  bucketKind?: string | null;
  accountKind?: string | null;
  bucketName?: string | null;
  accountName?: string | null;
  accountSubtype?: string | null;
}): { kind: RetirementKind | null; inferred: boolean } {
  if (isRetirementKind(input.bucketKind)) return { kind: input.bucketKind, inferred: false };
  if (isRetirementKind(input.accountKind)) return { kind: input.accountKind, inferred: false };
  const guess = inferRetirementKind(
    input.bucketName,
    input.accountName,
    input.accountSubtype,
  );
  return { kind: guess, inferred: guess != null };
}
