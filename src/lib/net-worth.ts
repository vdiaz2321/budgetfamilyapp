const NET_WORTH_EXCLUDED_DEBT_KINDS = new Set(["real_estate_loan"]);

/** Account kinds whose balance is the value of a property, not money held. */
export const PROPERTY_KIND = "property";

/**
 * Is a mortgage kept out of Net Worth?
 *
 * Always, now. A mortgage balance never reduces net worth — Victor's call
 * (2026-09-12): the loan total is not what he wants measured, the monthly
 * payment is. The payment already lands where it belongs: it is budgeted like
 * any other bill, so it counts as spending on the Budget, the Annual pages and
 * the projection grid, and the cash it consumes leaves net worth through the
 * bank balance it was paid from.
 *
 * This used to depend on whether a Property account existed: no property meant
 * the loan was excluded (counting it alone would understate net worth by the
 * price of the house), and adding one flipped it to counting. That flip was a
 * trap — the day a Property account appeared, net worth would silently drop by
 * the whole loan balance with no warning, and it is the one number this app
 * exists to report.
 *
 * The pairing that keeps this honest is that the home is not carried as an
 * asset either. If a Property account is ever added, its value WILL count
 * while the mortgage behind it does not, and net worth is then overstated by
 * the loan — see hasPropertyAsset below.
 */
export function isDebtExcludedFromNetWorth(debtKind: string | null | undefined): boolean {
  return debtKind != null && NET_WORTH_EXCLUDED_DEBT_KINDS.has(debtKind);
}

/**
 * Does the household own anything whose value backs a real-estate loan?
 *
 * No longer consulted by isDebtExcludedFromNetWorth — a mortgage balance is
 * now always out of Net Worth, whether or not a property is tracked. Kept
 * because it is the check to reach for if the home is ever to be carried as an
 * asset: counting the house while the mortgage stays out would overstate net
 * worth by the loan, so the two decisions have to be made together.
 */
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
