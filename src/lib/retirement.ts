/**
 * When the portfolio can pay for the life the household already lives.
 *
 * Every figure is in the dollars of the year it lands in. Investments grow at
 * the expected rate of return; savings (checking and savings buckets) at the
 * savings APY, and each year's saving is split between the two. Retired pay,
 * VA and Social Security rise by the COLA — each one only when its switch is
 * on, and by the actual COLA in any year one is typed; other income stays at
 * the amount entered. Spending, healthcare and rentals rise by inflation.
 * Spending is what the table says for that year, grown by inflation from the
 * year it was typed.
 *
 * The arithmetic is deliberately the plain version, so it can be checked by
 * hand: growth on the balance you started the year with, then the year's
 * contributions on top. Contributions therefore earn nothing in the year they
 * are made, which makes the projection slightly conservative rather than
 * slightly optimistic.
 */

/**
 * One year taken from the household's own projection grid.
 * Supplying these is what lets the projection say "the kids move out in 2036"
 * instead of assuming this year's spending repeats for forty years.
 */
export type FiScheduleYear = {
  year: number;
  spendCents: number;
  contributionCents: number;
  /** Retired pay, VA and Social Security that year, after tax. When present it
   *  replaces the flat guaranteed-income figure for that year. */
  guaranteedCents?: number;
  /** That year's gains when the table has worked them out (they include
   *  rental equity). Omitted: the return on the opening balance. */
  growthCents?: number;
};

export type FiInputs = {
  /** Invested assets today. */
  portfolioCents: number;
  /** Added each year from here on. */
  annualContributionCents: number;
  /** What a year of the household's life costs, excluding what it saves. */
  annualSpendCents: number;
  /** Expected yearly return on investments, e.g. 7.5. */
  returnPct: number;
  /** Safe withdrawal rate, e.g. 4 for the 4% rule (a 25× target). */
  withdrawalRatePct: number;
  /**
   * Income that arrives whether or not the portfolio does — a pension, VA
   * disability, Social Security — per year. It is subtracted
   * from spending before the target is sized, because the portfolio only has
   * to fund the part nothing else covers.
   */
  guaranteedIncomeCents?: number;
  /** First year that income is received. Omit if it is already arriving. */
  guaranteedIncomeStartYear?: number | null;
  /** Stop projecting after this many years. */
  maxYears?: number;
  /** Run every year through this one (the plan-until age) instead of stopping
   *  a few years after FI — needed to see savings drawn down in retirement. */
  untilYear?: number | null;
  /**
   * Per-year spending and saving. Any year present here
   * overrides the two flat figures above; years past the end of it carry the
   * last entry forward, because a plan that stops is not a plan that says
   * spending drops to zero.
   */
  schedule?: FiScheduleYear[];
  /**
   * A bad-market test: in `year` the portfolio loses `pct`% instead of
   * growing. Years after it grow at the return on what is actually
   * left — the table's own gains were worked out on the un-dropped balance.
   */
  shock?: { year: number; pct: number } | null;
  /** From this year on, grow at the return on the actual balance rather
   *  than the table's gains: for a what-if whose balance has left the plan's. */
  ownGrowthFrom?: number | null;
  /** Savings held now, their APY, and the share of each year's saving that
   *  goes to investments (the rest to savings). The savings part of the
   *  balance earns the APY, the rest the return. Omitted: all invested. */
  cash?: { nowCents: number; pct: number; toInvestPct: number } | null;
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
  /** What this particular year of life costs. */
  spendCents: number;
  /** Guaranteed income received that year. */
  guaranteedCents: number;
  /**
   * The portfolio that sustains THIS year at the withdrawal rate — sized on
   * spending less guaranteed income, which is the only part it has to fund.
   */
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
  /** First year the balance ends below zero; null if the money lasts. */
  runsOutYear: number | null;
};

