/**
 * When the portfolio can pay for the life the household already lives.
 *
 * Everything here is in **today's money**: the return is a real (after
 * inflation) rate, so the FI number and the projected balances can be read
 * against today's spending without deflating anything. That's the one modelling
 * choice that makes the rest honest — a nominal 8% against today's $63k of
 * spending would flatter the date by years.
 *
 * The arithmetic is deliberately the plain version, so it can be checked by
 * hand: growth on the balance you started the year with, then the year's
 * contributions on top. Contributions therefore earn nothing in the year they
 * are made, which makes the projection slightly conservative rather than
 * slightly optimistic.
 */

/**
 * One year taken from the household's own projection grid, in today's money.
 * Supplying these is what lets the projection say "the kids move out in 2036"
 * instead of assuming this year's spending repeats for forty years.
 */
export type FiScheduleYear = {
  year: number;
  spendCents: number;
  contributionCents: number;
};

export type FiInputs = {
  /** Invested assets today. */
  portfolioCents: number;
  /** Added each year from here on, in today's money. */
  annualContributionCents: number;
  /** What a year of the household's life costs, excluding what it saves. */
  annualSpendCents: number;
  /** Real return, e.g. 5 for 5% after inflation. */
  realReturnPct: number;
  /** Safe withdrawal rate, e.g. 4 for the 4% rule (a 25× target). */
  withdrawalRatePct: number;
  /** Stop projecting after this many years. */
  maxYears?: number;
  /**
   * Per-year spending and saving, in today's money. Any year present here
   * overrides the two flat figures above; years past the end of it carry the
   * last entry forward, because a plan that stops is not a plan that says
   * spending drops to zero.
   */
  schedule?: FiScheduleYear[];
};

export type FiYear = {
  /** Calendar year this row lands on. */
  year: number;
  /** Years from now (0 = today). */
  offset: number;
  startCents: number;
  growthCents: number;
  contributionCents: number;
  endCents: number;
  /** What this particular year of life costs, in today's money. */
  spendCents: number;
  /** The portfolio that sustains THIS year's spending at the withdrawal rate. */
  targetCents: number;
  /** Is the portfolio big enough to fund the spending at this point? */
  independent: boolean;
};

export type FiProjection = {
  /** The portfolio that sustains `annualSpendCents` at the withdrawal rate. */
  fiNumberCents: number;
  /** What today's portfolio sustains per year at that same rate. */
  sustainableSpendCents: number;
  /** 0–1. How much of the FI number is already funded. */
  progress: number;
  years: FiYear[];
  /** Calendar year the portfolio first covers the spending; null if never. */
  fiYear: number | null;
  /** Whole years from now to that point; null if it never gets there. */
  yearsToFi: number | null;
};

export function projectFi(inputs: FiInputs, fromYear: number): FiProjection {
  const {
    portfolioCents,
    annualContributionCents,
    annualSpendCents,
    realReturnPct,
    withdrawalRatePct,
    maxYears = 60,
    schedule,
  } = inputs;

  const byYear = new Map((schedule ?? []).map((y) => [y.year, y]));
  const lastScheduled = (schedule ?? []).reduce<FiScheduleYear | null>(
    (latest, y) => (latest == null || y.year > latest.year ? y : latest),
    null,
  );
  // A year the grid covers uses the grid. Past its end the last planned year
  // repeats — that is the life the plan actually ends on. With no grid at all
  // both fall back to the flat figures.
  const planFor = (year: number): { spendCents: number; contributionCents: number } => {
    const exact = byYear.get(year);
    if (exact) return exact;
    if (lastScheduled && year > lastScheduled.year) return lastScheduled;
    return { spendCents: annualSpendCents, contributionCents: annualContributionCents };
  };
  const targetFor = (spendCents: number) =>
    withdrawalRatePct > 0 ? Math.round(spendCents / (withdrawalRatePct / 100)) : 0;

  const sustainableSpendCents = Math.round((portfolioCents * withdrawalRatePct) / 100);

  const years: FiYear[] = [];
  let balance = portfolioCents;
  let fiYear: number | null = null;
  let fiNumberAtCrossing: number | null = null;

  // Today counts too: if the portfolio already covers this year's spending,
  // the answer is "now" and the loop below never needs to say so.
  const todayTarget = targetFor(planFor(fromYear).spendCents);
  if (todayTarget > 0 && balance >= todayTarget) {
    fiYear = fromYear;
    fiNumberAtCrossing = todayTarget;
  }

  let lastTarget = todayTarget;
  for (let offset = 1; offset <= maxYears; offset++) {
    const year = fromYear + offset;
    const { spendCents, contributionCents } = planFor(year);
    const target = targetFor(spendCents);
    lastTarget = target;

    const start = balance;
    const growth = Math.round((start * realReturnPct) / 100);
    const end = start + growth + contributionCents;
    balance = end;

    const independent = target > 0 && end >= target;
    if (independent && fiYear == null) {
      fiYear = year;
      fiNumberAtCrossing = target;
    }
    years.push({
      year,
      offset,
      startCents: start,
      growthCents: growth,
      contributionCents,
      endCents: end,
      spendCents,
      targetCents: target,
      independent,
    });
    // Nothing more to learn once it is funded and still compounding.
    if (fiYear != null && offset >= (fiYear - fromYear) + 5) break;
  }

  // The headline number is the bar at the year it is actually cleared — with a
  // varying spending plan there is no single lifelong FI number, and quoting
  // today's would answer a question nobody asked.
  const fiNumberCents = fiNumberAtCrossing ?? lastTarget;

  return {
    fiNumberCents,
    sustainableSpendCents,
    progress: fiNumberCents > 0 ? Math.min(1, portfolioCents / fiNumberCents) : 0,
    years,
    fiYear,
    yearsToFi: fiYear == null ? null : fiYear - fromYear,
  };
}

/** Age in a given calendar year, when a birth year is known. */
export function ageInYear(birthYear: number | null, year: number): number | null {
  return birthYear ? year - birthYear : null;
}
