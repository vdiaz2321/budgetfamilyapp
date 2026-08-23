// Annual retirement contribution caps, by tax year.
//
// These are set by the IRS and change most years, so hardcoding a single year's
// figures would go silently stale every January — showing last year's caps
// against this year's contributions, with no indication anything was wrong.
//
// Instead: one entry per year, looked up by the current year. A year with no
// entry returns null, and the UI says so and links out rather than falling back
// to the most recent figures it happens to have.
//
// TO UPDATE: normally you don't touch this file. From November the Savings
// page shows a "<year> caps due" prompt and takes the two figures directly
// into the `contribution_caps` table, which wins over the entries below. The
// table here is the fallback/seed for years already known at build time.
// Sources:
//   IRS — https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions
//   TSP — https://www.tsp.gov/making-contributions/contribution-limits/
//
// Catch-up contributions (age 50+, and the higher 60–63 band) are deliberately
// not modelled: the app doesn't record birth dates, so it can't tell whose
// limit is higher, and quietly applying the wrong one is worse than applying
// the base cap and saying so.

export type ContributionCaps = {
  /** 401(k) / 403(b) / 457 / TSP elective deferral limit. */
  electiveDeferralCents: number;
  /** Combined traditional + Roth IRA limit, per person. */
  iraCents: number;
};

const CAPS_BY_YEAR: Record<number, ContributionCaps> = {
  2025: { electiveDeferralCents: 2350000, iraCents: 700000 },
  2026: { electiveDeferralCents: 2450000, iraCents: 750000 },
};

export const IRS_LIMITS_URL =
  "https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions";

/**
 * Caps for a tax year, or null when that year isn't known yet.
 *
 * `stored` holds anything entered from the Savings page (the
 * `contribution_caps` table), keyed by tax year. It wins over the built-in
 * table so a new year can be added without a code change; absent years fall
 * through to the figures above, and a year in neither returns null so the
 * card can say "not published yet" instead of measuring against a stale cap.
 */
export function capsForYear(
  year: number,
  stored?: Record<number, ContributionCaps>,
): ContributionCaps | null {
  return stored?.[year] ?? CAPS_BY_YEAR[year] ?? null;
}

export type CapKind = "electiveDeferral" | "ira";

/**
 * Last date a contribution still counts toward a given tax year.
 *
 * These are genuinely different, and treating them as one understates how long
 * there is to fund an IRA by several months:
 *
 *   Elective deferral (TSP / 401k) — must run through payroll, so the last
 *     paycheque of the calendar year is the cutoff: 31 December.
 *   IRA — can be made up to the tax filing deadline for that year, roughly
 *     15 April of the following year (extensions don't extend it).
 *
 * April 15 can shift a day or two for weekends and DC holidays; this returns
 * the nominal date, which is close enough to plan against and is labelled as
 * "about" in the UI.
 */
export function contributionDeadline(kind: CapKind, taxYear: number): Date {
  return kind === "ira"
    ? new Date(taxYear + 1, 3, 15) // 15 April, following year
    : new Date(taxYear, 11, 31); // 31 December
}

/** Whole months from today until a deadline, floored at 0. */
export function monthsUntilDeadline(kind: CapKind, taxYear: number, from = new Date()): number {
  const due = contributionDeadline(kind, taxYear);
  const months =
    (due.getFullYear() - from.getFullYear()) * 12 + (due.getMonth() - from.getMonth());
  return Math.max(0, months + (due.getDate() >= from.getDate() ? 1 : 0));
}

/** The most recent year with caps on file — used to explain what's missing. */
export function latestCapYear(stored?: Record<number, ContributionCaps>): number {
  const years = [
    ...Object.keys(CAPS_BY_YEAR).map(Number),
    ...Object.keys(stored ?? {}).map(Number),
  ];
  return Math.max(...years);
}

/**
 * The IRS publishes next year's figures in the autumn — usually late October or
 * November. From this month on, a missing entry for next year is something to
 * act on rather than something that simply hasn't happened yet.
 */
const CAPS_ANNOUNCED_MONTH = 10; // November (months are 0-indexed)

/**
 * Next tax year, when its caps are due but not yet on file — otherwise null.
 *
 * This is the reminder that keeps the card from going blank in January: without
 * it, the first sign that the table needs updating is the card emptying itself
 * on New Year's Day. Asking in November leaves two months to act, and the
 * prompt disappears on its own once the year is added.
 */
export function pendingCapYear(
  from = new Date(),
  stored?: Record<number, ContributionCaps>,
): number | null {
  if (from.getMonth() < CAPS_ANNOUNCED_MONTH) return null;
  const next = from.getFullYear() + 1;
  return capsForYear(next, stored) ? null : next;
}