export function projectFi(inputs: FiInputs, fromYear: number): FiProjection {
  const {
    portfolioCents,
    annualContributionCents,
    annualSpendCents,
    returnPct,
    withdrawalRatePct,
    maxYears = 60,
    schedule,
    guaranteedIncomeCents = 0,
    guaranteedIncomeStartYear = null,
    untilYear = null,
    shock = null,
    ownGrowthFrom = null,
    cash = null,
  } = inputs;
  const ownFrom = shock?.year ?? ownGrowthFrom;

  const byYear = new Map((schedule ?? []).map((y) => [y.year, y]));
  const lastScheduled = (schedule ?? []).reduce<FiScheduleYear | null>(
    (latest, y) => (latest == null || y.year > latest.year ? y : latest),
    null,
  );
  // A year the grid covers uses the grid. Past its end the last planned year
  // repeats — that is the life the plan actually ends on. With no grid at all
  // both fall back to the flat figures.
  const planFor = (year: number): FiScheduleYear => {
    const exact = byYear.get(year);
    if (exact) return exact;
    if (lastScheduled && year > lastScheduled.year) return lastScheduled;
    return { year, spendCents: annualSpendCents, contributionCents: annualContributionCents };
  };
  // A pension (or VA, or Social Security) pays from its start year onward.
  const guaranteedFor = (year: number): number => {
    const scheduled = planFor(year).guaranteedCents;
    if (scheduled != null) return scheduled;
    if (guaranteedIncomeCents <= 0) return 0;
    if (guaranteedIncomeStartYear != null && year < guaranteedIncomeStartYear) return 0;
    return guaranteedIncomeCents;
  };
  // Only the part of a year's spending that nothing else covers has to come
  // out of the portfolio. Floored at zero: once guaranteed income covers the
  // whole year, the portfolio is not required at all and the target is $0.
  const targetFor = (year: number, spendCents: number) => {
    if (withdrawalRatePct <= 0) return 0;
    const uncovered = Math.max(0, spendCents - guaranteedFor(year));
    return Math.round(uncovered / (withdrawalRatePct / 100));
  };

  const sustainableSpendCents = Math.round((portfolioCents * withdrawalRatePct) / 100);
  // With no withdrawal rate there is no target to reach, so nothing can be
  // called independent; with one, a $0 target means it already is.
  const canReachTarget = withdrawalRatePct > 0;

  const years: FiYear[] = [];
  let balance = portfolioCents;
  let fiYear: number | null = null;
  let fiNumberAtCrossing: number | null = null;

  // Today counts too: if the portfolio already covers this year's spending,
  // the answer is "now" and the loop below never needs to say so.
  const todayTarget = targetFor(fromYear, planFor(fromYear).spendCents);
  if (canReachTarget && balance >= todayTarget) {
    fiYear = fromYear;
    fiNumberAtCrossing = todayTarget;
  }

  let lastTarget = todayTarget;
  let runsOutYear: number | null = null;
  // Savings at the start of each year, followed even through years whose
  // gains come from the table, so a what-if starting later has the right split.
  let cashBal = cash?.nowCents ?? 0;
  const lastOffset = untilYear != null ? Math.max(1, untilYear - fromYear) : maxYears;
  for (let offset = 1; offset <= lastOffset; offset++) {
    const year = fromYear + offset;
    const { spendCents, contributionCents } = planFor(year);
    const target = targetFor(year, spendCents);
    lastTarget = target;

    const start = balance;
    // Nothing left means nothing to earn on — a negative balance is a
    // shortfall to flag, not a loan the plan pays interest on.
    // Only an exact year's gains: a carried-forward last year must not repeat
    // one year's dollar gains forever.
    const scheduled = ownFrom != null && year >= ownFrom ? undefined : byYear.get(year)?.growthCents;
    const growth =
      shock && year === shock.year
        ? start > 0 ? -Math.round((start * shock.pct) / 100) : 0
        : scheduled ?? yearGrowth(start, cashBal, cash?.pct ?? 0, returnPct);
    const end = start + growth + contributionCents;
    balance = end;
    if (cash) cashBal = nextCash(cashBal, cash.pct, contributionCents, cash.toInvestPct, end);
    if (end < 0 && runsOutYear == null) runsOutYear = year;

    const independent = canReachTarget && end >= target;
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
      guaranteedCents: guaranteedFor(year),
      targetCents: target,
      independent,
    });
    // Nothing more to learn once it is funded and still compounding — unless
    // the plan runs to an age, where the drawdown years are the point.
    if (untilYear == null && fiYear != null && offset >= (fiYear - fromYear) + 5) break;
  }

  // The headline number is the bar at the year it is actually cleared — with a
  // varying spending plan there is no single lifelong FI number, and quoting
  // today's would answer a question nobody asked.
  const fiNumberCents = fiNumberAtCrossing ?? lastTarget;

  return {
    fiNumberCents,
    sustainableSpendCents,
    // A $0 target means guaranteed income already covers the spending — that
    // is 100% funded, not 0%. Reporting it as 0 read as "no progress" on the
    // one household that needs the portfolio least.
    progress: fiNumberCents > 0 ? Math.min(1, portfolioCents / fiNumberCents) : 1,
    years,
    fiYear,
    yearsToFi: fiYear == null ? null : fiYear - fromYear,
    runsOutYear,
  };
}

/**
 * Typed spending, grown by inflation. An amount typed for a year is that
 * year's spending exactly; each year after it holding the same typed amount
 * grows by inflation from there, until a year with a new typed amount starts
 * over. Returns year → spending before healthcare. Years before `thisYear`
 * are left as typed.
 */
export function inflatedSpending(
  rows: { year: number; baseSpendingCents: number }[],
  thisYear: number,
  inflationPct: number,
): Map<number, number> {
  const out = new Map<number, number>();
  let anchorYear: number | null = null;
  let prevBase: number | null = null;
  for (const r of [...rows].sort((a, b) => a.year - b.year)) {
    if (r.year < thisYear) {
      out.set(r.year, r.baseSpendingCents);
      continue;
    }
    if (anchorYear == null || r.baseSpendingCents !== prevBase) anchorYear = r.year;
    prevBase = r.baseSpendingCents;
    out.set(r.year, Math.round(r.baseSpendingCents * inflateTo(r.year, anchorYear, inflationPct)));
  }
  return out;
}

// ---- Savings vs investments.
//
// Savings (checking and savings buckets) earn the savings APY; investments the
// expected return. Each year's saving is split between them the way the
// accounts are split today; a year that spends more than it earns draws on investments first,
// and savings only once investments are gone.

/** Account kinds that count as savings in the plan. */
export const CASH_KINDS = ["checking", "savings_bucket"] as const;

/** Share of each year's saving that goes to investments: the same split as
 *  the accounts today (all of it when there's nothing in either yet). */
export function investShareOfNew(cashCents: number, investCents: number): number {
  const total = Math.max(0, cashCents) + Math.max(0, investCents);
  return total > 0 ? (Math.max(0, investCents) / total) * 100 : 100;
}

/** Savings at the start of next year: this year's grown at the APY, plus the
 *  savings share of what the year saved, never more than the whole balance. */
