const NET_WORTH_EXCLUDED_DEBT_KINDS = new Set(["real_estate_loan"]);

/**
 * Mortgages stay visible in Accounts and Debt/Loans for payoff tracking, but
 * the app does not treat them as standalone Net Worth liabilities. This avoids
 * showing the full mortgage without the home's matching equity/value.
 */
export function isDebtExcludedFromNetWorth(debtKind: string | null | undefined): boolean {
  return debtKind != null && NET_WORTH_EXCLUDED_DEBT_KINDS.has(debtKind);
}
