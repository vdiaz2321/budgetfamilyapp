import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Take the rows out of a Supabase result, or throw if the request failed.
 *
 * The Supabase client never rejects — it resolves with `{ data: null, error }`.
 * So `const { data } = await supabase...` turns every failure into "no rows",
 * and the code below it then writes a NULL, a zero, or a truncated total and
 * carries on. That is not hypothetical: on 2026-08-29 transactions saved from
 * a phone with NULL payee and NULL account for exactly this reason, and the
 * two failures were indistinguishable from the user leaving the fields blank.
 *
 * A read that fails should fail the operation, not quietly change its answer.
 * `label` names the thing being read so the message says which read broke.
 *
 *     const accounts = unwrap(await supabase.from("accounts").select("id"), "accounts");
 *
 * Only skip this where an empty result is genuinely the same as a failure —
 * which is almost nowhere.
 */
export function unwrap<T>(
  result: { data: T; error: PostgrestError | null },
  label: string,
): T {
  if (result.error) throw new Error(`Could not read ${label}: ${result.error.message}`);
  return result.data;
}

/**
 * Throw on the first failed read in a batch. Pass the errors keyed by what
 * each one was reading, so the message says which query broke:
 *
 *     const [{ data: a, error: aErr }, { data: b, error: bErr }] =
 *       await Promise.all([...]);
 *     throwIfAny({ accounts: aErr, buckets: bErr });
 *
 * Pages use this rather than rendering `?? []` as an empty list. A page that
 * quietly shows $0 because a query failed is worse than a page that doesn't
 * load — the zero looks like an answer.
 */
export function throwIfAny(errors: Record<string, PostgrestError | null | undefined>): void {
  for (const [label, error] of Object.entries(errors)) {
    if (error) throw new Error(`Could not read ${label}: ${error.message}`);
  }
}