export function nextCash(
  cashCents: number,
  cashPct: number,
  savedCents: number,
  toInvestPct: number,
  endBalanceCents: number,
): number {
  const grown = cashCents * (1 + cashPct / 100) + Math.max(0, savedCents) * (1 - toInvestPct / 100);
  return Math.round(Math.max(0, Math.min(grown, endBalanceCents)));
}

/** A year's gains on `startCents`: the cash part at the cash rate, the rest at
 *  the investment return. Nothing left earns nothing. */
export function yearGrowth(startCents: number, cashCents: number, cashPct: number, returnPct: number): number {
  if (startCents <= 0) return 0;
  const inCash = Math.min(Math.max(0, cashCents), startCents);
  return Math.round((inCash * cashPct) / 100 + ((startCents - inCash) * returnPct) / 100);
}

/** Age in a given calendar year, when a birth year is known. */
export function ageInYear(birthYear: number | null, year: number): number | null {
  return birthYear ? year - birthYear : null;
}

// ---- Retirement income, year by year.
//
// Military retired pay, VA disability and Social Security get the same
// yearly COLA (CPI-W, Q3 over Q3), each behind its own switch and each from
// its own start: retired pay the January after retiring (the first one cut by
// the retirement quarter), VA from its start, Social Security from age 62.
// The other lines stay at the amount entered. Victor took a flat 2.5% COLA out on 2026-10-15
// and asked for it back on 2026-10-16 as switches plus the actual COLA per
// year, typed from MOAA's newsletter as each one is announced.

/** What an amount now has grown to by `year` at `pct` a year. */
export function inflateTo(year: number, thisYear: number, pct: number): number {
  return Math.pow(1 + pct / 100, Math.max(0, year - thisYear));
}

export type IncomeLineKind = "pay" | "va" | "social_security" | "job" | "spouse" | "other";

export const INCOME_LINE_KINDS: { value: IncomeLineKind; label: string }[] = [
  { value: "pay", label: "Pay (work)" },
  { value: "va", label: "VA disability" },
  { value: "social_security", label: "Social Security" },
  { value: "job", label: "Second job" },
  { value: "spouse", label: "Spouse income" },
  { value: "other", label: "Other" },
];

/** The COLA plan. A COLA is keyed by the year the raised payment is first
 *  received: the "2027 COLA" is announced in October 2026, effective
 *  December 1 and paid from January 2027 — how SSA, DFAS and MOAA all name it. */
export type ColaPlan = {
  /** Future COLA, % a year, for any year without an actual one typed. */
  pct: number;
  /** Actual COLAs, % by payment year. */
  byYear: Record<string, number>;
  military: boolean;
  va: boolean;
  socialSecurity: boolean;
};

export const NO_COLA: ColaPlan = { pct: 0, byYear: {}, military: false, va: false, socialSecurity: false };

/** The COLA paid from January of `year`: the typed one, else the future rate. */
export const colaFor = (cola: ColaPlan, year: number): number => cola.byYear[String(year)] ?? cola.pct;

/** What an amount has grown to by `year` from every COLA paid after `fromYear`. */
export function colaGrowth(cola: ColaPlan, fromYear: number, year: number): number {
  let f = 1;
  for (let y = fromYear + 1; y <= year; y++) f *= 1 + colaFor(cola, y) / 100;
  return f;
}

