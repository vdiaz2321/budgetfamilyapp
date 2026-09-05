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
  } = inputs;

  const fiNumberCents =
    withdrawalRatePct > 0 ? Math.round(annualSpendCents / (withdrawalRatePct / 100)) : 0;
  const sustainableSpendCents = Math.round((portfolioCents * withdrawalRatePct) / 100);

  const years: FiYear[] = [];
  let balance = portfolioCents;
  let fiYear: number | null = fiNumberCents > 0 && balance >= fiNumberCents ? fromYear : null;

  for (let offset = 1; offset <= maxYears; offset++) {
    const start = balance;
    const growth = Math.round((start * realReturnPct) / 100);
    const end = start + growth + annualContributionCents;
    balance = end;
    const independent = fiNumberCents > 0 && end >= fiNumberCents;
    if (independent && fiYear == null) fiYear = fromYear + offset;
    years.push({
      year: fromYear + offset,
      offset,
      startCents: start,
      growthCents: growth,
      contributionCents: annualContributionCents,
      endCents: end,
      independent,
    });
    // Nothing more to learn once it is funded and still compounding.
    if (fiYear != null && offset >= (fiYear - fromYear) + 5) break;
  }

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
