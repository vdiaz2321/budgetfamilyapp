import { projectSnowball } from "./snowball";

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
  /** Retired pay, VA and Social Security that year, after tax. When present it
   *  replaces the flat guaranteed-income figure for that year. */
  guaranteedCents?: number;
  /** That year's gains when the table has worked them out (they include
   *  rental equity). Omitted: the real return on the opening balance. */
  growthCents?: number;
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
  /**
   * Income that arrives whether or not the portfolio does — a pension, VA
   * disability, Social Security — per year, in today's money. It is subtracted
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
  /** Guaranteed income received that year, in today's money. */
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
    realReturnPct,
    withdrawalRatePct,
    maxYears = 60,
    schedule,
    guaranteedIncomeCents = 0,
    guaranteedIncomeStartYear = null,
    untilYear = null,
  } = inputs;

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
  // A pension (or VA, or Social Security) pays from its start year onward and
  // is already in today's money, like everything else here.
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
    const scheduled = byYear.get(year)?.growthCents;
    const growth = scheduled ?? (start > 0 ? Math.round((start * realReturnPct) / 100) : 0);
    const end = start + growth + contributionCents;
    balance = end;
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

/** Age in a given calendar year, when a birth year is known. */
export function ageInYear(birthYear: number | null, year: number): number | null {
  return birthYear ? year - birthYear : null;
}

// ---- Retirement income, year by year.
//
// Everything below is in today's dollars, like the rest of this file. Military
// retired pay, VA disability and Social Security all get a yearly COLA tied to
// inflation, so in today's dollars each is a flat line — the raise is already
// "in" the number, and there is nothing yearly to guess.

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
  /** Per month, today's dollars, before tax. */
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
  /** Year service began; years of service = retireYear − this. */
  serviceStartYear: number | null;
  /** High-3 average monthly basic pay, in retirement-year dollars. */
  high3MonthlyCents: number | null;
  /** General inflation used to bring High-3 back to today's dollars. */
  inflationPct: number;
  sbpEnabled: boolean;
  /** SBP premium, % of gross retired pay (6.5% today). */
  sbpPct: number;
};

export type PensionEstimate = {
  yearsOfService: number;
  /** 2.5% per year of service (DFAS High-3 formula). */
  multiplierPct: number;
  /** Gross monthly retired pay in retirement-year dollars, as DFAS would quote it. */
  grossAtRetireCents: number;
  /** The same, brought back to today's dollars. */
  grossTodayCents: number;
  /** SBP premium per month, today's dollars (0 when not elected). */
  sbpTodayCents: number;
};

/** DFAS: High-3 × (2.5% × years of service), rounded down to the dollar. */
export function estimatePension(p: MilitaryPension, thisYear: number): PensionEstimate | null {
  if (p.retireYear == null || p.serviceStartYear == null || !p.high3MonthlyCents) return null;
  const yearsOfService = Math.max(0, p.retireYear - p.serviceStartYear);
  const multiplierPct = 2.5 * yearsOfService;
  const grossAtRetireCents = Math.floor((p.high3MonthlyCents * multiplierPct) / 100 / 100) * 100;
  const yearsAway = Math.max(0, p.retireYear - thisYear);
  const grossTodayCents = Math.round(grossAtRetireCents / Math.pow(1 + p.inflationPct / 100, yearsAway));
  const sbpTodayCents = p.sbpEnabled ? Math.round((grossTodayCents * p.sbpPct) / 100) : 0;
  return { yearsOfService, multiplierPct, grossAtRetireCents, grossTodayCents, sbpTodayCents };
}

export type IncomePart = {
  name: string;
  kind: IncomeLineKind | "pension";
  /** Per month, today's dollars, after SBP and tax. */
  monthlyAfterTaxCents: number;
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
): YearIncome {
  const keep = 1 - taxPct / 100;
  const parts: IncomePart[] = [];
  if (pension && pensionStartYear != null && year >= pensionStartYear) {
    parts.push({
      name: "Military retired pay",
      kind: "pension",
      monthlyAfterTaxCents: Math.round((pension.grossTodayCents - pension.sbpTodayCents) * keep),
    });
  }
  for (const line of lines) {
    if (!active(year, line.startYear, line.endYear) || line.monthlyCents <= 0) continue;
    parts.push({
      name: line.name,
      kind: line.kind,
      monthlyAfterTaxCents: Math.round(line.monthlyCents * (line.taxable ? keep : 1)),
    });
  }
  const afterTaxCents = parts.reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  const guaranteedCents = parts
    .filter((p) => GUARANTEED_KINDS.has(p.kind))
    .reduce((s, p) => s + p.monthlyAfterTaxCents * 12, 0);
  return { parts, afterTaxCents, guaranteedCents };
}

/**
 * Healthcare as its own yearly cost: today's dollars from the start age on,
 * rising `growthPct` a year faster than general inflation (medical costs run
 * ahead of it), counted from this year.
 */