/** A stored `cola_by_year` with anything that isn't a year → % dropped. */
export function parseColaByYear(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (/^\d{4}$/.test(k) && v != null && v !== "" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** A source of income that switches on and off by year. */
export type IncomeLine = {
  id: string;
  name: string;
  kind: IncomeLineKind;
  /** Per month at this year's rates, before tax. VA and Social Security rise
   *  by the COLA when their switch is on; the rest stay as entered. */
  monthlyCents: number;
  /** First year received; null = already arriving. */
  startYear: number | null;
  /** First month received in startYear (1–12); null = January. */
  startMonth: number | null;
  /** Last year received (inclusive); null = for life. */
  endYear: number | null;
  /** Last month received in endYear (1–12); null = December. */
  endMonth?: number | null;
  /** The yearly raise, % each January after the start year (not VA or Social Security). */
  raisePct?: number | null;
  /** Typed per year: the amount as typed. `monthlyCents` is then a twelfth of it. */
  annualCents?: number | null;
  taxable: boolean;
};

/**
 * When pay with no end of its own stops — the month you stop working: the
 * month before military retired pay starts, else the December before
 * withdrawals start. Null when neither is set: it doesn't stop.
 */
export function payStop(
  retireYear: number | null,
  retireMonth: number | null | undefined,
  withdrawStartYear: number | null,
): { endYear: number; endMonth: number; why: "military" | "withdrawals" } | null {
  if (retireYear != null) {
    const m = retireMonth ?? 1;
    return m > 1
      ? { endYear: retireYear, endMonth: m - 1, why: "military" }
      : { endYear: retireYear - 1, endMonth: 12, why: "military" };
  }
  if (withdrawStartYear != null) return { endYear: withdrawStartYear - 1, endMonth: 12, why: "withdrawals" };
  return null;
}

/** The lines as the plan runs them: a Pay line with no end stops at `stop`. */
export function withPayEnds(lines: IncomeLine[], stop: { endYear: number; endMonth: number } | null): IncomeLine[] {
  if (!stop) return lines;
  return lines.map((l) =>
    l.kind === "pay" && l.endYear == null ? { ...l, endYear: stop.endYear, endMonth: stop.endMonth } : l,
  );
}

/** Income that arrives whether or not anyone works: it lowers the FI goal.
 *  A second job or a spouse's pay can stop, so it only helps cash flow. */
const GUARANTEED_KINDS = new Set<IncomeLineKind | "pension">(["pension", "va", "social_security"]);

export type MilitaryPension = {
  /** Year active-duty pay stops and retired pay starts. */
  retireYear: number | null;
  /** First month on retired pay (1–12); null = January. */
  retireMonth?: number | null;
  /** Year service began; years of service = retireYear − this. */
  serviceStartYear: number | null;
  /** Month service began (1–12); null = January. */
  serviceStartMonth?: number | null;
  /** High-3 average monthly basic pay, in retirement-year dollars. */
  high3MonthlyCents: number | null;
  sbpEnabled: boolean;
  /** SBP premium, % of gross retired pay (6.5% today). */
  sbpPct: number;
};

export type PensionEstimate = {
  /** Whole years of service. */
  yearsOfService: number;
  /** Months past the whole years (0–11). */
  extraMonths: number;
  /** 2.5% per year of service (DFAS High-3 formula). */
  multiplierPct: number;
  /** Gross monthly retired pay in retirement-year dollars, as DFAS would quote it. */
  grossAtRetireCents: number;
  /** SBP premium per month in the retirement year (0 when not elected). */
  sbpAtRetireCents: number;
  retireYear: number;
  /** First month on retired pay (1–12). */
  retireMonth: number;
};


/** DFAS: High-3 × (2.5% × years of service), rounded down to the dollar. */
export function estimatePension(p: MilitaryPension): PensionEstimate | null {
  if (p.retireYear == null || p.serviceStartYear == null || !p.high3MonthlyCents) return null;
  // DFAS counts whole months: each one is 1/12 of the 2.5% a year.
  const months = Math.max(
    0,
    p.retireYear * 12 + (p.retireMonth ?? 1) - (p.serviceStartYear * 12 + (p.serviceStartMonth ?? 1)),
  );
  const yearsOfService = Math.floor(months / 12);
  const extraMonths = months % 12;
  const multiplierPct = Math.round(((2.5 * months) / 12) * 100) / 100;
  const grossAtRetireCents = Math.floor((p.high3MonthlyCents * multiplierPct) / 100 / 100) * 100;
  const sbpAtRetireCents = p.sbpEnabled ? Math.round((grossAtRetireCents * p.sbpPct) / 100) : 0;
  return {
    yearsOfService,
    extraMonths,
    multiplierPct,
    grossAtRetireCents,
    sbpAtRetireCents,
    retireYear: p.retireYear,
    retireMonth: p.retireMonth ?? 1,
  };
}

/**
 * Share of the first COLA after retiring, by the quarter retired pay starts
 * (10 USC 1401a(d), High-3): it only counts the CPI rise after that quarter.
 * DFAS's table for the 2026 COLA (2.8%) paid 2.6 / 1.6 / 0.7 / 0.0% to Jan–Mar
 * / Apr–Jun / Jul–Sep / Oct–Dec 2025 retirements — about these shares.
 */
const FIRST_COLA_SHARE = [0.93, 0.57, 0.25, 0];

/** Retired pay's growth by `year` from its COLAs: the first one, paid the
 *  January after retiring, cut by FIRST_COLA_SHARE; every one after it full.
 *  A November 2033 start gets 0% in 2034 and the full COLA from 2035. */
export function pensionColaGrowth(cola: ColaPlan, retireYear: number, retireMonth: number, year: number): number {
  if (year <= retireYear) return 1;
  const first = 1 + (colaFor(cola, retireYear + 1) / 100) * FIRST_COLA_SHARE[Math.floor((retireMonth - 1) / 3)];
  return first * colaGrowth(cola, retireYear + 1, year);
}

/** Share of the first COLA after retiring in `retireMonth` (1–12). */
export const firstColaShare = (retireMonth: number) => FIRST_COLA_SHARE[Math.floor((retireMonth - 1) / 3)];

/** First payment year retired pay actually rises: the January after
 *  retiring, or the one after that when the first COLA is cut to 0%. */
export const firstPensionColaYear = (retireYear: number, retireMonth: number) =>
  retireYear + (FIRST_COLA_SHARE[Math.floor((retireMonth - 1) / 3)] > 0 ? 1 : 2);

/** Actual COLAs by payment year (SSA; military retired pay and VA disability
 *  got the same % every year). 2027 announced 2026-10-14. */
export const COLA_HISTORY: Record<number, number> = {
  2007: 3.3, 2008: 2.3, 2009: 5.8, 2010: 0, 2011: 0, 2012: 3.6, 2013: 1.7,
  2014: 1.5, 2015: 1.7, 2016: 0, 2017: 0.3, 2018: 2.0, 2019: 2.8, 2020: 1.6,
  2021: 1.3, 2022: 5.9, 2023: 8.7, 2024: 3.2, 2025: 2.5, 2026: 2.8, 2027: 3.6,
};

/** Compound average COLA over the last `years` on record, % rounded to 0.1. */
export function colaAverage(years: number): number {
  const last = Math.max(...Object.keys(COLA_HISTORY).map(Number));
  let f = 1;
  for (let y = last - years + 1; y <= last; y++) f *= 1 + (COLA_HISTORY[y] ?? 0) / 100;
  return Math.round((Math.pow(f, 1 / years) - 1) * 1000) / 10;
}

/** Gross retired pay and SBP per month in `year`, with its COLAs (SBP is a
 *  share of gross, so it rises with it). */
function pensionIn(p: PensionEstimate, year: number, cola: ColaPlan) {
  const g = cola.military ? pensionColaGrowth(cola, p.retireYear, p.retireMonth, year) : 1;
  return { gross: Math.round(p.grossAtRetireCents * g), sbp: Math.round(p.sbpAtRetireCents * g) };
}

export type High3Year = {
  year: number;
  /** Months of that year inside the 36. */
  months: number;
  /** First and last of those months (1–12). */
  firstMonth: number;
  lastMonth: number;
};

/** The 36 months of base pay right before retired pay starts, grouped by
 *  calendar year — pay raises land on January 1. */
export function high3Window(retireYear: number, retireMonth: number | null | undefined): High3Year[] {
  const start = retireYear * 12 + (retireMonth ?? 1) - 1 - 36;
  const out: High3Year[] = [];
  for (let i = start; i < start + 36; i++) {
    const year = Math.floor(i / 12);
    const month = (i % 12) + 1;
    const last = out[out.length - 1];
    if (last && last.year === year) {
      last.months++;
      last.lastMonth = month;
    } else out.push({ year, months: 1, firstMonth: month, lastMonth: month });
  }
  return out;
}

/** DFAS High-3: the average monthly base pay over those 36 months, each year's
 *  rate counted for its months. Null until every year in the window has pay. */
export function high3FromBasePay(
  retireYear: number | null,
  retireMonth: number | null | undefined,
  basePayByYear: Record<string, number>,
): number | null {
  if (retireYear == null) return null;
  let total = 0;
  for (const w of high3Window(retireYear, retireMonth)) {
    const pay = basePayByYear[String(w.year)];
    if (!pay) return null;
    total += pay * w.months;
  }
  return Math.round(total / 36);
}

/**
 * Share of `year` spent on retired pay: 0 before the retirement year, 1 after
 * it, and in the year itself the months from the retirement month on
 * (November → 2/12). The rest of that year is still active-duty pay.
 */
export function retiredShareOfYear(year: number, retireYear: number | null, retireMonth: number | null | undefined): number {
  if (retireYear == null || year > retireYear) return retireYear == null ? 0 : 1;
  if (year < retireYear) return 0;
  return (13 - (retireMonth ?? 1)) / 12;
}

export type IncomePart = {
  name: string;
  kind: IncomeLineKind | "pension";
  /** Per month, after SBP and tax. */
  monthlyAfterTaxCents: number;
  /** Same, before tax (still after SBP) — so the breakdown can show the tax. */
  monthlyBeforeTaxCents: number;
  /** Months paid that year — under 12 only in a line's first year (Mar start → 10). */
  months?: number;
  /** First month paid when months < 12 (1–12). */
  firstMonth?: number;
};

export type YearIncome = {
  /** Every source paying that year, after SBP and tax. */
  parts: IncomePart[];
  /** Yearly total after tax. */
  afterTaxCents: number;
  /** The guaranteed share (retired pay, VA, Social Security), yearly, after tax. */
  guaranteedCents: number;
};

const active = (year: number, start: number | null, end: number | null) =>
  (start == null || year >= start) && (end == null || year <= end);

/** Months a line pays in `year`: from its start month in its first year,
 *  through its end month in its last, else all 12. */
const lineMonths = (line: IncomeLine, year: number) => {
  const from = line.startYear != null && year === line.startYear ? line.startMonth ?? 1 : 1;
  const to = line.endYear != null && year === line.endYear ? line.endMonth ?? 12 : 12;
  return Math.max(0, to - from + 1);
};

/** What the COLA dates hang on: the year amounts are typed at, and the
 *  birth year Social Security's age-62 start comes from. */
export type ColaWhen = { thisYear: number; birthYear: number | null };

/**
 * The year a line's COLAs count from (each one paid after it), or null when
 * the line never gets one. Amounts are typed at this year's rates, so nothing
 * before this year counts.
 * - VA disability: from the year it starts — a future VA line is typed at the
 *   rate it starts on.
 * - Social Security: from the year its earner turns 62, claimed or not
 *   (SSA adds COLAs from age 62; a statement estimate is in today's dollars
 *   and isn't raised before then). No birth year: from its start.
 */
export function lineColaBase(line: IncomeLine, cola: ColaPlan, when: ColaWhen): number | null {
  const start = line.startYear ?? when.thisYear;
  if (line.kind === "va") return cola.va ? Math.max(when.thisYear, start) : null;
  if (line.kind === "social_security" && cola.socialSecurity) {
    return Math.max(when.thisYear, when.birthYear != null ? when.birthYear + 62 : start);
  }
  return null;
}

/** A line's monthly amount in `year`, with every COLA paid after its base. */
function lineIn(line: IncomeLine, year: number, cola: ColaPlan, when: ColaWhen): number {
  // Pay-like income rises by its own raise each January after its start
  // year (or this year, if already arriving); VA and Social Security rise by
  // the COLA instead.
  if (line.raisePct && line.kind !== "va" && line.kind !== "social_security") {
    const base = Math.max(when.thisYear, line.startYear ?? when.thisYear);
    return Math.round(line.monthlyCents * Math.pow(1 + line.raisePct / 100, Math.max(0, year - base)));
  }
  const base = lineColaBase(line, cola, when);
  return base == null ? line.monthlyCents : Math.round(line.monthlyCents * colaGrowth(cola, base, year));
}

/** A part's money for the whole year. */
const yearlyOf = (p: IncomePart, cents: number) => cents * (p.months ?? 12);

/**
 * What the income lines and retired pay put in the bank in one year.
 * SBP comes off before tax (its premiums aren't taxed); VA is never taxed.
 */
export function incomeForYear(
  year: number,
  pension: PensionEstimate | null,
  pensionStartYear: number | null,
  lines: IncomeLine[],
  taxPct: number,
  cola: ColaPlan = NO_COLA,
  when: ColaWhen = { thisYear: year, birthYear: null },
): YearIncome {
  const keep = 1 - taxPct / 100;
  const parts: IncomePart[] = [];
  if (pension && pensionStartYear != null && year >= pensionStartYear) {
    const { gross, sbp } = pensionIn(pension, year, cola);
    parts.push({
      name: "Military retired pay",
      kind: "pension",
      monthlyAfterTaxCents: Math.round((gross - sbp) * keep),
      monthlyBeforeTaxCents: gross - sbp,
    });
  }
  for (const line of lines) {
    if (!active(year, line.startYear, line.endYear) || line.monthlyCents <= 0) continue;
    const monthly = lineIn(line, year, cola, when);
    const months = lineMonths(line, year);
    if (months <= 0) continue;
    parts.push({
      name: line.name,
      kind: line.kind,
      monthlyAfterTaxCents: Math.round(monthly * (line.taxable ? keep : 1)),
      monthlyBeforeTaxCents: monthly,
      months,
      firstMonth: 13 - months,
    });
  }
  const afterTaxCents = parts.reduce((s, p) => s + yearlyOf(p, p.monthlyAfterTaxCents), 0);
  const guaranteedCents = parts
    .filter((p) => GUARANTEED_KINDS.has(p.kind))
    .reduce((s, p) => s + yearlyOf(p, p.monthlyAfterTaxCents), 0);
  return { parts, afterTaxCents, guaranteedCents };
}

/**
 * The same year's income if Victor has died and Jo is the survivor:
 * - retired pay becomes the SBP annuity, 55% of gross retired pay (taxable),
 *   or nothing when SBP wasn't elected;
 * - his pay, VA disability and a second job stop — they were his;
 * - of the Social Security lines only the largest is kept, because a survivor
 *   receives the higher of her own and his benefit, not both;
 * - a spouse's own income and anything else carries on.
 */
export function survivorIncomeForYear(
  year: number,
  pension: PensionEstimate | null,
  pensionStartYear: number | null,
  sbpEnabled: boolean,
  lines: IncomeLine[],
  taxPct: number,
  cola: ColaPlan = NO_COLA,
  when: ColaWhen = { thisYear: year, birthYear: null },
): YearIncome {
  const keep = 1 - taxPct / 100;
  const parts: IncomePart[] = [];
  if (pension && sbpEnabled && pensionStartYear != null && year >= pensionStartYear) {
    // The annuity gets the same COLAs retired pay would have.
    const annuity = Math.round(pensionIn(pension, year, cola).gross * 0.55);
    parts.push({
      name: "SBP annuity (55%)",
      kind: "pension",
      monthlyAfterTaxCents: Math.round(annuity * keep),
      monthlyBeforeTaxCents: annuity,
    });
  }
  const live = lines.filter((l) => active(year, l.startYear, l.endYear) && l.monthlyCents > 0);
  const ss = live.filter((l) => l.kind === "social_security");
  const largestSs = ss.reduce<IncomeLine | null>((best, l) => (best == null || l.monthlyCents > best.monthlyCents ? l : best), null);
  for (const line of live) {
    if (line.kind === "pay" || line.kind === "va" || line.kind === "job") continue;
    if (line.kind === "social_security" && line !== largestSs) continue;
    const monthly = lineIn(line, year, cola, when);
    parts.push({
      name: line.kind === "social_security" ? "Social Security (survivor)" : line.name,
      kind: line.kind,
      monthlyAfterTaxCents: Math.round(monthly * (line.taxable ? keep : 1)),
      monthlyBeforeTaxCents: monthly,
      months: lineMonths(line, year),
      firstMonth: 13 - lineMonths(line, year),
    });
  }
  const afterTaxCents = parts.reduce((s, p) => s + yearlyOf(p, p.monthlyAfterTaxCents), 0);
  const guaranteedCents = parts
    .filter((p) => GUARANTEED_KINDS.has(p.kind))
    .reduce((s, p) => s + yearlyOf(p, p.monthlyAfterTaxCents), 0);
  return { parts, afterTaxCents, guaranteedCents };
}

export type HealthPlanKind = "tricare_prime" | "tricare_select" | "private";

/** When a healthcare cost starts and ends. Blank start = the retirement
 *  month; blank end = until TRICARE For Life (health plans) or for life
 *  (dental & vision). A blank month is January for a start, December for an end. */
export type CostDates = {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
};

export type HealthPlan = { kind: HealthPlanKind; annualCents: number } & CostDates;

/** Retiree dental & vision come through FEDVIP (it replaced the TRICARE
 *  Retiree Dental Program), or a private plan. */
export type DentalPlanKind = "fedvip_dental" | "fedvip_vision" | "private_dental" | "private_vision";

export const DENTAL_PLAN_KINDS: { value: DentalPlanKind; label: string }[] = [
  { value: "fedvip_dental", label: "FEDVIP dental" },
  { value: "fedvip_vision", label: "FEDVIP vision" },
  { value: "private_dental", label: "Private dental" },
  { value: "private_vision", label: "Private vision" },
];

export type DentalPlan = { kind: DentalPlanKind; annualCents: number } & CostDates;

const yearOrNull = (v: unknown) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n > 1900 && n < 2200 ? n : null;
};
const monthOrNull = (v: unknown) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
};

