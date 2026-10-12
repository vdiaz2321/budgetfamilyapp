/**
 * When the portfolio can pay for the life the household already lives.
 *
 * Every figure is in the dollars of the year it lands in. Investments grow at
 * the expected rate of return; savings (checking and savings buckets) at the
 * savings APY, and each year's saving is split between the two. Retired pay,
 * VA, Social Security and other income rise by the COLA each year; spending,
 * healthcare and rentals by inflation — so a 2033 figure is what 2033
 * actually pays. Spending is what the table says for that year, grown by
 * inflation from the year it was typed.
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
// Military retired pay, VA disability and Social Security all get a yearly
// COLA, so each rises by the plan's COLA rate every year.

/** What an amount now has grown to by `year` at `pct` a year. */
export function inflateTo(year: number, thisYear: number, pct: number): number {
  return Math.pow(1 + pct / 100, Math.max(0, year - thisYear));
}

export type IncomeLineKind = "va" | "social_security" | "job" | "spouse" | "other";

export const INCOME_LINE_KINDS: { value: IncomeLineKind; label: string }[] = [
  { value: "va", label: "VA disability" },
  { value: "social_security", label: "Social Security" },
  { value: "job", label: "Second job" },
  { value: "spouse", label: "Spouse income" },
  { value: "other", label: "Other" },
];

/** A source of income that switches on and off by year. */
export type IncomeLine = {
  id: string;
  name: string;
  kind: IncomeLineKind;
  /** Per month at current rates, before tax; rises with inflation. */
  monthlyCents: number;
  /** First year received; null = already arriving. */
  startYear: number | null;
  /** Last year received (inclusive); null = for life. */
  endYear: number | null;
  taxable: boolean;
};

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
  /** The yearly COLA once retired pay starts. */
  colaPct: number;
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
  /** Yearly COLA after the retirement year. */
  colaPct: number;
};

/** Gross retired pay and SBP per month in `year`, with every COLA since retiring. */
function pensionIn(p: PensionEstimate, year: number) {
  const cola = inflateTo(year, p.retireYear, p.colaPct);
  return { gross: Math.round(p.grossAtRetireCents * cola), sbp: Math.round(p.sbpAtRetireCents * cola) };
}

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
    colaPct: p.colaPct,
  };
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
  thisYear: number,
  colaPct: number,
): YearIncome {
  const keep = 1 - taxPct / 100;
  const parts: IncomePart[] = [];
  if (pension && pensionStartYear != null && year >= pensionStartYear) {
    const { gross, sbp } = pensionIn(pension, year);
    parts.push({
      name: "Military retired pay",
      kind: "pension",
      monthlyAfterTaxCents: Math.round((gross - sbp) * keep),
      monthlyBeforeTaxCents: gross - sbp,
    });
  }
  const lineGrowth = inflateTo(year, thisYear, colaPct);
  for (const line of lines) {
    if (!active(year, line.startYear, line.endYear) || line.monthlyCents <= 0) continue;
    const monthly = Math.round(line.monthlyCents * lineGrowth);
    parts.push({
      name: line.name,
      kind: line.kind,
      monthlyAfterTaxCents: Math.round(monthly * (line.taxable ? keep : 1)),
      monthlyBeforeTaxCents: monthly,
    });
  }
  const afterTaxCents = parts.reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  const guaranteedCents = parts
    .filter((p) => GUARANTEED_KINDS.has(p.kind))
    .reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  return { parts, afterTaxCents, guaranteedCents };
}

/**
 * The same year's income if Victor has died and Jo is the survivor:
 * - retired pay becomes the SBP annuity, 55% of gross retired pay (taxable),
 *   or nothing when SBP wasn't elected;
 * - VA disability and a second job stop — they were his;
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
  thisYear: number,
  colaPct: number,
): YearIncome {
  const keep = 1 - taxPct / 100;
  const parts: IncomePart[] = [];
  if (pension && sbpEnabled && pensionStartYear != null && year >= pensionStartYear) {
    const annuity = Math.round(pensionIn(pension, year).gross * 0.55);
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
  const lineGrowth = inflateTo(year, thisYear, colaPct);
  for (const line of live) {
    if (line.kind === "va" || line.kind === "job") continue;
    if (line.kind === "social_security" && line !== largestSs) continue;
    const monthly = Math.round(line.monthlyCents * lineGrowth);
    parts.push({
      name: line.kind === "social_security" ? "Social Security (survivor)" : line.name,
      kind: line.kind,
      monthlyAfterTaxCents: Math.round(monthly * (line.taxable ? keep : 1)),
      monthlyBeforeTaxCents: monthly,
    });
  }
  const afterTaxCents = parts.reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  const guaranteedCents = parts
    .filter((p) => GUARANTEED_KINDS.has(p.kind))
    .reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  return { parts, afterTaxCents, guaranteedCents };
}

export type HealthPlanKind = "tricare_prime" | "tricare_select" | "private";

export type HealthPlan = { kind: HealthPlanKind; annualCents: number };

/** A stored `health_plans` list, with anything malformed dropped. */
export function parseHealthPlans(raw: unknown): HealthPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const kind = p?.kind;
    const cents = Number(p?.annualCents);
    if (kind !== "tricare_prime" && kind !== "tricare_select" && kind !== "private") return [];
    return [{ kind, annualCents: Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0 }];
  });
}

export type HealthcarePlan = {
  birthYear: number | null;
  /** Military retirement — the health plan and dental & vision start then. */
  retireYear: number | null;
  retireMonth: number | null;
  /** Every health plan's premium per year, added up (TRICARE Prime/Select,
   *  private), from retirement until TRICARE For Life starts. */
  planAnnualCents: number | null;
  /** TRICARE For Life: the Medicare Part B premium per year, from `tflStartAge`. */
  tflAnnualCents: number | null;
  tflStartAge: number;
  /** Dental & vision per year, from retirement on (TFL covers neither). */
  dentalVisionAnnualCents: number | null;
  /** How much faster than inflation medical costs rise, % a year. */
  growthPct: number;
  inflationPct: number;
};

/**
 * Healthcare as its own yearly cost, rising inflation + `growthPct` a year
 * (medical costs run ahead of prices overall), counted from this year. Three lines: the health plan from military retirement until
 * TRICARE For Life starts, TFL (Medicare Part B) from its start age, and
 * dental & vision from retirement on. The retirement year only pays from the
 * retirement month.
 */
export function healthcareForYear(year: number, plan: HealthcarePlan, thisYear: number): number {
  const retiredShare = retiredShareOfYear(year, plan.retireYear, plan.retireMonth);
  const onTfl = plan.birthYear != null && year - plan.birthYear >= plan.tflStartAge;
  const base =
    (onTfl ? plan.tflAnnualCents ?? 0 : (plan.planAnnualCents ?? 0) * retiredShare) +
    (plan.dentalVisionAnnualCents ?? 0) * retiredShare;
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