export function healthcareForYear(
  year: number,
  birthYear: number | null,
  plan: { annualCents: number | null; startAge: number; growthPct: number },
  thisYear: number,
): number {
  if (!plan.annualCents || birthYear == null) return 0;
  if (year - birthYear < plan.startAge) return 0;
  return Math.round(plan.annualCents * Math.pow(1 + plan.growthPct / 100, Math.max(0, year - thisYear)));
}

// ---- Rental properties.
//
// Everything is in today's dollars like the rest of the plan, except the
// mortgage: its payment is fixed in nominal dollars, so it is worked out in
// nominal terms and deflated each year. That is the honest version — inflation
// quietly shrinks a fixed mortgage, and a rental's cash flow improves with it.

export type RentalProperty = {
  id: string;
  name: string;
  /** Owned (linked to Accounts, or typed as owned) vs a planned purchase. */
  owned: boolean;
  /** Planned purchases: the year it is bought. */
  purchaseYear: number | null;
  /** Planned: price in today's dollars. Owned: current value. */
  valueCents: number;
  downPaymentPct: number;
  closingCostPct: number;
  /** Owned: what is owed today (nominal = today's dollars now). */
  loanBalanceCents: number | null;
  loanRatePct: number;
  /** Planned: loan term. Owned: years left. */
  loanYears: number;
  monthlyRentCents: number;
  monthlyCostsCents: number;
  /** Value growth above inflation. */
  appreciationPct: number;
};

export type RentalYear = {
  /** Rent − costs − mortgage payment for the year, today's dollars, before tax. */
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
  const deflate = (y: number) => Math.pow(1 + inflationPct / 100, Math.max(0, y - thisYear));
  const firstYear = p.owned ? thisYear + 1 : p.purchaseYear;
  if (firstYear == null || year < firstYear) return null;

  // Loan in nominal dollars from the year it starts.
  const valueBase = p.owned ? thisYear : p.purchaseYear!;
  const principal = p.owned
    ? p.loanBalanceCents ?? 0
    : p.valueCents * deflate(p.purchaseYear!) * (1 - p.downPaymentPct / 100);
  const payYearly = monthlyPayment(principal, p.loanRatePct, p.loanYears) * 12;
  const loanStart = p.owned ? thisYear + 1 : p.purchaseYear!;

  const equityEnd = (y: number) => {
    const value = p.valueCents * Math.pow(1 + p.appreciationPct / 100, y - valueBase);
    const owed = balanceAfter(principal, p.loanRatePct, p.loanYears, y - loanStart + 1) / deflate(y);
    return value - owed;
  };
  const equityStart =
    year === firstYear
      ? p.owned
        ? p.valueCents - principal
        : 0
      : equityEnd(year - 1);
  const paying = year - loanStart < p.loanYears;
  const cashFlow = 12 * (p.monthlyRentCents - p.monthlyCostsCents) - (paying ? payYearly / deflate(year) : 0);
  const purchaseCash =
    !p.owned && year === p.purchaseYear
      ? p.valueCents * ((p.downPaymentPct + p.closingCostPct) / 100)
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
  parts: { name: string; monthlyAfterTaxCents: number }[];
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
    out.parts.push({ name: p.name, monthlyAfterTaxCents: Math.round(after / 12) });
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

// ---- Debt payoffs.

export type PlanDebt = {
  id: string;
  balanceCents: number;
  /** What is paid each month toward principal + interest (escrow excluded). */
  paymentCents: number;
  apr: number;
  promoEndsOn: string | null;
  postPromoApr: number | null;
};

/**
 * The yearly payment each paid-off debt no longer needs, by calendar year.
 * Same projection as Debt/Loans' "My Plan": every debt pays its own planned
 * amount, independently (no snowball waterfall). A year only frees the months
 * after the payoff, so the year it's paid off frees part of a year.
 */
export function debtFreedByYear(
  debts: PlanDebt[],
  startMonth: string,
  fromYear: number,
  toYear: number,
): Map<number, number> {
  const live = debts.filter((d) => d.balanceCents > 0 && d.paymentCents > 0);
  const out = new Map<number, number>();
  if (live.length === 0) return out;
  const { ledger } = projectSnowball(
    live.map((d) => ({
      id: d.id,
      balanceCents: d.balanceCents,
      minCents: d.paymentCents,
      apr: d.apr,
      promoEndsOn: d.promoEndsOn,
      postPromoApr: d.postPromoApr,
    })),
    0,
    startMonth,
    Math.max(12, (toYear - fromYear + 2) * 12),
    true,
  );
  const yearlyBudget = 12 * live.reduce((s, d) => s + d.paymentCents, 0);
  const paidByYear = new Map<number, number>();
  for (const entries of ledger.values()) {
    for (const e of entries) {
      const y = Number(e.month.slice(0, 4));
      paidByYear.set(y, (paidByYear.get(y) ?? 0) + e.paymentCents);
    }
  }
  for (let y = fromYear; y <= toYear; y++) {
    out.set(y, Math.max(0, yearlyBudget - (paidByYear.get(y) ?? 0)));
  }
  return out;
}