/** A stored plan list (`health_plans`, `dental_plans`), with anything
 *  malformed or of another kind dropped. */
function parsePlans<K extends string>(raw: unknown, kinds: readonly K[]): ({ kind: K; annualCents: number } & CostDates)[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const kind = p?.kind;
    const cents = Number(p?.annualCents);
    if (!kinds.includes(kind)) return [];
    return [
      {
        kind,
        annualCents: Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0,
        startYear: yearOrNull(p?.startYear),
        startMonth: monthOrNull(p?.startMonth),
        endYear: yearOrNull(p?.endYear),
        endMonth: monthOrNull(p?.endMonth),
      },
    ];
  });
}

export const parseHealthPlans = (raw: unknown): HealthPlan[] =>
  parsePlans(raw, ["tricare_prime", "tricare_select", "private"] as const);

export const parseDentalPlans = (raw: unknown): DentalPlan[] =>
  parsePlans(raw, DENTAL_PLAN_KINDS.map((k) => k.value));

type YearMonth = { year: number; month: number };

/** Months of `year` between `from` and `to` (inclusive); no `to` = no end. */
export function monthsInYear(year: number, from: YearMonth, to: YearMonth | null): number {
  const first = Math.max(year * 12, from.year * 12 + from.month - 1);
  const last = to ? Math.min(year * 12 + 11, to.year * 12 + to.month - 1) : year * 12 + 11;
  return Math.max(0, last - first + 1);
}

