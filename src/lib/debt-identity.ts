import { isDebtExcludedFromNetWorth } from "./net-worth";

// The single rule for what counts as a household liability.
//
// A debt used to be encoded four ways — a `debts` row keyed by subcategory, an
// optional `debts.account_id` link, `accounts.debt_tracking_mode`, and
// `credit_card_details.is_revolving_debt` — and Net Worth and Accounts each
// carried their own reconciliation to avoid double-counting. Two independent
// implementations of one invariant is how a liability eventually gets counted
// twice, or not at all.
//
//   THE RULE: the `debts` table is the only liability ledger.
//
// An account is never itself a Net Worth liability, whatever its kind. A
// `debt_loan` account is a *presentation* of the debt (so it can be listed and
// reconciled on Accounts); the `debts` row keyed to its subcategory is the
// liability. That is already what the app does in practice — `addAccount`
// writes `include_net_worth: false` and `debt_tracking_mode: 'budget'` for every
// debt account, and all existing accounts carry that value.
//
// `debt_tracking_mode` is therefore vestigial. Its 'account' branch was
// unreachable (nothing ever set it) and, because it lived only in Net Worth, it
// was also the one code path that skipped the mortgage exclusion — so if it had
// ever been set on a mortgage, Net Worth and Accounts would have disagreed by
// the full loan balance. The column is left in place rather than dropped so no
// data is destroyed, but nothing reads it any more.

/** Account kinds that represent money owed rather than money held. */
export const LIABILITY_KINDS = ["credit_card", "debt_loan"] as const;

export function isLiabilityKind(kind: string): boolean {
  return (LIABILITY_KINDS as readonly string[]).includes(kind);
}

/**
 * Does a `debts` row contribute to Net Worth?
 *
 * Mortgages are deliberately excluded: the app tracks the loan but not the
 * home's value, so counting one without the other would understate net worth
 * by roughly the value of the house. They stay visible on Accounts and
 * Debt/Loans for payoff tracking.
 */
export function debtCountsInNetWorth(debtKind: string | null | undefined): boolean {
  return !isDebtExcludedFromNetWorth(debtKind);
}

/**
 * Does an account balance contribute to Net Worth as an asset?
 *
 * Liability-kind accounts never do — their debt is carried by the `debts`
 * table. Kids' accounts are tracked but excluded from household totals.
 */
export function accountCountsAsAsset(kind: string, isKidsAccount: boolean): boolean {
  return !isKidsAccount && !isLiabilityKind(kind);
}
