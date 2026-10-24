/**
 * Spending inflation over the years. There is one box — the rate from now on —
 * and a change to it counts from the year it was saved: years already passed
 * keep the rate they had (Victor, 2026-10-24: "at 2030 it goes to 3.4%, it
 * should adjust the following years"). Each change stores the rate it
 * replaced and the last year that rate covered.
 *
 * Pure: no database — the tests import it directly.
 */

export type InflationHistory = { until: number; pct: number }[];

export type Inflation = {
  /** The rate in the box: this year and every year after. */
  pct: number;
  /** Earlier rates, each with the last year it covered. */
  history: InflationHistory;
};

/** A bare number is a single rate for every year. */
export function asInflation(v: number | Inflation): Inflation {
  return typeof v === "number" ? { pct: v, history: [] } : v;
}

/** The stored `inflation_history`, anything malformed dropped, by year. */
export function parseInflationHistory(raw: unknown): InflationHistory {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((e) => {
      const until = Number(e?.until);
      const pct = Number(e?.pct);
      return Number.isInteger(until) && Number.isFinite(pct) ? [{ until, pct }] : [];
    })
    .sort((a, b) => a.until - b.until);
}

/** The rate that raised prices during `year`. */
export function inflationIn(year: number, v: number | Inflation): number {
  const { pct, history } = asInflation(v);
  return history.find((h) => year <= h.until)?.pct ?? pct;
}

/** How much `fromYear` money has grown by `toYear`: each year in between
 *  raised by its own rate. 1 when `toYear` isn't after `fromYear`. */
export function inflationGrowth(fromYear: number, toYear: number, v: number | Inflation): number {
  let f = 1;
  for (let y = fromYear + 1; y <= toYear; y++) f *= 1 + inflationIn(y, v) / 100;
  return f;
}

/**
 * The history after the box changes from `oldPct` to `newPct` in `thisYear`:
 * the old rate is kept for every year before this one. A second change in
 * the same year adds nothing — the in-between rate never covered a whole
 * past year.
 */
export function recordInflationChange(
  history: InflationHistory,
  oldPct: number,
  newPct: number,
  thisYear: number,
): InflationHistory {
  if (oldPct === newPct || history.some((h) => h.until >= thisYear - 1)) return history;
  return [...history, { until: thisYear - 1, pct: oldPct }];
}