export type HealthcarePlan = {
  birthYear: number | null;
  /** Military retirement — the health plan and dental & vision start then. */
  retireYear: number | null;
  retireMonth: number | null;
  /** Each health plan (TRICARE Prime/Select, private) with its yearly
   *  premium and dates; by default from retirement until TFL starts. */
  plans: HealthPlan[];
  /** TRICARE For Life: the Medicare Part B premium per year, from `tflStartAge`. */
  tflAnnualCents: number | null;
  tflStartAge: number;
  /** Dental & vision plans, by default from retirement on (TFL covers neither). */
  dentalPlans: DentalPlan[];
  /** How much faster than inflation medical costs rise, % a year. */
  growthPct: number;
  inflationPct: number;
};

/**
 * Healthcare as its own yearly cost, rising inflation + `growthPct` a year
 * (medical costs run ahead of prices overall), counted from this year. Three
 * lines: each health plan for the months between its start and end (by
 * default from the retirement month until TRICARE For Life starts), TFL
 * (Medicare Part B) from the year of its start age, and each dental & vision
 * plan for its months (by default from the retirement month on).
 */
export function healthcareForYear(year: number, plan: HealthcarePlan, thisYear: number): number {
  const tflYear = plan.birthYear != null ? plan.birthYear + plan.tflStartAge : null;
  const onTfl = tflYear != null && year >= tflYear;
  const retired: YearMonth | null =
    plan.retireYear != null ? { year: plan.retireYear, month: plan.retireMonth ?? 1 } : null;
  const share = (d: CostDates, defaultEnd: YearMonth | null) => {
    const from = d.startYear != null ? { year: d.startYear, month: d.startMonth ?? 1 } : retired;
    if (!from) return 0;
    const to = d.endYear != null ? { year: d.endYear, month: d.endMonth ?? 12 } : defaultEnd;
    return monthsInYear(year, from, to) / 12;
  };
  const untilTfl = tflYear != null ? { year: tflYear - 1, month: 12 } : null;
  const base =
    (onTfl ? plan.tflAnnualCents ?? 0 : 0) +
    plan.plans.reduce((t, p) => t + p.annualCents * share(p, untilTfl), 0) +
    plan.dentalPlans.reduce((t, p) => t + p.annualCents * share(p, null), 0);
  if (base <= 0) return 0;
  return Math.round(base * inflateTo(year, thisYear, plan.inflationPct + plan.growthPct));
}

