const NET_WORTH_EXCLUDED_DEBT_KINDS = new Set(["real_estate_loan"]);

/** Account kinds whose balance is the value of a property, not money held. */
export const PROPERTY_KIND = "property";

/**
 * Is a mortgage kept out of Net Worth?
 *
 * A mortgage counted without the home behind it understates net worth by
 * roughly the price of the house, so while the household tracks no property
 * the loan stays out of the totals (it is still listed on Accounts and
 * Debt/Loans for payoff tracking). Add a Property account and the value is
 * there to net against, so the loan starts counting as the liability it is —
 * pass `hasPropertyAsset` from the household's accounts.
 */
export function isDebtExcludedFromNetWorth(
  debtKind: string | null | undefined,
  hasPropertyAsset = false,
): boolean {
  if (hasPropertyAsset) return false;
  return debtKind != null && NET_WORTH_EXCLUDED_DEBT_KINDS.has(debtKind);
}

/** Does the household own anything whose value backs a real-estate loan? */
export function hasPropertyAsset(
  accounts: { kind: string; is_kids_account?: boolean | null; isKidsAccount?: boolean | null; active?: boolean | null }[],
): boolean {
  return accounts.some(
    (a) =>
      a.kind === PROPERTY_KIND &&
      !(a.is_kids_account ?? a.isKidsAccount ?? false) &&
      a.active !== false,
  );
}