// ---- Rental properties.
//
// Price, rent and costs are typed at current rates and rise with inflation;
// the value also grows by its appreciation on top. The mortgage payment stays
// fixed, so a rental's cash flow improves as rent rises past it.

export type RentalProperty = {
  id: string;
  name: string;
  /** Owned (linked to Accounts, or typed as owned) vs a planned purchase. */
  owned: boolean;
  /** Planned purchases: the year it is bought. */
  purchaseYear: number | null;
  /** Planned: price at current rates. Owned: current value. */
  valueCents: number;
  downPaymentPct: number;
  closingCostPct: number;
  /** Owned: what is owed now. */
  loanBalanceCents: number | null;
  loanRatePct: number;
  /** Planned: loan term. Owned: years left. */
  loanYears: number;
  monthlyRentCents: number;
  monthlyCostsCents: number;
  /** Value growth on top of inflation. */
  appreciationPct: number;
};

export type RentalYear = {
  /** Rent − costs − mortgage payment for the year, before tax. */
  cashFlowCents: number;
  equityStartCents: number;
  equityEndCents: number;
  /** Down payment + closing costs, the purchase year only. */
  purchaseCashCents: number;
};

function monthlyPayment(principal: number, ratePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const m = ratePct / 100 / 12;
  const n = years * 12;
  return m === 0 ? principal / n : (principal * m) / (1 - Math.pow(1 + m, -n));
}

function balanceAfter(principal: number, ratePct: number, years: number, paidYears: number): number {
  if (principal <= 0 || paidYears >= years) return 0;
  if (paidYears <= 0) return principal;
  const m = ratePct / 100 / 12;
  const k = paidYears * 12;
  if (m === 0) return principal * (1 - paidYears / years);
  const pay = monthlyPayment(principal, ratePct, years);
  return principal * Math.pow(1 + m, k) - (pay * (Math.pow(1 + m, k) - 1)) / m;
}

/**
 * One rental in one calendar year. Null before a planned purchase. An owned
 * property starts next year: this year is already in the register.
 */
export function rentalForYear(
  p: RentalProperty,
  year: number,
  thisYear: number,
  inflationPct: number,
): RentalYear | null {
  const inflate = (y: number) => inflateTo(y, thisYear, inflationPct);
  const firstYear = p.owned ? thisYear + 1 : p.purchaseYear;
  if (firstYear == null || year < firstYear) return null;

  // Loan in nominal dollars from the year it starts.
  const valueBase = p.owned ? thisYear : p.purchaseYear!;
  const principal = p.owned
    ? p.loanBalanceCents ?? 0
    : p.valueCents * inflate(p.purchaseYear!) * (1 - p.downPaymentPct / 100);
  const payYearly = monthlyPayment(principal, p.loanRatePct, p.loanYears) * 12;
  const loanStart = p.owned ? thisYear + 1 : p.purchaseYear!;

  const equityEnd = (y: number) => {
    const value = p.valueCents * Math.pow(1 + p.appreciationPct / 100, y - valueBase) * inflate(y);
    const owed = balanceAfter(principal, p.loanRatePct, p.loanYears, y - loanStart + 1);
    return value - owed;
  };
  const equityStart =
    year === firstYear
      ? p.owned
        ? p.valueCents - principal
        : 0
      : equityEnd(year - 1);
  const paying = year - loanStart < p.loanYears;
  const cashFlow = 12 * (p.monthlyRentCents - p.monthlyCostsCents) * inflate(year) - (paying ? payYearly : 0);
  const purchaseCash =
    !p.owned && year === p.purchaseYear
      ? p.valueCents * inflate(p.purchaseYear!) * ((p.downPaymentPct + p.closingCostPct) / 100)
      : 0;

  return {
    cashFlowCents: Math.round(cashFlow),
    equityStartCents: Math.round(equityStart),
    equityEndCents: Math.round(equityEnd(year)),
    purchaseCashCents: Math.round(purchaseCash),
  };
}

export type RentalsYear = {
  /** Net rent after tax (tax only on a positive total). */
  cashAfterTaxCents: number;
  equityStartCents: number;
  equityEndCents: number;
  purchaseCashCents: number;
  /** Per property, monthly, after tax — for the income breakdown. */
  parts: { name: string; monthlyAfterTaxCents: number; monthlyBeforeTaxCents: number }[];
};

export function rentalsForYear(
  rentals: RentalProperty[],
  year: number,
  thisYear: number,
  inflationPct: number,
  taxPct: number,
): RentalsYear {
  const keep = 1 - taxPct / 100;
  const out: RentalsYear = { cashAfterTaxCents: 0, equityStartCents: 0, equityEndCents: 0, purchaseCashCents: 0, parts: [] };
  for (const p of rentals) {
    const r = rentalForYear(p, year, thisYear, inflationPct);
    if (!r) continue;
    const after = r.cashFlowCents > 0 ? Math.round(r.cashFlowCents * keep) : r.cashFlowCents;
    out.cashAfterTaxCents += after;
    out.equityStartCents += r.equityStartCents;
    out.equityEndCents += r.equityEndCents;
    out.purchaseCashCents += r.purchaseCashCents;
    out.parts.push({
      name: p.name,
      monthlyAfterTaxCents: Math.round(after / 12),
      monthlyBeforeTaxCents: Math.round(r.cashFlowCents / 12),
    });
  }
  return out;
}

/** A rental_properties row as the database returns it. */
export type RentalRow = {
  id: string;
  name: string;
  property_account_id: string | null;
  loan_account_id: string | null;
  purchase_year: number | null;
  value_cents: number;
  down_payment_pct: number | string;
  closing_cost_pct: number | string;
  loan_balance_cents: number | null;
  loan_rate_pct: number | string;
  loan_years: number;
  monthly_rent_cents: number;
  monthly_costs_cents: number;
  appreciation_pct: number | string;
};

/**
 * Rows → the model. A linked Property account supplies the value, and the
 * mortgage linked to it on Accounts the balance owed — Accounts stays the one
 * place those live. Unlinked, the typed balance is used.
 */
export function toRentalProperty(
  row: RentalRow,
  balanceByAccount: Map<string, number>,
  /** Mortgage balance linked to each Property account on Accounts. */
  loanByProperty: Map<string, number> = new Map(),
): RentalProperty {
  const linkedValue = row.property_account_id ? balanceByAccount.get(row.property_account_id) : undefined;
  const linkedLoan = row.property_account_id ? loanByProperty.get(row.property_account_id) : undefined;
  return {
    id: row.id,
    name: row.name,
    owned: row.property_account_id != null || row.purchase_year == null,
    purchaseYear: row.purchase_year,
    valueCents: linkedValue ?? row.value_cents,
    downPaymentPct: Number(row.down_payment_pct),
    closingCostPct: Number(row.closing_cost_pct),
    loanBalanceCents: linkedLoan != null ? Math.abs(linkedLoan) : row.loan_balance_cents,
    loanRatePct: Number(row.loan_rate_pct),
    loanYears: row.loan_years,
    monthlyRentCents: row.monthly_rent_cents,
    monthlyCostsCents: row.monthly_costs_cents,
    appreciationPct: Number(row.appreciation_pct),
  };
}

