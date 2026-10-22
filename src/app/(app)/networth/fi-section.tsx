"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { usePersistentCollapse, useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, formatMoney, formatMoneyWhole } from "@/lib/money";
import {
  INCOME_LINE_KINDS,
  ageInYear,
  colaAverage,
  firstColaShare,
  firstPensionColaYear,
  lineColaBase,
  estimatePension,
  high3FromBasePay,
  high3Window,
  incomeForYear,
  inflateTo,
  investShareOfNew,
  projectFi,
  rentalForYear,
  rentalsForYear,
  survivorIncomeForYear,
  diesOnActiveDuty,
  survivorLumpSums,
  ssPiaCents,
  vgliMonthlyPremiumCents,
  SGLI_STEPS_CENTS,
  SBP_DIC_REMARRY_AGE,
  SS_WIDOW_REMARRY_AGE,
  type ActiveDutyDeath,
  type InsurancePayout,
  type MilitaryInsurance,
  type PlanChild,
  type ColaPlan,
  type FiScheduleYear,
  type HealthPlan,
  type HealthPlanKind,
  type CostDates,
  type DentalPlan,
  type DentalPlanKind,
  DENTAL_PLAN_KINDS,
  type IncomeLine,
  type IncomeLineKind,
  type RentalProperty,
  type RentalRow,
  planEndYear,
} from "@/lib/retirement";
import { saveRetirementPlan, setWithdrawalRate } from "./actions";
import {
  GROUP_KINDS,
  GROUP_LABEL,
  isGroupKind,
  groupAccountNames,
  type GroupKind,
} from "@/lib/account-groups";
import type { GroupInputs } from "@/lib/account-groups-load";
import { PctBox } from "@/components/pct-box";
import { applySsRecord, benefitAtStartCents, recordDeathPia, recordRetirementPiaCents, type SsRecord } from "@/lib/ssa";
import { SsRecordSection } from "./ss-record";

export type FiPlan = {
  birthYear: number | null;
  targetRetireYear: number | null;
  /** First month on retired pay (1–12); null = the whole year. */
  targetRetireMonth: number | null;
  annualSpendCents: number | null;
  annualContributionCents: number | null;
  /** Expected yearly return on investments. */
  investmentReturnPct: number;
  withdrawalRatePct: number;
  /** When withdrawals at that rate start; null = the military retirement year. */
  withdrawStartYear: number | null;
  /** Spouse's expected retirement year; null = not set. */
  spouseRetireYear: number | null;
  /** Spouse's birth year; null = no spouse on the plan (hides Spouse Age). */
  spouseBirthYear: number | null;
  /** The age a spouse with no record of her own starts the spousal benefit; null = none. */
  spouseSsClaimAge: number | null;
  /** The Social Security earnings record; null = Social Security as typed on its line. */
  ssRecord: SsRecord | null;
  /** Pension + VA + Social Security per year. */
  guaranteedIncomeCents: number | null;
  /** First year that income arrives; null means it already does. */
  guaranteedIncomeStartYear: number | null;
  /** Military retirement: service start, High-3 (retirement-year dollars). */
  serviceStartYear: number | null;
  serviceStartMonth: number | null;
  high3MonthlyCents: number | null;
  /** Monthly base pay per calendar year (cents) — the High-3 is averaged from these. */
  basePayByYear: Record<string, number>;
  /** Raises spending, healthcare and rental prices each year. */
  inflationPct: number;
  /** What savings (checking + savings buckets) earn a year. */
  cashReturnPct: number;
  /** The COLA: future rate, actual ones by year, and which incomes get it. */
  cola: ColaPlan;
  sbpEnabled: boolean;
  sbpPct: number;
  /** The age the plan runs to. */
  longevityAge: number;
  /** The spouse's plan-until age; the plan runs to whichever ends later. */
  spouseLongevityAge: number;
  /** Children's birth years, for the survivor benefits' age limits. */
  children: PlanChild[];
  /** SGLI held on active duty and VGLI kept after retirement. */
  insurance: MilitaryInsurance;
  /** TRICARE For Life: yearly Medicare Part B premium at current rates
   *  from the start age, rising inflation + growthPct a year. */
  healthcareAnnualCents: number | null;
  /** Health plans from military retirement until TFL, each with its yearly
   *  premium. More than one runs side by side. */
  healthPlans: HealthPlan[];
  /** Dental & vision plans (FEDVIP or private); blank start = retirement month, blank end = for life. */
  dentalPlans: DentalPlan[];
  healthcareStartAge: number;
  healthcareGrowthPct: number;
  incomeLines: IncomeLine[];
  /** Account groups: settings as stored, which account sits where, today's
   *  balances and the last twelve months' contributions. */
  accountGroups: GroupInputs;
  /** Rentals as stored (for editing) and as the model reads them (linked
   *  Accounts balances already applied). */
  rentalRows: RentalRow[];
  rentals: RentalProperty[];
  /** What a rental can link to on Accounts. */
  propertyAccounts: { id: string; name: string; valueCents: number; loanCents: number | null }[];
  /** From the Estate guide: life insurance payouts (once) and survivor
   *  benefits like VA DIC (monthly, tax-free). */
  survivorExtras: {
    insurance: { name: string; cents: number }[];
    benefits: { name: string; monthlyCents: number }[];
  };
};

export type FiMeasured = {
  /** Every asset on the Accounts page at the last finished month's close (its
   *  Assets card: no kids accounts, no cards or loans, debts netted off) —
   *  cash and savings included. */
  assetsCents: number;
  /** Checking + savings buckets now (live) — grown at the savings APY. */
  cashCents: number;
  /** Investment accounts now (live). */
  investCents: number;
  /** The month `assetsCents` closed (YYYY-MM-01); null = live balances. */
  asOfMonth: string | null;
  /** Bills + expenses over the last twelve months. */
  spendCents: number;
  /** Into savings and investments over the last twelve months. */
  contributionCents: number;
  /** The window those two figures were measured over. */
  fromMonth: string;
  toMonth: string;
};

/** The projection grid's own rows, as far as this section needs them. */
export type FiProjectionYear = {
  year: number;
  incomeCents: number;
  spendingCents: number;
  /** Signed one-time effect on that year — a house, a car, a windfall. */
  oneOffCents: number;
  /** The plan's closing net worth for that year — the grid's "Proj EOY NW". */
  eoyCents: number;
  /** That year's tax override on retirement income; null = the default. */
  taxPct: number | null;
  /** "If you die first": % of the year's spending that carries on. */
  survivorPct: number;
  /** Gains: investment return + rental equity change. */
  growthCents: number;
  /** Net worth actually recorded for that year, when there is one. */
  actualCents?: number | null;
};

export function FiSection({
  plan,
  measured,
  currency,
  thisYear,
  projection,
  children,
}: {
  plan: FiPlan;
  measured: FiMeasured;
  currency: string;
  thisYear: number;
  /** Victor's year-by-year plan. When it has future years, they drive the
   *  spending and saving this section projects with. */
  projection: FiProjectionYear[];
  /** Where the pieces go: Current and Projected Net Worth lays them out, so
   *  the plan, its rates and its retirement read as one section. */
  children: (parts: {
    assumptions: React.ReactNode;
    details: React.ReactNode;
    /** Today's Money vs Not Today's Money — one choice for the whole page. */
    todays: boolean;
    setTodays: (v: boolean) => void;
    /** Opens the assumptions at Income (a first Pay line at the amount given). */
    editIncome: (suggestYearlyCents: number | null) => void;
  }) => React.ReactNode;
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-fi", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  // Today's Money: every later year's NET WORTH shrunk by inflation back to
  // this year — the table, these panels and the chart alike, one toggle for
  // the page (Victor, 2026-10-16). Income, spending and gains always show the
  // dollars actually paid: retired pay is the $95,640 the High-3 pays. Kept
  // across logins.
  const [moneyPref, setMoneyPref] = usePersistentCollapse("networth-money", () => ({ todays: true }));
  const todays = moneyPref.todays !== false;
  const setTodays = (v: boolean) => setMoneyPref({ todays: v });
  /** What a dollar in `year` is worth today: 1 for this year and earlier. */
  const deflator = (year: number) =>
    todays ? Math.pow(1 + plan.inflationPct / 100, Math.max(0, year - thisYear)) : 1;
  const sh = (year: number, cents: number) => Math.round(cents / deflator(year));

  // true = open at the top; "sbp" = open scrolled to the SBP box; "income" =
  // open at Income (from a year's Edit income).
  const [editing, setEditing] = useState<boolean | "sbp" | "income">(false);
  const [suggestPayCents, setSuggestPayCents] = useState<number | null>(null);
  const editIncome = (suggest: number | null) => {
    setSuggestPayCents(suggest);
    setEditing("income");
  };

  const portfolioCents = measured.assetsCents;
  // The projection starts from this year's planned year-end net worth (the
  // Current and Projected Net Worth table's own figure), so every future year matches the
  // table exactly.
  const startCents =
    projection.find((p) => p.year === thisYear)?.eoyCents || portfolioCents;
  // The first FULL year with no work at all. A military retirement in
  // November leaves ten months of active-duty pay in that year; a later
  // "stop working" year (a GS or civilian job after the military, or no
  // military at all) wins, since pay runs until then.
  const militaryFullYear =
    plan.targetRetireYear == null
      ? null
      : plan.targetRetireYear + ((plan.targetRetireMonth ?? 1) > 1 ? 1 : 0);
  const stopWorkYear = plan.withdrawStartYear ?? plan.targetRetireYear;
  const firstFullRetiredYear =
    stopWorkYear == null
      ? thisYear + 1
      : Math.max(militaryFullYear ?? stopWorkYear, plan.withdrawStartYear ?? stopWorkYear);

  // Military retired pay from the DFAS High-3 formula; COLAs on top when on.
  const pension = estimatePension(
    {
      retireYear: plan.targetRetireYear,
      retireMonth: plan.targetRetireMonth,
      serviceStartYear: plan.serviceStartYear,
      serviceStartMonth: plan.serviceStartMonth,
      high3MonthlyCents: plan.high3MonthlyCents,
      sbpEnabled: plan.sbpEnabled,
      sbpPct: plan.sbpPct,
    },
  );
  const colaWhen = { thisYear, birthYear: plan.birthYear };
  // A blank end means the line never stops — no end is guessed from a
  // retirement year (Victor, 2026-10-17).
  // With an earnings record saved, Social Security is worked out from it,
  // and a spouse without a record of her own gets the spousal benefit.
  const modelLines = useMemo(
    () =>
      applySsRecord(plan.incomeLines, plan.ssRecord, {
        birthYear: plan.birthYear,
        spouseBirthYear: plan.spouseBirthYear,
        spouseClaimAge: plan.spouseSsClaimAge,
        thisYear,
      }),
    [plan.incomeLines, plan.ssRecord, plan.birthYear, plan.spouseBirthYear, plan.spouseSsClaimAge, thisYear],
  );
  // Income is gross: taxes are budgeted as spending.
  const incomeIn = (year: number) =>
    incomeForYear(year, pension, plan.targetRetireYear, modelLines, 0, plan.cola, colaWhen);
  const rentIn = (year: number) => rentalsForYear(plan.rentals, year, thisYear, plan.inflationPct, 0);

  // The Net Worth Plan table, each year as typed (round figures typed by
  // hand: $90k while the kids are home, $45k once they aren't). Its income already includes the retirement income lines after
  // tax, so saving = income − spending is right in every year, working or not.
  const schedule = useMemo<FiScheduleYear[]>(
    () =>
      projection
        .filter((p) => p.year >= thisYear)
        .map((p) => ({
          year: p.year,
          spendCents: p.spendingCents,
          // Not floored: in retirement spending outruns income and the gap
          // comes out of savings. A one-off moves the portfolio with its sign.
          contributionCents: p.incomeCents - p.spendingCents + p.oneOffCents,
          // Retired pay, VA, Social Security and net rent lower the FI goal —
          // a job or a spouse's pay can stop.
          guaranteedCents:
            incomeIn(p.year).guaranteedCents + Math.max(0, rentIn(p.year).cashAfterTaxCents),
          // The table's own gains, so the chart can't drift from it (they
          // hold rental equity, which earns no investment return).
          growthCents: p.year > thisYear ? p.growthCents : undefined,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projection, thisYear, plan],
  );

  const usingGrid = schedule.length > 0;
  // New savings split like the accounts are today — savings vs investments.
  const toInvestPct = investShareOfNew(measured.cashCents, measured.investCents);
  const untilYear = planEndYear(plan.birthYear, plan.longevityAge, plan.spouseBirthYear, plan.spouseLongevityAge);
  // "Through age 90" when the plan is yours alone; with a spouse the end year
  // can be theirs, so it reads as the year and both ages.
  const lastsTo =
    untilYear != null && plan.spouseBirthYear
      ? `Through ${untilYear} · you ${untilYear - plan.birthYear!}, spouse ${untilYear - plan.spouseBirthYear}`
      : `Through age ${plan.longevityAge}`;
  // The card's version: the two ages drop under the year on a phone, so the
  // label beside it keeps its width.
  const lastsToCard: React.ReactNode =
    untilYear != null && plan.spouseBirthYear ? (
      <>
        Through {untilYear}
        <span className="hidden sm:inline"> · </span>
        <span className="block sm:inline">you {untilYear - plan.birthYear!}, spouse {untilYear - plan.spouseBirthYear}</span>
      </>
    ) : (
      lastsTo
    );

  const fi = useMemo(
    () =>
      projectFi(
        {
          portfolioCents: startCents,
          annualContributionCents: measured.contributionCents,
          annualSpendCents: measured.spendCents,
          returnPct: plan.investmentReturnPct,
          withdrawalRatePct: plan.withdrawalRatePct,
          schedule,
          untilYear,
          cash: { nowCents: measured.cashCents, pct: plan.cashReturnPct, toInvestPct },
        },
        thisYear,
      ),
    [startCents, measured.contributionCents, measured.spendCents, measured.cashCents, plan.investmentReturnPct, plan.cashReturnPct, toInvestPct, plan.withdrawalRatePct, schedule, untilYear, thisYear],
  );

  const fiAge = ageInYear(plan.birthYear, fi.fiYear ?? thisYear);
  // The year withdrawals start — set on its own (a civilian job can follow
  // military retirement), else the military retirement year.
  const withdrawYear = plan.withdrawStartYear ?? plan.targetRetireYear;
  const atTarget = withdrawYear ? fi.years.find((y) => y.year === withdrawYear) ?? null : null;
  // The year the plan first crosses its target. Crossing today has no row in
  // fi.years (it starts next year), so today's figures stand in for it.
  const fiRow =
    fi.fiYear == null
      ? null
      : fi.years.find((y) => y.year === fi.fiYear) ?? {
          year: fi.fiYear,
          endCents: startCents,
          targetCents: fi.fiNumberCents,
          spendCents: schedule.find((y) => y.year === fi.fiYear)?.spendCents ?? measured.spendCents,
          guaranteedCents: 0,
        };

  // Net worth at age 80.
  const endAt = (age: number) =>
    plan.birthYear ? fi.years.find((y) => y.year === plan.birthYear! + age)?.endCents ?? null : null;
  const at80 = endAt(80);
  const runsOutAge = fi.runsOutYear && plan.birthYear ? fi.runsOutYear - plan.birthYear : null;

  // Monthly income by source in a retired year — the first FULL year of
  // military retirement until another is picked (Victor, 2026-10-15). Always
  // a row of the table, so "Left to save" matches it.
  const [incomeYearPick, setIncomeYear] = useState<number | null>(null);
  const incomeYear = Math.max(firstFullRetiredYear, incomeYearPick ?? firstFullRetiredYear);
  const retireIncome = (() => {
    if (stopWorkYear == null) return null;
    const base = incomeIn(incomeYear);
    const rent = rentIn(incomeYear);
    const parts = [
      ...base.parts,
      ...rent.parts.map((r) => ({
        name: `Rent: ${r.name}`,
        kind: "other" as const,
        monthlyAfterTaxCents: r.monthlyAfterTaxCents,
        monthlyBeforeTaxCents: r.monthlyBeforeTaxCents,
        months: 12 as number,
        firstMonth: undefined as number | undefined,
      })),
    ];
    return {
      parts,
      afterTaxCents: base.afterTaxCents + rent.cashAfterTaxCents,
      taxPct: 0,
      // The tax is whatever separates the before- and after-tax rows, so the
      // breakdown always adds up exactly.
      taxMonthly:
        parts.reduce((t, p) => t + p.monthlyBeforeTaxCents, 0) -
        parts.reduce((t, p) => t + p.monthlyAfterTaxCents, 0),
    };
  })();
  // The year the Investments panel checks: when withdrawals start, otherwise
  // the year the plan becomes financially free.
  const mile = atTarget ?? fiRow;
  // The picked year's spending from the Year by year table — whether or not
  // a military retirement year is set (a blank one read as $0).
  const retireSpendYearly = projection.find((p) => p.year === incomeYear)?.spendingCents ?? 0;
  const retireSpendMonthly = Math.round(retireSpendYearly / 12);
  const ssLine = plan.incomeLines.find((l) => l.kind === "social_security" && l.startYear != null) ?? null;

  // ---- Bad-market test: the same plan, but the portfolio drops in the year
  // retirement starts, the worst year for it to happen. Drawn on the chart
  // rather than as its own card (Victor, 2026-10-15); off until a drop is
  // picked, so the chart opens clean.
  const [dropPct, setDropPct] = useState<number | null>(null);
  // What the chart's bars show: net worth, or each year's income against
  // spending (Victor, 2026-10-15). One chart either way.
  const [chartView, setChartView] = useState<"nw" | "flow">("nw");
  const shockYear = Math.max(thisYear + 1, withdrawYear ?? fi.fiYear ?? thisYear + 1);
  const baseInputs = {
    portfolioCents: startCents,
    annualContributionCents: measured.contributionCents,
    annualSpendCents: measured.spendCents,
    returnPct: plan.investmentReturnPct,
    withdrawalRatePct: plan.withdrawalRatePct,
    untilYear,
    cash: { nowCents: measured.cashCents, pct: plan.cashReturnPct, toInvestPct },
  };
  const stressed = useMemo(
    () =>
      dropPct == null ? null : projectFi({ ...baseInputs, schedule, shock: { year: shockYear, pct: dropPct } }, thisYear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startCents, measured.contributionCents, measured.spendCents, measured.cashCents, plan.investmentReturnPct, plan.cashReturnPct, toInvestPct, plan.withdrawalRatePct, schedule, untilYear, thisYear, shockYear, dropPct],
  );
  const endOf = (years: { year: number; endCents: number }[]) =>
    untilYear == null ? null : years.find((y) => y.year === untilYear)?.endCents ?? null;
  const shockRow = stressed?.years.find((y) => y.year === shockYear) ?? null;
  const planEnd = endOf(fi.years);
  const stressEnd = stressed ? endOf(stressed.years) : null;

  // ---- Survivor view: the plan from `deathYear` on, if Victor dies first.
  // From next year (Victor, 2026-10-19): his pay is its own income line now,
  // so a death while still working drops it like any other of his incomes.
  const survivorFirst = thisYear + 1;
  // The family's spending after his death: each year's Total Spending times
  // that year's survivor % from Year by year (carried; 100% when none typed).
  const survSpendIn = (year: number) => (projection.find((p) => p.year === year) ?? projection.at(-1))?.survivorPct ?? 100;
  const [deathYearPick, setDeathYear] = useState<number | null>(null);
  const deathYear = Math.max(survivorFirst, deathYearPick ?? survivorFirst);
  const insuranceCents = plan.survivorExtras.insurance.reduce((t, i) => t + i.cents, 0);
  const benefitsMonthly = plan.survivorExtras.benefits.reduce((t, b) => t + b.monthlyCents, 0);
  // What-if: the spouse remarries in a year picked on the card (Victor,
  // 2026-10-20). Before 55 her SBP and DIC stop; before 60 her Social
  // Security widow benefit; any remarriage, the caregiver benefit. Only the
  // years up to 59 are offered — later it changes nothing. Not saved.
  const [remarryPick, setRemarryPick] = useState<number | null>(null);
  const remarryOptions =
    plan.spouseBirthYear == null
      ? []
      : Array.from(
          { length: Math.max(0, plan.spouseBirthYear + SS_WIDOW_REMARRY_AGE - 1 - deathYear) },
          (_, i) => deathYear + 1 + i,
        );
  const remarryYear = remarryPick != null && remarryOptions.includes(remarryPick) ? remarryPick : null;
  const remarryAge = remarryYear != null && plan.spouseBirthYear != null ? remarryYear - plan.spouseBirthYear : null;
  // A death before retired pay starts is an active-duty death: automatic SBP
  // and DIC from that year, worked out on the saved High-3 (Victor,
  // 2026-10-19). It reads a little high for an early year, whose real High-3
  // would be lower.
  const activeDuty: ActiveDutyDeath | null =
    diesOnActiveDuty(pension, deathYear) && plan.high3MonthlyCents
      ? {
          deathYear,
          high3MonthlyCents: plan.high3MonthlyCents,
          hasSpouse: plan.spouseBirthYear != null,
          children: plan.children,
          spouseEndsYear: remarryAge != null && remarryAge < SBP_DIC_REMARRY_AGE ? remarryYear : null,
        }
      : null;
  // The death gratuity and SGLI (active duty) or VGLI (retired), paid once
  // in the death year — unless SGLI/VGLI comes as 36 monthly payments.
  const militaryLumps = pension ? survivorLumpSums(activeDuty, plan.insurance, !activeDuty) : [];
  const lumpCents = insuranceCents + militaryLumps.reduce((t, l) => t + l.cents, 0);
  const survIn = (year: number) =>
    survivorIncomeForYear(
      year,
      pension,
      plan.targetRetireYear,
      plan.sbpEnabled,
      modelLines,
      0,
      plan.cola,
      colaWhen,
      activeDuty,
      { deathYear, insurance: pension ? plan.insurance : null },
      // Social Security on his record for the spouse and children.
      {
        spouseBirthYear: plan.spouseBirthYear,
        children: plan.children,
        remarryYear,
        // SSA's PIA for a death that year: only the years worked by then.
        deathPia:
          plan.ssRecord && plan.birthYear != null
            ? (y: number) => recordDeathPia(plan.ssRecord!, plan.birthYear!, y, thisYear)
            : null,
      },
    );
  const survivor = useMemo(() => {
    if (!usingGrid || untilYear == null) return null;
    // The plan's years carried forward to the plan-until year, so a death
    // after the table ends still changes something.
    const full: FiScheduleYear[] = [...schedule];
    const last = full.at(-1);
    if (last) for (let y = last.year + 1; y <= untilYear; y++) full.push({ ...last, year: y, growthCents: undefined });
    const survSchedule = full.map((y) => {
      if (y.year < deathYear) return y;
      const base = incomeIn(y.year);
      const surv = survIn(y.year);
      const rent = Math.max(0, rentIn(y.year).cashAfterTaxCents);
      const benefits = benefitsMonthly * 12;
      const spend = Math.round((y.spendCents * survSpendIn(y.year)) / 100);
      return {
        year: y.year,
        spendCents: spend,
        // Spending cut to the survivor %; his income out, the survivor's in,
        // the payout once.
        contributionCents:
          y.contributionCents + (y.spendCents - spend) - base.afterTaxCents + surv.afterTaxCents + benefits + (y.year === deathYear ? lumpCents : 0),
        guaranteedCents: surv.guaranteedCents + benefits + rent,
      };
    });
    return projectFi({ ...baseInputs, schedule: survSchedule, ownGrowthFrom: deathYear }, thisYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, usingGrid, untilYear, deathYear, remarryYear, lumpCents, benefitsMonthly, plan, projection, thisYear, startCents]);
  // The family's income the year she remarries, for the card.
  const afterRemarry = remarryYear == null ? null : survIn(remarryYear);
  // The first survivor year, month by month, for the card.
  const survivorYear = (() => {
    const surv = survIn(deathYear);
    const spendYearly = projection.find((p) => p.year === deathYear)?.spendingCents ?? schedule.at(-1)?.spendCents ?? 0;
    const beforeTax = surv.parts.reduce((t, p) => t + p.monthlyBeforeTaxCents, 0);
    const afterTax = surv.parts.reduce((t, p) => t + p.monthlyAfterTaxCents, 0);
    const benefits = benefitsMonthly;
    return {
      tax: 0,
      parts: surv.parts,
      taxMonthly: beforeTax - afterTax,
      afterTaxMonthly: afterTax + benefits,
      // Counts a line's first year only from its start month.
      afterTaxYearly: surv.afterTaxCents + benefits * 12,
      spendMonthly: Math.round((spendYearly * survSpendIn(deathYear)) / 100 / 12),
      spendPct: survSpendIn(deathYear),
      // Your income that year that the family no longer gets — named on the
      // card so a $0 total reads as "these stopped", not as a missing figure.
      stops: incomeIn(deathYear)
        // Social Security carries on as the survivor benefit under its own
        // name, so it isn't "stopped".
        .parts.filter(
          (p) =>
            p.monthlyBeforeTaxCents > 0 &&
            !surv.parts.some((q) => q.name === p.name || (q.kind === "social_security" && p.kind === "social_security")),
        )
        .map((p) => p.name),
    };
  })();
  const yearOptions =
    untilYear == null ? [] : Array.from({ length: Math.max(0, untilYear - survivorFirst + 1) }, (_, i) => survivorFirst + i);
  // The Income card's years: retired years the table has a row for.
  const lastPlanYear = projection.at(-1)?.year ?? firstFullRetiredYear;
  const incomeYearOptions = Array.from(
    { length: Math.max(1, Math.min(untilYear ?? lastPlanYear, lastPlanYear) - firstFullRetiredYear + 1) },
    (_, i) => firstFullRetiredYear + i,
  );

  // The chart's net worth in the chosen money; income, spending and gains
  // stay the dollars actually paid, like the table.
  const fiShown = {
    ...fi,
    years: fi.years.map((y) => ({
      ...y,
      startCents: sh(y.year, y.startCents),
      endCents: sh(y.year, y.endCents),
      targetCents: sh(y.year, y.targetCents),
    })),
  };
  const projectionShown = projection.map((p) => ({
    ...p,
    eoyCents: sh(p.year, p.eoyCents),
    actualCents: p.actualCents == null ? p.actualCents : sh(p.year, p.actualCents),
  }));

  // The button that opens the rates that rebuild the table, above it.
  // Same pill as Today's Money, set apart by a pencil and a light orange
  // fill — Victor asked for orange (2026-10-18) so it doesn't read as one of
  // the blue Today's / Not Today's Money toggles beside it. An action button,
  // not data, so the no-orange-in-charts rule doesn't apply.
  const assumptions = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-foreground ring-1 ring-orange-300 whitespace-nowrap transition hover:bg-orange-100 sm:text-sm dark:bg-orange-900/40 dark:ring-orange-500/70 dark:hover:bg-orange-800/50"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 3.5l3 3L7 16H4v-3z" />
      </svg>
      Edit Future Projections
    </button>
  );

  // Everything behind the Retirement card, under the table, closed by default.
  const details = (
    <div className="border-t border-line px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 shrink-0 text-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
        <span className="text-sm font-semibold sm:text-lg">Retirement details</span>
      </button>
      {open ? (
        <div>
          {/* Three panels side by side: what retirement pays, what the
              investments have to do about the gap, and the family's income if
              Victor dies first. Each reads top to bottom as one sum. */}
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {retireIncome ? (
              <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
                {/* A year picker in the title, like the survivor card's. */}
                <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm font-bold sm:text-lg">
                  Income in
                  <select
                    value={incomeYear}
                    onChange={(e) => setIncomeYear(Number(e.target.value))}
                    aria-label="Year"
                    className="cursor-pointer rounded-md bg-surface px-1 py-0.5 text-sm font-bold sm:text-lg text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    {incomeYearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  {plan.birthYear ? `· age ${incomeYear - plan.birthYear}` : ""}
                  {incomeYear === firstFullRetiredYear ? (
                    <span className="block basis-full text-xs font-normal sm:text-sm">First full year retired</span>
                  ) : null}
                </p>
                {retireIncome.parts.length === 0 ? (
                  <p className="mt-1 text-center text-xs sm:text-sm text-foreground">No retirement income yet — add it in Edit Future Projections.</p>
                ) : (
                  <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg xl:text-base 2xl:text-lg">
                    <li className="flex justify-between gap-3 py-1 max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
                      <span />
                      <span className="flex shrink-0">
                        <span className="w-[4.5rem] text-right sm:w-24 xl:w-20 2xl:w-24">Monthly</span>
                        <span className="w-[5.75rem] text-right sm:w-28 xl:w-24 2xl:w-28">Yearly</span>
                      </span>
                    </li>
                    {retireIncome.parts.map((part, i) => (
                      <IncomeRow
                        key={i}
                        label={part.name}
                        note={retireIncome.taxMonthly > 0 ? "before tax" : undefined}
                        monthly={part.monthlyBeforeTaxCents}
                        yearly={part.monthlyBeforeTaxCents * (part.months ?? 12)}
                        currency={currency}
                      />
                    ))}
                    {retireIncome.taxMonthly > 0 ? (
                      <IncomeRow
                        label={`Tax (${retireIncome.taxPct}%)`}
                        monthly={-retireIncome.taxMonthly}
                        yearly={-retireIncome.taxMonthly * 12}
                        currency={currency}
                        tone="text-negative"
                      />
                    ) : null}
                    <IncomeRow
                      label={retireIncome.taxMonthly > 0 ? "Income after tax" : "Total income"}
                      monthly={Math.round(retireIncome.afterTaxCents / 12)}
                      yearly={retireIncome.afterTaxCents}
                      currency={currency}
                      tone="text-positive"
                      bold
                    />
                    <IncomeRow
                      label="Planned spending"
                      monthly={-retireSpendMonthly}
                      yearly={-retireSpendYearly}
                      currency={currency}
                      tone="text-negative"
                    />
                    {(() => {
                      const net = Math.round(retireIncome.afterTaxCents / 12) - retireSpendMonthly;
                      const netYearly = retireIncome.afterTaxCents - retireSpendYearly;
                      return (
                        <IncomeRow
                          label={net >= 0 ? "Left to save" : "Gap from savings"}
                          monthly={Math.abs(net)}
                          yearly={Math.abs(netYearly)}
                          currency={currency}
                          tone={net >= 0 ? "text-positive" : "text-negative"}
                          bold
                        />
                      );
                    })()}
                  </ul>
                )}
              </div>
            ) : null}

            <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="text-center text-sm font-bold sm:text-lg">Investments</p>
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg xl:text-base 2xl:text-lg">
                {mile ? (
                  <>
                    {/* No gap means nothing for the investments to fund —
                        said in words, since "$0" read like a missing figure.
                        The % is his to pick right here (Victor, 2026-10-19). */}
                    <ValueRow
                      label={`Needed in ${mile.year}`}
                      note={
                        mile.targetCents > 0 ? (
                          <>
                            Covers a{" "}
                            {formatMoneyWhole(sh(mile.year, Math.round((mile.targetCents * plan.withdrawalRatePct) / 100)), currency)}
                            /yr spending gap,{" "}
                            <span className="whitespace-nowrap">
                              drawing <PctInput key={plan.withdrawalRatePct} pct={plan.withdrawalRatePct} label="Withdrawal rate" save={setWithdrawalRate} /> a year
                            </span>
                          </>
                        ) : (
                          "Retired pay covers spending"
                        )
                      }
                      value={mile.targetCents > 0 ? formatMoneyWhole(sh(mile.year, mile.targetCents), currency) : "Nothing"}
                      tone={mile.targetCents > 0 ? "" : "text-positive"}
                    />
                    <ValueRow label={`Expected in ${mile.year}`} value={formatMoneyWhole(sh(mile.year, mile.endCents), currency)} />
                    <ValueRow
                      label="Status"
                      value={
                        mile.endCents >= mile.targetCents
                          ? "On track"
                          : `Short ${formatMoneyWhole(sh(mile.year, mile.targetCents - mile.endCents), currency)}`
                      }
                      tone={mile.endCents >= mile.targetCents ? "text-positive" : "text-negative"}
                      bold
                    />
                  </>
                ) : null}
                <ValueRow
                  label="Financially free"
                  value={fi.fiYear ? `${fi.fiYear}${fiAge != null ? ` · age ${fiAge}` : ""}` : "Not on this plan"}
                  tone={fi.fiYear ? "" : "text-negative"}
                />
                {/* Whether the investments pay the spending you've typed for
                    every year to the end of the plan (Victor, 2026-10-19). */}
                <ValueRow
                  label="Spending covered"
                  value={
                    untilYear == null
                      ? "Add birth year"
                      : runsOutAge != null
                        ? `Runs out in ${fi.runsOutYear} · age ${runsOutAge}`
                        : lastsToCard
                  }
                  tone={untilYear == null ? "" : runsOutAge != null ? "text-negative" : "text-positive"}
                />
                {/* The plan-until age is the last card above the table. */}
                <ValueRow
                  label="Left at age 80"
                  // The year that age falls in — the balance is its year-end
                  // bar in the chart below.
                  note={plan.birthYear ? `Year: ${plan.birthYear + 80}` : undefined}
                  value={at80 == null ? "—" : formatMoneyWhole(sh(plan.birthYear! + 80, Math.max(0, at80)), currency)}
                />
              </ul>
            </div>

            {/* What-if: the same plan with Victor's income gone from the
                year picked. */}
            <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm font-bold sm:text-lg">
                If you die first, in
                <select
                  value={deathYear}
                  onChange={(e) => setDeathYear(Number(e.target.value))}
                  aria-label="Year"
                  disabled={yearOptions.length === 0}
                  className="cursor-pointer rounded-md bg-surface px-1 py-0.5 text-sm font-bold sm:text-lg text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  {(yearOptions.length ? yearOptions : [deathYear]).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </p>
              {remarryOptions.length > 0 ? (
                <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm">
                  Spouse remarries
                  <select
                    value={remarryYear ?? ""}
                    onChange={(e) => setRemarryPick(e.target.value ? Number(e.target.value) : null)}
                    aria-label="Spouse remarries"
                    className="cursor-pointer rounded-md bg-surface px-1 py-0.5 text-sm font-semibold text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="">Never</option>
                    {remarryOptions.map((y) => (
                      <option key={y} value={y}>
                        {y} · age {y - plan.spouseBirthYear!}
                      </option>
                    ))}
                  </select>
                </p>
              ) : null}
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg xl:text-base 2xl:text-lg">
                <li className="flex justify-between gap-3 py-1 max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
                  <span>Family income</span>
                  <span className="flex shrink-0">
                    <span className="w-[4.5rem] text-right sm:w-24 xl:w-20 2xl:w-24">Monthly</span>
                    <span className="w-[5.75rem] text-right sm:w-28 xl:w-24 2xl:w-28">Yearly</span>
                  </span>
                </li>
                {survivorYear.stops.length > 0 ? (
                  <li className="flex justify-between gap-3 py-1">
                    <span className="min-w-0">Stops</span>
                    <span className="text-right text-negative">{survivorYear.stops.join(" · ")}</span>
                  </li>
                ) : null}
                {survivorYear.parts.map((part, i) => (
                  <IncomeRow
                    key={i}
                    label={
                      part.name.startsWith("DIC (VA") ? (
                        <>
                          {part.name}
                          <a
                            href="https://www.va.gov/family-and-caregiver-benefits/survivor-compensation/dependency-indemnity-compensation/survivor-rates/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-fit text-xs font-semibold underline underline-offset-2 sm:text-sm"
                            style={{ color: "var(--viz-savings)" }}
                          >
                            VA DIC rates
                          </a>
                        </>
                      ) : part.kind === "social_security" && part.name === survivorYear.parts.find((p) => p.kind === "social_security")?.name ? (
                        <>
                          {part.name}
                          <a
                            href="https://www.ssa.gov/survivor/amount"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-fit text-xs font-semibold underline underline-offset-2 sm:text-sm"
                            style={{ color: "var(--viz-savings)" }}
                          >
                            SSA rates
                          </a>
                        </>
                      ) : (
                        part.name
                      )
                    }
                    note={
                      [
                        part.monthlyBeforeTaxCents !== part.monthlyAfterTaxCents ? "before tax" : null,
                        // Paid part of the year: a child turning 16 or 18.
                        part.months && part.months < 12 && part.firstMonth
                          ? `${MONTHS[part.firstMonth - 1]}–${MONTHS[part.firstMonth + part.months - 2]}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    monthly={part.monthlyBeforeTaxCents}
                    yearly={part.monthlyBeforeTaxCents * (part.months ?? 12)}
                    currency={currency}
                  />
                ))}
                {plan.survivorExtras.benefits.map((b) => {
                  const monthly = b.monthlyCents;
                  return <IncomeRow key={b.name} label={b.name} note="from Estate guide" monthly={monthly} yearly={monthly * 12} currency={currency} />;
                })}
                {survivorYear.taxMonthly > 0 ? (
                  <IncomeRow
                    label={`Tax (${survivorYear.tax}%)`}
                    monthly={-survivorYear.taxMonthly}
                    yearly={-survivorYear.taxMonthly * 12}
                    currency={currency}
                    tone="text-negative"
                  />
                ) : null}
                <IncomeRow
                  label={survivorYear.taxMonthly > 0 ? "Income after tax" : "Total income"}
                  monthly={survivorYear.afterTaxMonthly}
                  yearly={survivorYear.afterTaxYearly}
                  currency={currency}
                  tone="text-positive"
                  bold
                />
                <IncomeRow
                  label={survivorYear.spendPct === 100 ? "Planned spending" : `Planned spending (${survivorYear.spendPct}%)`}
                  monthly={-survivorYear.spendMonthly}
                  yearly={-survivorYear.spendMonthly * 12}
                  currency={currency}
                  tone="text-negative"
                />
                {(() => {
                  const net = survivorYear.afterTaxMonthly - survivorYear.spendMonthly;
                  const netYearly = survivorYear.afterTaxYearly - survivorYear.spendMonthly * 12;
                  return (
                    <IncomeRow
                      label={net >= 0 ? "Left to save" : "Gap from savings"}
                      monthly={Math.abs(net)}
                      yearly={Math.abs(netYearly)}
                      currency={currency}
                      tone={net >= 0 ? "text-positive" : "text-negative"}
                      bold
                    />
                  );
                })()}
                {insuranceCents > 0 ? (
                  <ValueRow
                    label="Life insurance payout"
                    note={plan.survivorExtras.insurance.map((i) => i.name).join(" · ")}
                    value={`+${formatMoneyWhole(insuranceCents, currency)}`}
                    tone="text-positive"
                  />
                ) : null}
                {/* What's left once she remarries: before 55 her SBP and DIC
                    stop (the kids' carry on), before 60 her widow benefit. */}
                {afterRemarry && remarryYear != null ? (
                  <IncomeRow
                    label={`Income from ${remarryYear}`}
                    note={`remarried at ${remarryAge}`}
                    monthly={Math.round(afterRemarry.afterTaxCents / 12) + benefitsMonthly}
                    yearly={afterRemarry.afterTaxCents + benefitsMonthly * 12}
                    currency={currency}
                    tone={afterRemarry.afterTaxCents + benefitsMonthly > 0 ? "text-positive" : "text-negative"}
                    bold
                  />
                ) : null}
                {/* Tax-free and paid once, into savings that year. */}
                {militaryLumps.map((l) => (
                  <ValueRow
                    key={l.name}
                    label={`${l.name} (lump sum)`}
                    value={`+${formatMoneyWhole(l.cents, currency)}`}
                    tone="text-positive"
                  />
                ))}
                <ValueRow
                  label="Spending covered"
                  value={
                    !survivor
                      ? untilYear == null ? "Add birth year" : "Add a plan above"
                      : survivor.runsOutYear
                        ? (
                            <>
                              Runs out in {survivor.runsOutYear}
                              {/* The age drops under the year on a phone. */}
                              {plan.spouseBirthYear ? (
                                <span className="block sm:inline">
                                  <span className="hidden sm:inline"> · </span>spouse {survivor.runsOutYear - plan.spouseBirthYear}
                                </span>
                              ) : null}
                            </>
                          )
                        : `Through ${untilYear}`
                  }
                  tone={!survivor ? "" : survivor.runsOutYear ? "text-negative" : "text-positive"}
                  bold
                />
              </ul>
              {activeDuty ? (
                <p className="mt-2 text-center text-xs text-foreground sm:text-sm">
                  Active-duty death: SBP uses your High-3 of {formatMoneyWhole(activeDuty.high3MonthlyCents, currency)}, a bit high for early years.
                </p>
              ) : null}
              {/* Without SBP the retired pay stops at death — said only when
                  there is retired pay in the plan. No button (Victor,
                  2026-10-19): SBP is set in Edit Future Projections. */}
              {!plan.sbpEnabled && pension ? (
                <p className="mt-2 rounded-md bg-negative/10 px-2 py-1.5 text-center text-xs sm:text-sm">
                  <span className="font-semibold text-negative">SBP: off</span> — retired pay stops for the family
                </p>
              ) : null}
            </div>
          </div>

          {/* Which picture the chart draws. */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs sm:text-sm">
            <span className="font-semibold text-foreground">Chart:</span>
            {(
              [
                ["nw", "Net worth"],
                ["flow", "Income & spending"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setChartView(v)}
                aria-pressed={chartView === v}
                className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 transition ${
                  chartView === v
                    ? "bg-sky-100 text-foreground ring-sky-400 dark:bg-sky-900/50"
                    : "bg-surface text-foreground ring-line hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bad-market test, on the chart: pick a drop and each bar gets a
              red mark where that year would close after it. Net worth view
              only — a drop doesn't change income or spending. */}
          {chartView === "nw" ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs sm:text-sm">
            <span className="font-semibold text-foreground">Bad-market test · drop in {shockYear}:</span>
            {[null, 20, 30, 40].map((pct) => (
              <button
                key={pct ?? "off"}
                type="button"
                onClick={() => setDropPct(pct)}
                aria-pressed={dropPct === pct}
                className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 transition ${
                  dropPct === pct
                    ? pct == null
                      ? "bg-sky-100 text-foreground ring-sky-400 dark:bg-sky-900/50"
                      : "bg-negative/15 text-foreground ring-negative/30"
                    : "bg-surface text-foreground ring-line hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
                }`}
              >
                {pct == null ? "Off" : `−${pct}%`}
              </button>
            ))}
          </div>
          ) : null}
          {stressed && chartView === "nw" ? (
            <p className="mt-1 text-center text-xs tabular-nums text-foreground sm:text-sm">
              Lost in {shockYear}:{" "}
              <span className="font-semibold text-negative">
                {shockRow ? `−${formatMoneyWhole(Math.abs(shockRow.growthCents), currency)}` : "—"}
              </span>
              {" · "}Spending covered:{" "}
              <span className={`font-semibold ${untilYear == null ? "" : stressed.runsOutYear ? "text-negative" : "text-positive"}`}>
                {untilYear == null
                  ? "Add birth year"
                  : stressed.runsOutYear
                    ? `Runs out in ${stressed.runsOutYear} · age ${stressed.runsOutYear - (plan.birthYear ?? 0)}`
                    : lastsTo}
              </span>
              {stressEnd != null ? (
                <>
                  {" · "}{plan.spouseBirthYear ? `Left in ${untilYear}` : `Left at age ${plan.longevityAge}`}:{" "}
                  <span className="font-semibold">{formatMoneyWhole(sh(untilYear!, Math.max(0, stressEnd)), currency)}</span>
                  {planEnd != null ? ` (without the drop ${formatMoneyWhole(sh(untilYear!, Math.max(0, planEnd)), currency)})` : ""}
                </>
              ) : null}
            </p>
          ) : null}

          <FiChart
            view={chartView}
            stressEnds={stressed && chartView === "nw" ? new Map(stressed.years.map((y) => [y.year, sh(y.year, y.endCents)])) : null}
            stressPct={dropPct}
            fi={fiShown}
            thisYear={thisYear}
            birthYear={plan.birthYear}
            targetRetireYear={plan.targetRetireYear}
            ssYear={ssLine?.startYear ?? null}
            projection={projectionShown}
            currency={currency}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {children({ assumptions, details, todays, setTodays, editIncome })}
      {editing ? (
        <PlanModal
          plan={plan}
          thisYear={thisYear}
          currency={currency}
          focus={editing === "sbp" ? "sbp" : editing === "income" ? "income" : null}
          suggestPayCents={editing === "income" ? suggestPayCents : null}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

// Compact money for an axis: $1.1M, $850K. Full precision belongs in the
// figures above the chart, not stacked down its side.
function axisMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars)}`;
}

// A round number to hang a gridline on — 1, 2, 2.5 or 5 times a power of ten,
// so the axis reads $500K and $1.0M rather than $437K and $874K.
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const n = rough / pow;
  // Rounds DOWN to the nice value. Rounding up overshoots: aiming for three
  // gridlines on a $1.77M chart asks for $589K, and the next nice number above
  // that is $1M — one lonely line instead of three.
  const mult = n >= 5 ? 5 : n >= 2.5 ? 2.5 : n >= 2 ? 2 : 1;
  return mult * pow;
}

// The climb to the FI line, one bar a year. A plain bar chart because the
// question is "when does this cross the line", and a line crossing a line is
// harder to read than a bar reaching one.
//
// The bars alone only ever said "it goes up". What makes them readable is the
// money scale down the side, the age under each year, a marker on the year the
// colour changes, and — because a chart you can only look at is a chart you
// have to leave to get numbers from — a bar you can press to read that year's
// income, spending, saving and planned close without scrolling to the table.
const PICKED_YEAR_KEY = "fi-chart:picked-year";

// The Retire and Social Security marker lines, faded. Faded through the colour
// rather than `opacity` on the marker: opacity opens a stacking context, which
// trapped each label under the next marker's line where two crossed.
const MARKER_LINE = "color-mix(in srgb, var(--foreground) 70%, transparent)";

function FiChart({
  view,
  stressEnds,
  stressPct,
  fi,
  thisYear,
  birthYear,
  targetRetireYear,
  ssYear,
  projection,
  currency,
}: {
  /** "nw" = net worth bars; "flow" = income and spending side by side. */
  view: "nw" | "flow";
  /** Bad-market test: each year's close after the drop, by year; null = off. */
  stressEnds: Map<number, number> | null;
  stressPct: number | null;
  fi: ReturnType<typeof projectFi>;
  thisYear: number;
  birthYear: number | null;
  targetRetireYear: number | null;
  /** First year of Social Security, when there is a line for it. */
  ssYear: number | null;
  projection: FiProjectionYear[];
  currency: string;
}) {
  const count = fi.years.length;
  const fiIndex = fi.years.findIndex((y) => y.independent);
  // Opens on the current year — that is the row he is living in, so the
  // readout answers "where am I now" before he touches anything. A bar he
  // presses afterwards is remembered for the rest of the session (same rule as
  // the collapse panels: survives navigating around the app, resets on a fresh
  // login back to this year). The YEAR is stored, not the index, so the
  // selection still lands on the right bar after the plan is edited.
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(PICKED_YEAR_KEY);
      // Client-only hydration: the first render uses the server-safe default
      // (this year) so there is no mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setPickedYear(Number(saved));
    } catch {
      // sessionStorage unavailable (private mode) — stays on this year.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (pickedYear == null) window.sessionStorage.removeItem(PICKED_YEAR_KEY);
      else window.sessionStorage.setItem(PICKED_YEAR_KEY, String(pickedYear));
    } catch {
      // sessionStorage unavailable — the selection just won't persist.
    }
  }, [pickedYear, hydrated]);

  if (count === 0) return null;

  // Only the bars are drawn, so only the bars set the scale.
  const flow = view === "flow";
  const planOf = new Map(projection.map((p) => [p.year, p]));
  const max = Math.max(
    1,
    ...fi.years.map((y) => {
      if (!flow) return Math.max(0, y.endCents);
      const p = planOf.get(y.year);
      return p ? Math.max(0, p.incomeCents, p.spendingCents) : 0;
    }),
  );
  // The top of the scale sits above the tallest bar, so the three marker
  // labels (Financially free / Retire / Social Security, stacked 0–56px from
  // the top of a 192px plot) always have clear space. Scaled to the tallest
  // bar alone, the last bars ran up through the labels and the top axis
  // figure poked out of the plot into the cards above it.
  const top = max / 0.68;

  // Two or three gridlines: enough to size a bar by eye, few enough to stay
  // out of the way of the bars themselves.
  const step = niceStep(max / 3);
  const gridlines: number[] = [];
  for (let v = step; v <= max; v += step) gridlines.push(v);

  // Full four-digit years, so the axis reads 2027 rather than '27. They no
  // longer live in a per-bar span — a 4-digit label is wider than a bar once
  // the projection runs past ~20 years, so each one is positioned over its bar
  // and allowed to spill across its neighbours.
  const targetIndex =
    targetRetireYear == null ? -1 : fi.years.findIndex((y) => y.year === targetRetireYear);

  // Decade-friendly rhythm: the two ends are named first, then every year
  // divisible by 5 — an axis that reads 2030 / 2035 / 2040 is the one people
  // actually navigate by. A five-multiple is dropped where it would collide
  // with a label already placed; two four-digit years a bar apart run into
  // each other. Past ~40 bars the fives get too tight, so it steps to tens.
  const minGap = Math.max(4, Math.ceil(count / 8));
  const yearEvery = count > 40 ? 10 : 5;
  const labelled = new Set<number>();
  fi.years.forEach((y, i) => {
    if (y.year % yearEvery === 0) labelled.add(i);
  });
  // The two ends round the axis off, but only where they don't crowd a
  // five — the rhythm is what's being read, not the endpoints.
  for (const end of [0, count - 1]) {
    if ([...labelled].every((placed) => Math.abs(placed - end) >= minGap)) labelled.add(end);
  }

  const centreOf = (i: number) => ((i + 0.5) / count) * 100;
  const fiRow = fiIndex >= 0 ? fi.years[fiIndex] : null;
  const targetRow = targetIndex >= 0 ? fi.years[targetIndex] : null;
  const ssIndex = ssYear == null ? -1 : fi.years.findIndex((y) => y.year === ssYear);

  // The remembered year, else where he stands now. The projection's first bar
  // is next year end — this year has no bar — so "now" means the earliest bar
  // that hasn't already passed, and the last bar only if the whole chart has.
  const pickedIndex = pickedYear == null ? -1 : fi.years.findIndex((y) => y.year === pickedYear);
  const nowIndex = fi.years.findIndex((y) => y.year >= thisYear);
  const selectedIndex =
    pickedIndex >= 0 ? pickedIndex : nowIndex >= 0 ? nowIndex : count - 1;
  const selected = fi.years[selectedIndex] ?? null;
  const selectedPlan = selected
    ? projection.find((p) => p.year === selected.year) ?? null
    : null;

  return (
    <div className="mt-4">
      {/* The plot area is its own box so every percentage below — gridlines,
          bars, markers — is measured against the same width. The axis gutter
          sits outside it, so no bar can end up under a number. */}
      <div className="flex items-stretch gap-1.5">
        <div className="relative w-9 shrink-0">
          {gridlines.map((v) => (
            <span
              key={v}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-foreground"
              style={{ bottom: `${(v / top) * 100}%` }}
            >
              {axisMoney(v)}
            </span>
          ))}
        </div>

        <div className="relative h-48 min-w-0 flex-1">
          {gridlines.map((v) => (
            <span
              key={v}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${(v / top) * 100}%`, borderColor: "var(--viz-grid)" }}
            />
          ))}

          <div className="relative flex h-full items-end gap-[2px]">
            {fi.years.map((y, i) => (
              <button
                key={y.year}
                type="button"
                onClick={() => setPickedYear(y.year)}
                aria-label={`${y.year}: ${formatMoneyWhole(y.endCents, currency)}`}
                aria-pressed={i === selectedIndex}
                className="group relative flex h-full flex-1 cursor-pointer items-end justify-center gap-px rounded-t-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                style={flow && i === selectedIndex ? { backgroundColor: "var(--viz-sel)" } : undefined}
              >
                {flow ? (
                  (() => {
                    const p = planOf.get(y.year);
                    if (!p) return null;
                    return (
                      <>
                        <span
                          className="w-1/2 rounded-t-[1px] transition-opacity group-hover:opacity-80"
                          style={{ height: `${Math.max(0, (p.incomeCents / top) * 100)}%`, backgroundColor: "var(--viz-income)" }}
                        />
                        <span
                          className="w-1/2 rounded-t-[1px] transition-opacity group-hover:opacity-80"
                          style={{ height: `${Math.max(0, (p.spendingCents / top) * 100)}%`, backgroundColor: "var(--viz-spending)" }}
                        />
                      </>
                    );
                  })()
                ) : (
                <>
                {/* Where the year would close after the bad-market drop. */}
                {stressEnds?.has(y.year) ? (
                  <span
                    className="pointer-events-none absolute inset-x-0 z-[1] h-[3px] rounded-full"
                    style={{
                      bottom: `${Math.min(100, Math.max(0, (stressEnds.get(y.year)! / top) * 100))}%`,
                      backgroundColor: "var(--negative)",
                    }}
                  />
                ) : null}
                <span
                  className="w-full rounded-t-[2px] transition-opacity group-hover:opacity-80"
                  style={{
                    // A year that ends below zero gets a short red stub: the
                    // money has run out, and the size of the hole isn't the point.
                    height: y.endCents < 0 ? "4%" : `${Math.max(1, (y.endCents / top) * 100)}%`,
                    backgroundColor:
                      y.endCents < 0 ? "var(--negative)" : y.independent ? "var(--viz-positive-soft)" : "var(--viz-soft)",
                    outline: i === selectedIndex ? "2px solid var(--foreground)" : undefined,
                    outlineOffset: i === selectedIndex ? "1px" : undefined,
                  }}
                />
                </>
                )}
              </button>
            ))}
          </div>

          {/* The year the colour changes, named. Without this the reader has
              to count bars against the axis to work out which year went
              green, which is the one thing this chart exists to say. */}
          {fiRow ? (
            <span
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed"
              style={{ left: `${centreOf(fiIndex)}%`, borderColor: "var(--positive)" }}
            >
              <span
                className={`absolute top-0 z-10 whitespace-nowrap rounded bg-surface px-1 text-[11px] font-semibold text-positive ${
                  fiIndex > count / 2 ? "right-1" : "left-1"
                }`}
              >
                Financially free {fiRow.year}
                {/* The projected portfolio that year, not the FI number —
                    named so it doesn't read as a second goal figure. */}
                {birthYear ? ` · age ${fiRow.year - birthYear}` : ""}
                {/* Dropped on a phone: the longer label ran into the card edge. */}
                <span className="hidden sm:inline"> · net worth {axisMoney(fiRow.endCents)}</span>
              </span>
            </span>
          ) : null}

          {/* Only when a target retirement year is actually set. */}
          {targetRow ? (
            <span
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed"
              style={{ left: `${centreOf(targetIndex)}%`, borderColor: MARKER_LINE }}
            >
              <span
                className={`absolute z-10 top-5 whitespace-nowrap rounded bg-surface px-1 text-foreground text-[11px] font-semibold ${
                  targetIndex > count / 2 ? "right-1" : "left-1"
                }`}
              >
                Retire {targetRow.year}
                {birthYear ? ` · age ${targetRow.year - birthYear}` : ""}
              </span>
            </span>
          ) : null}

          {ssIndex >= 0 ? (
            <span
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dotted"
              style={{ left: `${centreOf(ssIndex)}%`, borderColor: MARKER_LINE }}
            >
              <span
                className={`absolute z-10 top-10 whitespace-nowrap rounded bg-surface px-1 text-foreground text-[11px] font-semibold ${
                  ssIndex > count / 2 ? "right-1" : "left-1"
                }`}
              >
                Social Security {fi.years[ssIndex].year}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Year on top, age under it — the two ways anyone actually asks the
          question ("what year?" / "how old will I be?"). */}
      <div className="flex gap-1.5">
        <span className="w-9 shrink-0" />
        <div className="relative mt-1 h-7 min-w-0 flex-1">
          {fi.years.map((y, i) => {
            if (!labelled.has(i)) return null;
            const first = i === 0;
            const last = i === count - 1;
            return (
              <span
                key={y.year}
                className="absolute top-0 flex flex-col items-center whitespace-nowrap text-[11px] tabular-nums leading-tight text-foreground"
                style={
                  first
                    ? { left: 0 }
                    : last
                      ? { right: 0 }
                      : { left: `${centreOf(i)}%`, transform: "translateX(-50%)" }
                }
              >
                <span>{y.year}</span>
                {birthYear ? (
                  <span className="text-[10px] opacity-80">age {y.year - birthYear}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>

      {/* The selected year, in full. Income, spending and the planned close
          come from the NW Projections grid — the same figures that table
          shows, so this answers the question without the scroll. */}
      {selected ? (
        <div className="mt-2 rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line">
          <p className="text-sm font-bold">
            {selected.year}
            {birthYear ? ` · age ${selected.year - birthYear}` : ""}
            {selected.independent ? " · financially free" : ""}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Readout label="Income" value={selectedPlan ? formatMoneyWhole(selectedPlan.incomeCents, currency) : "—"} />
            <Readout label="Spending" value={selectedPlan ? formatMoneyWhole(selectedPlan.spendingCents, currency) : "—"} />
            <Readout
              label="Saved"
              value={
                selectedPlan
                  ? formatMoneyWhole(selectedPlan.incomeCents - selectedPlan.spendingCents, currency)
                  : "—"
              }
            />
            {/* One net worth per year: the plan's year-end figure. The chart's
                own growth-model balance sat beside it a few hundred dollars
                off and read as a second answer; it only fills in for years
                past the end of the plan. */}
            <Readout
              label="Net worth"
              value={formatMoneyWhole(selectedPlan ? selectedPlan.eoyCents : selected.endCents, currency)}
            />
          </div>
        </div>
      ) : null}

      {/* What the two bar colours mean. The chart has no hover state on
          purpose — the colours have to say it on their own. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:text-[12px] sm:text-sm text-foreground">
        {flow ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2.5 rounded-[1px]" style={{ backgroundColor: "var(--viz-income)" }} />
              Income
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2.5 rounded-[1px]" style={{ backgroundColor: "var(--viz-spending)" }} />
              Spending
            </span>
          </>
        ) : (
        <>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2.5 rounded-[1px]"
            style={{ backgroundColor: "var(--viz-soft)" }}
          />
          Net worth at year end
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2.5 rounded-[1px]"
            style={{ backgroundColor: "var(--viz-positive-soft)" }}
          />
          Financially free
        </span>
        {stressEnds ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-2.5 rounded-full" style={{ backgroundColor: "var(--negative)" }} />
            After a −{stressPct}% drop
          </span>
        ) : null}
        {fi.runsOutYear != null ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2.5 rounded-[1px]" style={{ backgroundColor: "var(--negative)" }} />
            Money ran out
          </span>
        ) : null}
        </>
        )}
      </div>
    </div>
  );
}

/** A % typed in place on a card (the "Needed in" withdrawal rate, the
 *  survivor spending), saved on Enter or when the box loses focus. */
function PctInput({
  pct,
  label,
  save: saveTo,
}: {
  pct: number;
  label: string;
  save: (pct: number) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(pct));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    const next = Number(draft.trim());
    if (draft.trim() === "" || next === pct) {
      setDraft(String(pct));
      setError(null);
      return;
    }
    start(async () => {
      const result = await saveTo(next);
      if (result && "error" in result) {
        setError(result.error ?? "Couldn't save the rate.");
        setDraft(String(pct));
      } else {
        setError(null);
        router.refresh();
      }
    });
  };
  return (
    <>
      <PctBox value={draft} className="inline-block align-middle" textClassName="text-xs font-semibold sm:text-sm">
        <input
          inputMode="decimal"
          aria-label={label}
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          // Clicking in selects the number, so typing replaces it.
          onFocus={(e) => e.currentTarget.select()}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-16 rounded-md bg-surface px-1 py-0.5 text-center text-xs font-semibold tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 sm:text-sm"
        />
      </PctBox>
      {error ? <span className="block text-negative">{error}</span> : null}
    </>
  );
}

/** One label/value line in the Investments panel, styled like IncomeRow. */
function ValueRow({
  label,
  note,
  value,
  tone = "",
  bold = false,
}: {
  label: string;
  note?: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  bold?: boolean;
}) {
  return (
    <li className={`flex items-center justify-between gap-3 py-1 ${bold ? "font-semibold" : ""}`}>
      <span className="min-w-0">
        {label}
        {note ? <span className="block text-xs font-normal text-foreground sm:text-sm">{note}</span> : null}
      </span>
      <span className={`shrink-0 text-right tabular-nums ${tone}`}>{value}</span>
    </li>
  );
}

// Same label/number styling as the milestone and header cards.
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="max-sm:text-[12px] sm:text-sm font-semibold uppercase leading-tight tracking-wide text-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums sm:text-base">{value}</p>
    </div>
  );
}

type LineDraft = {
  key: string;
  id: string | null;
  name: string;
  kind: IncomeLineKind;
  monthly: string;
  startYear: string;
  /** "1"–"12", or "" for January. */
  startMonth: string;
  endYear: string;
  /** "1"–"12", or "" for December. */
  endMonth: string;
  /** Pay only: yearly raise %, "" = none. */
  raisePct: string;
  /** Social Security only: the PIA per month, "" = worked out. */
  pia: string;
  /** What `monthly` is typed per: a month or a year. */
  per: "mo" | "yr";
  taxable: boolean;
};

/** A health or dental & vision plan row as typed. */
type PlanDraft<K extends string> = {
  key: string;
  kind: K;
  amount: string;
  startYear: string;
  startMonth: string;
  endYear: string;
  endMonth: string;
};

const HEALTH_PLAN_KINDS: { value: HealthPlanKind; label: string }[] = [
  { value: "tricare_prime", label: "TRICARE Prime" },
  { value: "tricare_select", label: "TRICARE Select" },
  { value: "fehb", label: "FEHB (federal job)" },
  { value: "employer", label: "Employer plan" },
  { value: "marketplace", label: "Marketplace (ACA)" },
  { value: "chcbp", label: "CHCBP" },
  { value: "private", label: "Private insurance" },
];

/** The one-line note under a health plan row. */
const HEALTH_PLAN_NOTE: Record<HealthPlanKind, string> = {
  tricare_prime: "Retiree TRICARE Prime enrollment fee.",
  tricare_select: "Retiree TRICARE Select enrollment fee.",
  fehb: "Your share of the FEHB premium.",
  employer: "Your share of the employer plan premium.",
  marketplace: "Marketplace premium after any tax credit.",
  chcbp: "Bridge coverage after leaving TRICARE, up to 18 or 36 months.",
  private: "Private plan premium.",
};

const NO_DATES: CostDates = { startYear: null, startMonth: null, endYear: null, endMonth: null };

type RentalDraft = {
  key: string;
  id: string | null;
  name: string;
  /** "" = a planned purchase; else the Property account it is. */
  propertyAccountId: string;
  loanAccountId: string;
  purchaseYear: string;
  value: string;
  downPaymentPct: string;
  closingCostPct: string;
  loanBalance: string;
  loanRatePct: string;
  loanYears: string;
  rent: string;
  costs: string;
  appreciationPct: string;
};

const DEFAULT_LINE_NAME: Record<IncomeLineKind, string> = {
  pay: "Pay",
  va: "VA disability",
  social_security: "Social Security",
  job: "Second job",
  spouse: "Spouse income",
  other: "Other income",
};

function PlanModal({
  plan,
  thisYear,
  currency,
  focus = null,
  suggestPayCents = null,
  onClose,
}: {
  plan: FiPlan;
  thisYear: number;
  currency: string;
  /** "sbp": opened from "Turn on SBP" — scroll to that box and outline it.
   *  "income": opened from a year's Edit income — open at Income. */
  focus?: "sbp" | "income" | null;
  /** With focus "income" and no Pay line yet: start one at this yearly amount. */
  suggestPayCents?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const focusSbp = focus === "sbp";
  useEffect(() => {
    if (focus === "sbp") {
      const box = document.getElementById("fi-sbp");
      box?.scrollIntoView({ block: "center" });
      box?.querySelector("input")?.focus({ preventScroll: true });
    } else if (focus === "income") {
      document.getElementById("fi-income")?.scrollIntoView({ block: "start" });
    }
  }, [focus]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Save keeps the popup open (Victor, 2026-10-16); the button says Saved for a moment instead.
  const [justSaved, setJustSaved] = useState(false);
  // Every section opens collapsed — the header and its footnote only — so
  // the popup isn't a wall of numbers (Victor, 2026-10-16). Collapsed fields
  // stay in the form, hidden, so Save still sends them.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(focus === "sbp" ? ["military"] : focus === "income" ? ["income"] : []),
  );
  const isOpen = (id: string) => openSections.has(id);
  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The retired-pay inputs are live so the estimate under them updates as
  // they're typed.
  const [retireYear, setRetireYear] = useState(plan.targetRetireYear?.toString() ?? "");
  const [serviceStart, setServiceStart] = useState(plan.serviceStartYear?.toString() ?? "");
  const [retireMonth, setRetireMonth] = useState(plan.targetRetireMonth?.toString() ?? "");
  const [serviceMonth, setServiceMonth] = useState(plan.serviceStartMonth?.toString() ?? "");
  const [basePay, setBasePay] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(plan.basePayByYear).map(([y, c]) => [y, c ? centsToDisplay(c) : ""])),
  );
  const [inflation, setInflation] = useState(String(plan.inflationPct));
  const [sbpEnabled, setSbpEnabled] = useState(plan.sbpEnabled);
  const [sbpPct, setSbpPct] = useState(String(plan.sbpPct));
  // SGLI on active duty, VGLI kept after retirement (never more than SGLI).
  const [sgliCents, setSgliCents] = useState(plan.insurance.sgliCents);
  const [sgliPayout, setSgliPayout] = useState<InsurancePayout>(plan.insurance.sgliPayout);
  const [vgliEnabled, setVgliEnabled] = useState(plan.insurance.vgliCents > 0);
  const [vgliCents, setVgliCents] = useState(plan.insurance.vgliCents || plan.insurance.sgliCents);
  const [vgliPayout, setVgliPayout] = useState<InsurancePayout>(plan.insurance.vgliPayout);
  // Children: a row per child, added with a button.
  const [childDrafts, setChildDrafts] = useState<{ key: string; birthYear: string; college: boolean }[]>(() =>
    plan.children.map((c, i) => ({ key: `child-${i}`, birthYear: String(c.birthYear), college: c.college })),
  );
  const updateChild = (key: string, patch: Partial<{ birthYear: string; college: boolean }>) =>
    setChildDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // COLA: which incomes get it, the future rate, and the actual one per
  // payment year.
  // There's always a COLA (Victor, 2026-10-16): retired pay, VA and Social
  // Security all rise with it, with no switch to turn it off.
  const colaMilitary = true;
  const colaVa = true;
  const colaSs = true;
  const [colaPct, setColaPct] = useState(String(plan.cola.pct));
  // A row per year the COLA differs from COLA (%/yr), added with a button.
  const [colaRows, setColaRows] = useState<{ key: string; year: string; pct: string }[]>(() =>
    Object.entries(plan.cola.byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([y, pct]) => ({ key: `cola-${y}`, year: y, pct: String(pct) })),
  );
  // A blank start means the retirement month, so it's filled in with it —
  // the box shows the date the cost really starts.
  // The month boxes show January (starts) and December (ends) as blank.
  const startMonthDraft = (m: number | string | null | undefined) => (m == null || Number(m) === 1 ? "" : String(m));
  const endMonthDraft = (m: number | null) => (m == null || m === 12 ? "" : String(m));
  const datesDraft = (d: CostDates) => ({
    startYear: (d.startYear ?? plan.targetRetireYear)?.toString() ?? "",
    startMonth: startMonthDraft(d.startYear != null ? d.startMonth : plan.targetRetireMonth),
    endYear: d.endYear?.toString() ?? "",
    endMonth: endMonthDraft(d.endMonth),
  });
  // Starts with one TRICARE Select row so the choice is visible; an empty
  // amount saves as $0.
  const [healthPlans, setHealthPlans] = useState<PlanDraft<HealthPlanKind>[]>(() =>
    plan.healthPlans.length > 0
      ? plan.healthPlans.map((p, i) => ({
          key: `saved-${i}`,
          kind: p.kind,
          amount: p.annualCents ? centsToDisplay(p.annualCents) : "",
          ...datesDraft(p),
        }))
      : [{ key: "new-0", kind: "tricare_select", amount: "", ...datesDraft(NO_DATES) }],
  );
  const updateHealthPlan = (key: string, patch: Partial<PlanDraft<HealthPlanKind>>) =>
    setHealthPlans((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Same shape for dental & vision; starts with one FEDVIP dental row.
  const [dentalPlans, setDentalPlans] = useState<PlanDraft<DentalPlanKind>[]>(() =>
    plan.dentalPlans.length > 0
      ? plan.dentalPlans.map((p, i) => ({
          key: `saved-${i}`,
          kind: p.kind,
          amount: p.annualCents ? centsToDisplay(p.annualCents) : "",
          ...datesDraft(p),
        }))
      : [{ key: "new-0", kind: "fedvip_dental", amount: "", ...datesDraft(NO_DATES) }],
  );
  const updateDentalPlan = (key: string, patch: Partial<PlanDraft<DentalPlanKind>>) =>
    setDentalPlans((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // A new row starts in the retirement month as currently typed.
  const newPlanDates = () => ({ ...datesDraft(NO_DATES), startYear: retireYear, startMonth: startMonthDraft(retireMonth) });
  const [birthYear, setBirthYear] = useState(plan.birthYear?.toString() ?? "");
  const [tflInfoOpen, setTflInfoOpen] = useState(false);
  const [colaWhyOpen, setColaWhyOpen] = useState(false);
  // The longer notes behind a section's one-line footnote.
  const [info, setInfo] = useState<"income" | "rentals" | null>(null);
  const infoLink = "whitespace-nowrap font-semibold underline underline-offset-2";

  const toYear = (v: string) => (/^\d{4}$/.test(v.trim()) ? Number(v) : null);
  const retireMonthNum = retireMonth ? Number(retireMonth) : null;
  // The year TRICARE For Life starts — where a health plan's blank end lands.
  // Medicare (and with it TFL) starts at 65, so there's no age to type.
  const tflYear = toYear(birthYear) ? toYear(birthYear)! + TFL_AGE : null;
  // The 36 months before retired pay starts, a row per calendar year.
  const high3Years = toYear(retireYear) ? high3Window(toYear(retireYear)!, retireMonthNum) : [];
  const high3Cents = high3FromBasePay(
    toYear(retireYear),
    retireMonthNum,
    Object.fromEntries(
      Object.entries(basePay).map(([y, v]) => [y, Math.round(Number(v.replace(/[$,]/g, "")) * 100) || 0]),
    ),
  );
  const estimate = estimatePension(
    {
      retireYear: toYear(retireYear),
      retireMonth: retireMonth ? Number(retireMonth) : null,
      serviceStartYear: toYear(serviceStart),
      serviceStartMonth: serviceMonth ? Number(serviceMonth) : null,
      high3MonthlyCents: high3Cents,
      sbpEnabled,
      sbpPct: Number(sbpPct) || 0,
    },
  );

  const [lines, setLines] = useState<LineDraft[]>(() => {
    const saved: LineDraft[] = plan.incomeLines.map((l) => ({
      key: l.id,
      id: l.id,
      // A name still at its type's default shows as the box's hint instead,
      // so typing never runs into it ("Other iMilncome").
      name: l.name === DEFAULT_LINE_NAME[l.kind] ? "" : l.name,
      kind: l.kind,
      // Shown the way it was typed: per year or per month, no ".00" on a
      // whole amount (125000.00 is cut off in the phone's box).
      monthly: centsToDisplay(l.annualCents != null ? l.annualCents : Math.round(l.monthlyCents)).replace(/\.00$/, ""),
      per: l.annualCents != null ? "yr" : "mo",
      startYear: l.startYear?.toString() ?? "",
      startMonth: l.startMonth?.toString() ?? "",
      endYear: l.endYear?.toString() ?? "",
      endMonth: l.endMonth == null || l.endMonth === 12 ? "" : String(l.endMonth),
      raisePct: l.raisePct ? String(l.raisePct) : "",
      pia: l.piaCents ? centsToDisplay(l.piaCents).replace(/\.00$/, "") : "",
      taxable: l.taxable,
    }));
    // Opened from a year's Add income with no Pay yet: start one at this
    // year's pay — per year, the way pay is thought of — ending when you stop
    // working. Not saved until Save.
    if (focus === "income" && !saved.some((l) => l.kind === "pay")) {
      saved.unshift({
        key: "new-pay",
        id: null,
        name: "",
        kind: "pay",
        monthly: suggestPayCents ? centsToDisplay(suggestPayCents) : "",
        per: "yr",
        startYear: "",
        startMonth: "",
        endYear: "",
        endMonth: "",
        raisePct: "",
        pia: "",
        taxable: true,
      });
    }
    return byLineDates(saved, thisYear);
  });
  const [rentalDrafts, setRentalDrafts] = useState<RentalDraft[]>(() =>
    plan.rentalRows.map((r) => ({
      key: r.id,
      id: r.id,
      name: r.name,
      propertyAccountId: r.property_account_id ?? "",
      loanAccountId: r.loan_account_id ?? "",
      purchaseYear: r.purchase_year?.toString() ?? "",
      value: r.value_cents ? centsToDisplay(r.value_cents) : "",
      downPaymentPct: String(Number(r.down_payment_pct)),
      closingCostPct: String(Number(r.closing_cost_pct)),
      loanBalance: r.loan_balance_cents ? centsToDisplay(r.loan_balance_cents) : "",
      loanRatePct: String(Number(r.loan_rate_pct)),
      loanYears: String(r.loan_years),
      rent: r.monthly_rent_cents ? centsToDisplay(r.monthly_rent_cents) : "",
      costs: r.monthly_costs_cents ? centsToDisplay(r.monthly_costs_cents) : "",
      appreciationPct: String(Number(r.appreciation_pct)),
    })),
  );
  const updateRental = (key: string, patch: Partial<RentalDraft>) =>
    setRentalDrafts((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Account groups: each one's return and tax as typed (blank = the
  // default), and which group each account or bucket sits in. Adds and
  // withdrawals are typed per year in the year popup only (Victor,
  // 2026-10-19) — saving here clears any old plan-wide figures.
  const [groupDrafts, setGroupDrafts] = useState<Record<GroupKind, GroupDraft>>(() => {
    const byKind = new Map(plan.accountGroups.rows.filter((r) => isGroupKind(r.kind)).map((r) => [r.kind as GroupKind, r]));
    const text = (v: number | string | null | undefined) => (v == null || v === "" ? "" : String(Number(v)));
    return Object.fromEntries(
      GROUP_KINDS.map((kind) => {
        const r = byKind.get(kind);
        return [
          kind,
          {
            // No overall rate box any more (Victor, 2026-10-19): a blank
            // category starts at the old default so every box shows a rate.
            returnPct: text(r?.return_pct) || (kind === "cash" ? "" : String(plan.investmentReturnPct)),
            taxPct: text(r?.tax_pct),
          },
        ];
      }),
    ) as Record<GroupKind, GroupDraft>;
  });
  const updateGroup = (kind: GroupKind, patch: Partial<GroupDraft>) =>
    setGroupDrafts((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  // The account lists under the Rates section's category boxes. Each
  // category opens on its own by clicking its name, like the year popup's
  // groups — never one switch for all (Victor, 2026-10-17). Folded by default.
  const [rateAccountsOpen, setRateAccountsOpen] = useState<Set<GroupKind>>(() => new Set());
  const toggleRateAccounts = (kind: GroupKind) =>
    setRateAccountsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  // Still saved (a cleared category box falls back to it), but no longer shown.
  const investDefault = String(plan.investmentReturnPct);
  const [cashDefault, setCashDefault] = useState(String(plan.cashReturnPct));
  const addRental = () =>
    setRentalDrafts((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        name: `Rental ${prev.length + 1}`,
        propertyAccountId: "",
        loanAccountId: "",
        purchaseYear: retireYear,
        value: "",
        downPaymentPct: "25",
        closingCostPct: "3",
        loanBalance: "",
        loanRatePct: "7",
        loanYears: "30",
        rent: "",
        costs: "",
        appreciationPct: "0",
      },
    ]);
  const money = (v: string) => Math.round(Number(v.replace(/[$,]/g, "")) * 100) || 0;

  // With a Social Security record, the largest Social Security line is the
  // record's: its PIA and amount are worked out at the start typed, not typed.
  const recordKey = plan.ssRecord
    ? lines
        .filter((l) => l.kind === "social_security")
        .reduce<LineDraft | null>((best, l) => {
          const m = (x: LineDraft) => money(x.monthly) / (x.per === "yr" ? 12 : 1);
          return best == null || m(l) > m(best) ? l : best;
        }, null)?.key ?? null
    : null;
  const fromRecord = (l: LineDraft): { pia: number; monthly: number } | null => {
    const by = Number(birthYear) || plan.birthYear;
    if (!plan.ssRecord || l.key !== recordKey || !by) return null;
    const startYear = Number(l.startYear) || by + 67;
    const pia = recordRetirementPiaCents(plan.ssRecord, by, startYear, thisYear);
    return { pia, monthly: benefitAtStartCents(pia, by, plan.ssRecord.birthMonth ?? 1, startYear, Number(l.startMonth) || 1) };
  };
  // Year-one numbers for a draft, so the card says what it means as it's typed.
  const rentalPreview = (r: RentalDraft) => {
    const owned = !!r.propertyAccountId;
    const acctValue = owned ? plan.propertyAccounts.find((a) => a.id === r.propertyAccountId)?.valueCents : undefined;
    const model: RentalProperty = {
      id: r.key,
      name: r.name,
      owned,
      purchaseYear: toYear(r.purchaseYear),
      valueCents: owned ? acctValue ?? money(r.value) : money(r.value),
      downPaymentPct: Number(r.downPaymentPct) || 0,
      closingCostPct: Number(r.closingCostPct) || 0,
      loanBalanceCents: owned
        ? plan.propertyAccounts.find((a) => a.id === r.propertyAccountId)?.loanCents ?? money(r.loanBalance)
        : money(r.loanBalance),
      loanRatePct: Number(r.loanRatePct) || 0,
      loanYears: Number(r.loanYears) || 0,
      monthlyRentCents: money(r.rent),
      monthlyCostsCents: money(r.costs),
      appreciationPct: Number(r.appreciationPct) || 0,
    };
    const first = owned ? thisYear + 1 : model.purchaseYear;
    if (first == null || (!owned && model.valueCents <= 0)) return null;
    const y = rentalForYear(model, first, thisYear, Number(inflation) || 0);
    if (!y) return null;
    const netRent = 12 * (model.monthlyRentCents - model.monthlyCostsCents) * inflateTo(first, thisYear, Number(inflation) || 0);
    const payMonthly = Math.round((netRent - y.cashFlowCents) / 12);
    return { first, cashMonthly: Math.round(y.cashFlowCents / 12), payMonthly, purchaseCash: y.purchaseCashCents, equity: y.equityEndCents };
  };

  // The first January each income actually rises, from its own start:
  // retired pay after the retirement month, VA and Social Security the
  // January after they start. Only what this plan has, so a household without
  // military service sees no retired-pay switch.
  const colaWhen = { thisYear, birthYear: toYear(birthYear) };
  const colaAll = { pct: 0, byYear: {}, military: true, va: true, socialSecurity: true };
  const firstColaOf = (l: LineDraft) => {
    const base = lineColaBase(
      { id: l.key, name: l.name, kind: l.kind, monthlyCents: 1, startYear: toYear(l.startYear), startMonth: null, endYear: null, taxable: false },
      colaAll,
      colaWhen,
    );
    return base == null ? null : base + 1;
  };
  const earliest = (ys: (number | null)[]) => {
    const real = ys.filter((y): y is number => y != null);
    return real.length > 0 ? Math.min(...real) : null;
  };
  const colaStarts = {
    military: estimate ? firstPensionColaYear(estimate.retireYear, estimate.retireMonth) : null,
    va: earliest(lines.filter((l) => l.kind === "va").map(firstColaOf)),
    socialSecurity: earliest(lines.filter((l) => l.kind === "social_security").map(firstColaOf)),
  };
  const firstCola = earliest([
    colaMilitary ? colaStarts.military : null,
    colaVa ? colaStarts.va : null,
    colaSs ? colaStarts.socialSecurity : null,
  ]);
  // Why each income's first raise lands when it does.
  const ssLineDraft = lines.find((l) => l.kind === "social_security" && toYear(l.startYear) != null);
  const colaNotes = [
    estimate && colaStarts.military != null
      ? (() => {
          const share = firstColaShare(estimate.retireMonth);
          const mon = MONTHS[estimate.retireMonth - 1];
          return share > 0
            ? `Retired pay: ${Math.round(share * 100)}% of the ${estimate.retireYear + 1} COLA (${mon} retirement), full from ${estimate.retireYear + 2}.`
            : `Retired pay: 0% in ${estimate.retireYear + 1} (${mon} retirement), full from ${estimate.retireYear + 2}.`;
        })()
      : null,
  ].filter((n): n is string => n != null);

  // A box per year from the first COLA through next year's, the newest one
  // announced. A later year's COLA isn't known yet, so it uses the future rate.
  // The next year without a row, from the first COLA on.
  const nextColaYear = () => {
    const taken = colaRows.map((r) => Number(r.year)).filter((y) => Number.isFinite(y) && y > 0);
    return taken.length > 0 ? Math.max(...taken) + 1 : (firstCola ?? thisYear + 1);
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const [withdrawStartDraft, setWithdrawStartDraft] = useState(plan.withdrawStartYear?.toString() ?? "");
  const addLine = (kind: IncomeLineKind) =>
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        // Blank: the type's name shows as a hint and is saved if left blank.
        name: "",
        kind,
        monthly: "",
        // Pay runs from now; a blank end never stops.
        ...(kind === "pay"
          ? { startYear: "", startMonth: "", endYear: "", endMonth: "" }
          : // Retired pay's own start month, so VA lines up with it by default.
            { startYear: retireYear, startMonth: retireMonth, endYear: "", endMonth: "" }),
        raisePct: "",
        pia: "",
        // Pay is thought of per year; benefits are paid and quoted per month.
        per: kind === "pay" || kind === "job" || kind === "spouse" ? "yr" : "mo",
        taxable: kind !== "va",
      },
    ]);

  // onSubmit, not <form action>: a rejected save must keep what was typed.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const planJson = <K extends string>(rows: PlanDraft<K>[]) =>
      JSON.stringify(
        rows.map((r) => ({
          kind: r.kind,
          amount: r.amount,
          startYear: r.startYear,
          startMonth: r.startMonth,
          endYear: r.endYear,
          endMonth: r.endMonth,
        })),
      );
    // Only the years shown: a COLA before any income gets one changes nothing.
    formData.set(
      "colaByYear",
      JSON.stringify(colaRows.map((r) => ({ year: r.year.trim(), pct: r.pct.trim() }))),
    );
    formData.set(
      "children",
      JSON.stringify(childDrafts.map((c) => ({ birthYear: c.birthYear.trim(), college: c.college }))),
    );
    formData.set("healthPlans", planJson(healthPlans));
    formData.set("dentalPlans", planJson(dentalPlans));
    formData.set(
      "incomeLines",
      JSON.stringify(
        lines.map((l) => ({
          id: l.id,
          // A cleared name falls back to the type's.
          name: l.name.trim() || DEFAULT_LINE_NAME[l.kind],
          kind: l.kind,
          // A record's line saves the amount worked out from it.
          monthly: fromRecord(l) ? (fromRecord(l)!.monthly / 100).toFixed(2) : l.monthly,
          startYear: l.startYear,
          startMonth: l.startMonth,
          endYear: l.endYear,
          endMonth: l.endMonth,
          raisePct: l.raisePct,
          piaCents: fromRecord(l) ? (fromRecord(l)!.pia / 100).toFixed(2) : l.kind === "social_security" ? l.pia : "",
          per: fromRecord(l) ? "mo" : l.per,
          taxable: l.taxable,
        })),
      ),
    );
    formData.set(
      "rentals",
      JSON.stringify(
        rentalDrafts.map((r) => ({
          id: r.id,
          name: r.name,
          propertyAccountId: r.propertyAccountId || null,
          loanAccountId: r.loanAccountId || null,
          purchaseYear: r.purchaseYear,
          value: r.value,
          downPaymentPct: r.downPaymentPct,
          closingCostPct: r.closingCostPct,
          loanBalance: r.loanBalance,
          loanRatePct: r.loanRatePct,
          loanYears: r.loanYears,
          rent: r.rent,
          costs: r.costs,
          appreciationPct: r.appreciationPct,
        })),
      ),
    );
    formData.set(
      "accountGroups",
      JSON.stringify(GROUP_KINDS.map((kind) => ({ kind, ...groupDrafts[kind] }))),
    );
    start(async () => {
      const result = await saveRetirementPlan(formData);
      if (result?.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 2000);
      }
    });
  }


  // Light red, so Close reads apart from Save.
  const closeButtonClass =
    "shrink-0 rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative ring-1 ring-negative/30 transition hover:bg-negative/20";

  return (
    <ModalShell
      title={
        // Capped on a phone so the title, Save and Close share one line. The
        // modal's <h2> truncates (overflow hidden), so the padding keeps Close's
        // 1px ring inside it instead of clipped at the edges.
        <span className="flex min-w-0 max-w-[calc(100vw-2.5rem)] items-center gap-2 py-0.5 pr-0.5 text-base sm:max-w-none sm:gap-3 sm:text-lg">
          <span className="min-w-0 whitespace-normal leading-tight sm:truncate">Edit Future Projections</span>
          {/* Outside the <form>, so it points at it by id. */}
          <button
            type="submit"
            form="fi-plan-form"
            disabled={pending}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : justSaved ? "Saved" : "Save"}
          </button>
          {/* A worded Close in place of the X, beside Save rather than at the
              far edge (Victor, 2026-10-15). */}
          <button type="button" onClick={onClose} className={closeButtonClass}>
            Close
          </button>
        </span>
      }
      onClose={onClose}
      // Empty: Close sits in the title row above, so no X at the edge.
      headerEnd={<></>}
      // Wide enough on desktop for the seven rates, and the Social Security
      // record's Total · Add SSA Year · Add Spousal Benefit · Explanation
      // row, to each fit one line — and no wider: the old 1152px was dead
      // space beside the collapsed sections (Victor, 2026-10-22).
      className="sm:max-w-[54rem]"
    >
      <form
        id="fi-plan-form"
        onSubmit={submit}
        className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        {/* Also up here, so a rejected save from the top Save is seen. */}
        {error ? <p className="sm:col-span-full text-sm font-medium text-negative">{error}</p> : null}
        <SectionHead title="General Profile Data" open={isOpen("info")} onToggle={() => toggleSection("info")} />
        {/* You and your spouse side by side on one row on a wide screen,
            each under their own heading so the labels can stay short
            (Victor, 2026-10-20). A blank spouse birth year hides Spouse Age. */}
        <div className={isOpen("info") ? "grid grid-cols-1 gap-y-4 sm:col-span-2" : "hidden"}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="rounded-lg px-3 pb-3 pt-2 ring-1 ring-line">
        <p className="-mx-3 -mt-2 mb-2 rounded-t-lg border-b border-line bg-sky-50 px-3 py-1.5 text-center text-sm font-bold sm:text-base dark:bg-sky-950/40">You</p>
        <div className="grid grid-cols-1 items-end gap-x-2 gap-y-4 sm:grid-cols-3">
        <Field center label={<>Birth <br className="max-sm:hidden" /> year</>}>
          <input name="birthYear" inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} className={`${inputClass} sm:!w-20`} />
        </Field>
        {/* The year all work stops — military, GS or civilian. Up here, not
            under the rates or the military section: it is the plan's own
            retirement, and a military retirement can be followed by a second
            career (Victor, 2026-10-17). */}
        <Field center label={<>Retirement <br className="max-sm:hidden" /> Year</>}>
          <input
            name="withdrawStartYear"
            inputMode="numeric"
            value={withdrawStartDraft}
            onChange={(e) => setWithdrawStartDraft(e.target.value)}
            className={`${inputClass} sm:!w-20`}
          />
        </Field>
        <Field center label={<>Plan <br className="max-sm:hidden" /> until age</>}>
          <input name="longevityAge" inputMode="numeric" defaultValue={plan.longevityAge} className={`${inputClass} sm:!w-20`} />
        </Field>
        </div>
        </div>
        <div className="rounded-lg px-3 pb-3 pt-2 ring-1 ring-line">
        <p className="-mx-3 -mt-2 mb-2 rounded-t-lg border-b border-line bg-sky-50 px-3 py-1.5 text-center text-sm font-bold sm:text-base dark:bg-sky-950/40">Spouse</p>
        <div className="grid grid-cols-1 items-end gap-x-2 gap-y-4 sm:grid-cols-3">
        <Field center label={<>Birth <br className="max-sm:hidden" /> year</>}>
          <input name="spouseBirthYear" inputMode="numeric" defaultValue={plan.spouseBirthYear ?? ""} className={`${inputClass} sm:!w-20`} />
        </Field>
        <Field center label={<>Retirement <br className="max-sm:hidden" /> Year</>}>
          <input
            name="spouseRetireYear"
            inputMode="numeric"
            defaultValue={plan.spouseRetireYear ?? ""}
            className={`${inputClass} sm:!w-20`}
          />
        </Field>
        <Field center label={<>Plan <br className="max-sm:hidden" /> until age</>}>
          <input name="spouseLongevityAge" inputMode="numeric" defaultValue={plan.spouseLongevityAge} className={`${inputClass} sm:!w-20`} />
        </Field>
        </div>
        </div>
        </div>
        {/* Children: their ages set the survivor benefits — DIC per child,
            SBP and TRICARE age limits (Victor, 2026-10-20). */}
        <div className="rounded-lg px-3 pb-3 pt-2 ring-1 ring-line">
          <p className="-mx-3 -mt-2 mb-2 rounded-t-lg border-b border-line bg-sky-50 px-3 py-1.5 text-center text-sm font-bold sm:text-base dark:bg-sky-950/40">Children</p>
          {/* Every child on one line with + Add child, wrapping when it runs
              out of room (Victor, 2026-10-20). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {childDrafts.map((c, i) => (
            <div key={c.key} className="inline-flex items-center gap-1.5">
              <span className="whitespace-nowrap text-sm font-semibold text-foreground">Child #{i + 1}</span>
              <input
                inputMode="numeric"
                value={c.birthYear}
                onChange={(e) => updateChild(c.key, { birthYear: e.target.value })}
                placeholder="Year"
                aria-label={`Child ${i + 1} birth year`}
                className={`${inputClass} !w-20`}
              />
              <button
                type="button"
                onClick={() => setChildDrafts((rows) => rows.filter((r) => r.key !== c.key))}
                aria-label={`Remove child ${i + 1}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-lg font-bold leading-none text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                ×
              </button>
            </div>
          ))}
            <button
              type="button"
              onClick={() => setChildDrafts((rows) => [...rows, { key: `child-new-${Date.now()}`, birthYear: "", college: false }])}
              className="shrink-0 rounded-md bg-surface px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 sm:text-sm dark:hover:bg-sky-900/50"
            >
              + Add child
            </button>
          </div>
        </div>
        </div>

        <SectionHead
          id="fi-income"
          title="Income"
          open={isOpen("income")}
          onToggle={() => toggleSection("income")}
          note={
            <>
              Before tax, at today&rsquo;s rates.{" "}
              <button type="button" onClick={() => setInfo("income")} className={infoLink} style={{ color: "var(--viz-savings)" }}>
                How it works
              </button>
            </>
          }
        />
        <div className={isOpen("income") ? "contents" : "hidden"}>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l) => (
            <div
              key={l.key}
              // Re-sorted once you leave the row, not while typing a year.
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setLines((prev) => byLineDates(prev, thisYear));
              }}
              className="space-y-2 rounded-lg bg-background p-2 ring-1 ring-line">
              {/* Name and type head the card with Remove at the far end; the
                  fields below are sized to their values, not stretched to
                  fill columns (Victor, 2026-10-22). */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* Your own name ("Mil Pay"); the type decides how it is
                    treated — COLA, survivor, when Pay stops (Victor, 2026-10-16).
                    Blank shows the type's name as a hint and saves it. */}
                <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
                  <span className="shrink-0 max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Name</span>
                  <input
                    value={l.name}
                    onChange={(e) => updateLine(l.key, { name: e.target.value })}
                    placeholder={DEFAULT_LINE_NAME[l.kind]}
                    className={`${lineInput} sm:w-56`}
                  />
                </label>
                <label className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Type</span>
                  <select
                    value={l.kind}
                    onChange={(e) => {
                      const kind = e.target.value as IncomeLineKind;
                      updateLine(l.key, { kind, taxable: kind !== "va" });
                    }}
                    // Wide enough for "Spouse income", the longest type, with
                    // room to spare.
                    className={`${lineInput} sm:w-44`}
                  >
                    {INCOME_LINE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  className="ml-auto h-[34px] shrink-0 rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:justify-between sm:gap-4">
              {/* Typed per month or per year — pay is thought of yearly,
                  benefits monthly (Victor, 2026-10-16). */}
              <LineField label="Amount">
                <span className="flex gap-1">
                  <input
                    inputMode="decimal"
                    value={fromRecord(l) ? (fromRecord(l)!.monthly / 100).toFixed(2) : l.monthly}
                    onChange={(e) => updateLine(l.key, { monthly: e.target.value })}
                    readOnly={!!fromRecord(l)}
                    placeholder="0.00"
                    className={`${lineInput} text-center sm:w-24`}
                  />
                  <select
                    value={fromRecord(l) ? "mo" : l.per}
                    disabled={!!fromRecord(l)}
                    onChange={(e) => updateLine(l.key, { per: e.target.value as "mo" | "yr" })}
                    aria-label="Per month or per year"
                    className="w-[4.25rem] shrink-0 cursor-pointer rounded-md bg-surface px-1.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="mo">/mo</option>
                    <option value="yr">/yr</option>
                  </select>
                </span>
              </LineField>
              {/* Pay-like income rises by its own raise each January; VA and
                  Social Security rise by the COLA instead. */}
              {RAISE_KINDS.includes(l.kind) ? (
                <LineField label="Pay Increase %/yr">
                  <input
                    inputMode="decimal"
                    value={l.raisePct}
                    onChange={(e) => updateLine(l.key, { raisePct: e.target.value })}
                    placeholder="0"
                    className={`${lineInput} block text-center sm:mx-auto sm:w-20`}
                  />
                </LineField>
              ) : (
                <LineField label="Pay Increase %/yr">
                  <span className="block py-1.5 text-center text-sm text-foreground">COLA</span>
                </LineField>
              )}
              {/* Month + year: the first year only counts from this month on. */}
              <LineField label="Starts" className="sm:w-[8.75rem]">
                <MonthYearBox
                  label="Start"
                  blankMonth="Jan"
                  month={l.startMonth}
                  onMonth={(v) => updateLine(l.key, { startMonth: v })}
                  year={l.startYear}
                  onYear={(v) => updateLine(l.key, { startYear: v })}
                  yearPlaceholder="Now"
                />
              </LineField>
              {/* Month + year: the last year only counts through this month. */}
              <LineField label="Ends" className="sm:w-[8.75rem]">
                <MonthYearBox
                  label="End"
                  blankMonth="Dec"
                  month={l.endMonth}
                  onMonth={(v) => updateLine(l.key, { endMonth: v })}
                  year={l.endYear}
                  onYear={(v) => updateLine(l.key, { endYear: v })}
                  yearPlaceholder="Never"
                />
              </LineField>
              </div>
              {/* The PIA drives the survivor benefits on this record: the
                  children's, the caregiver's and the widow(er)'s. Blank
                  shows the one worked out from the start age. */}
              {fromRecord(l) ? (
                <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  <span className="max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Full retirement benefit (PIA)</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--viz-income)" }}>
                    {formatMoneyWhole(fromRecord(l)!.pia, currency)}/mo
                  </span>
                  <span className="text-xs text-foreground sm:text-sm">From your Social Security record.</span>
                </p>
              ) : l.kind === "social_security" ? (
                <label className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  <span className="max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Full retirement benefit (PIA)</span>
                  <span className="flex items-center gap-1">
                    <input
                      inputMode="decimal"
                      value={l.pia}
                      onChange={(e) => updateLine(l.key, { pia: e.target.value })}
                      placeholder={(() => {
                        const monthly = l.per === "yr" ? money(l.monthly) / 12 : money(l.monthly);
                        const start = Number(l.startYear) || null;
                        const pia = ssPiaCents(
                          { id: l.key, name: l.name, kind: l.kind, monthlyCents: monthly, startYear: start, startMonth: null, endYear: null, taxable: l.taxable },
                          Number(birthYear) || null,
                        );
                        return pia > 0 ? String(Math.round(pia / 100)) : "0.00";
                      })()}
                      aria-label="Full retirement benefit (PIA) per month"
                      className={`${lineInput} max-w-28 text-center`}
                    />
                    <span className="text-sm text-foreground">/mo</span>
                  </span>
                  <span className="text-xs text-foreground sm:text-sm">Blank: worked out from the start age.</span>
                </label>
              ) : null}
              {/* A year's worth. */}
              {money(l.monthly) > 0 ? (
                <p className="text-center text-xs sm:text-sm text-foreground">
                  {/* The same amount the other way round. */}
                  {l.per === "yr"
                    ? `Estimated Monthly Income: ${formatMoneyWhole(money(l.monthly) / 12, currency)}`
                    : `Estimated Yearly Income: ${formatMoneyWhole(money(l.monthly) * 12, currency)}`}
                </p>
              ) : null}
            </div>
          ))}
          {/* Picking a type adds a line of that type, then resets. */}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addLine(e.target.value as IncomeLineKind);
            }}
            aria-label="Add income"
            className="cursor-pointer rounded-md bg-surface px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 focus:outline-none focus:ring-2 focus:ring-brand dark:hover:bg-sky-950/40"
          >
            <option value="">+ Add income</option>
            {INCOME_LINE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        </div>

        {/* Social Security worked out from the SSA earnings record instead
            of one typed amount (Victor, 2026-10-22). */}
        <SectionHead
          id="fi-ss"
          title="Social Security record"
          note="Your SSA earnings, year by year."
          open={isOpen("ss")}
          onToggle={() => toggleSection("ss")}
        />
        <div className={isOpen("ss") ? "contents" : "hidden"}>
          <SsRecordSection
            record={plan.ssRecord}
            birthYear={Number(birthYear) || plan.birthYear}
            spouseBirthYear={plan.spouseBirthYear}
            spouseClaimAge={plan.spouseSsClaimAge}
            thisYear={thisYear}
            currency={currency}
          />
        </div>

        <SectionHead title="Return, Withdrawal, & Inflation Rates" open={isOpen("rates")} onToggle={() => toggleSection("rates")} />
        <div className={isOpen("rates") ? "contents" : "hidden"}>
        <input type="hidden" name="investmentReturnPct" value={investDefault} />
        {/* Each category's own rate, side by side, Savings APY first;
            the year popup can still change one year. */}
        <div className="sm:col-span-2">
          {/* Spending inflation sits left of Savings APY on a wide screen
              (Victor, 2026-10-19); on a phone it drops below the rates so
              it isn't read as one of them. */}
          {/* Columns sized to each name ("Traditional retirement" needs more
              than "Crypto"), so all seven fit the narrower popup. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 lg:grid-cols-[repeat(7,auto)]">
            <span className="col-span-full block text-center max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground lg:col-span-6 lg:col-start-2">
              Rate of return by category
            </span>
            <label className="order-last min-w-0 self-start lg:order-none lg:col-start-1 lg:row-start-2 lg:border-r-2 lg:border-sky-300 lg:pr-2 dark:lg:border-sky-900">
              <span className="mb-0.5 block text-center max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">
                Spending<br />inflation
              </span>
              <PctBox value={inflation}>
                <input
                  name="inflationPct"
                  inputMode="decimal"
                  // Takes its column's width rather than setting it.
                  size={1}
                  value={inflation}
                  onChange={(e) => setInflation(e.target.value)}
                  className={`${lineInput} text-center`}
                />
              </PctBox>
            </label>
            {(["cash", ...GROUP_KINDS.filter((k) => k !== "cash")] as GroupKind[]).map((kind) => {
              // "Traditional / retirement", "Roth / retirement" on two lines.
              const [first, ...rest] = (kind === "cash" ? "Savings APY" : GROUP_LABEL[kind]).split(" ");
              const names = groupAccountNames(plan.accountGroups.slots, (x) => x.group === kind);
              return (
                <div key={kind} className="min-w-0 self-start lg:row-start-2">
                  {/* The name opens this category's accounts. */}
                  <button
                    type="button"
                    onClick={() => toggleRateAccounts(kind)}
                    aria-expanded={rateAccountsOpen.has(kind)}
                    className="mb-0.5 flex w-full items-end justify-center gap-1 rounded-md text-center max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className={`mb-1 h-3 w-3 shrink-0 transition-transform ${rateAccountsOpen.has(kind) ? "" : "-rotate-90"}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 7.5 10 12.5 15 7.5" />
                    </svg>
                    <span>{rest.length > 0 ? <>{first}<br />{rest.join(" ")}</> : <><br />{first}</>}</span>
                  </button>
                  <PctBox value={kind === "cash" ? cashDefault : groupDrafts[kind].returnPct} placeholder={kind === "cash" ? "" : investDefault}>
                  {kind === "cash" ? (
                    <input
                      name="cashReturnPct"
                      inputMode="decimal"
                      size={1}
                      value={cashDefault}
                      onChange={(e) => setCashDefault(e.target.value)}
                      aria-label="Savings APY"
                      className={`${lineInput} text-center`}
                    />
                  ) : (
                    <input
                      inputMode="decimal"
                      size={1}
                      value={groupDrafts[kind].returnPct}
                      onChange={(e) => updateGroup(kind, { returnPct: e.target.value })}
                      placeholder={investDefault}
                      aria-label={`${GROUP_LABEL[kind]} rate of return`}
                      className={`${lineInput} text-center`}
                    />
                  )}
                  </PctBox>
                  {/* Which accounts earn this rate — the Accounts page sets
                      each account's type (Victor, 2026-10-19). */}
                  {rateAccountsOpen.has(kind) ? (
                    <p className="mt-1 text-left text-xs leading-snug text-foreground sm:text-sm">
                      {names.length > 0 ? names.join(" · ") : "No accounts"}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        </div>

        <SectionHead title="Military retirement" note="Optional. Leave blank if none." open={isOpen("military")} onToggle={() => toggleSection("military")} />
        <div className={isOpen("military") ? "contents" : "hidden"}>
        <Field label="Month & Year expected to retire" hint="Active-duty pay stops and retired pay starts that month.">
          <MonthYear
            monthName="targetRetireMonth"
            month={retireMonth}
            onMonth={setRetireMonth}
            yearName="targetRetireYear"
            year={retireYear}
            onYear={setRetireYear}
            label="Retirement"
          />
        </Field>
        <Field
          label="Month & Year service started"
          hint={
            estimate
              ? `${estimate.yearsOfService} years${estimate.extraMonths ? ` ${estimate.extraMonths} month${estimate.extraMonths === 1 ? "" : "s"}` : ""} of service × 2.5% = ${estimate.multiplierPct}% of High-3.`
              : "Years of service × 2.5% sets your retired pay %."
          }
        >
          <MonthYear
            monthName="serviceStartMonth"
            month={serviceMonth}
            onMonth={setServiceMonth}
            yearName="serviceStartYear"
            year={serviceStart}
            onYear={setServiceStart}
            label="Service start"
          />
        </Field>
        {/* DFAS High-3: each year's monthly base pay counts for its months
            in the 36 before retired pay starts (raises land Jan 1). */}
        {high3Years.map((w) => (
          <Field
            key={w.year}
            label={`${w.year} base pay (/mo)`}
            hint={`× ${w.months} month${w.months === 1 ? "" : "s"} (${
              w.months === 12 ? "all year" : w.months === 1 ? MONTHS[w.firstMonth - 1] : `${MONTHS[w.firstMonth - 1]}–${MONTHS[w.lastMonth - 1]}`
            }).`}
          >
            <input
              name={`basePay_${w.year}`}
              inputMode="decimal"
              value={basePay[String(w.year)] ?? ""}
              onChange={(e) => setBasePay((prev) => ({ ...prev, [w.year]: e.target.value }))}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
        ))}
        <Field
          id="fi-sbp"
          // VGLI sits to its right (Victor, 2026-10-20).
          highlight={focusSbp}
          label="SBP (Survivor Benefit Plan)"
          hint={
            <>
              Select and the rate comes off gross retired pay, before tax.
              <a
                href="https://www.dfas.mil/RetiredMilitary/provide/sbp/"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-fit whitespace-nowrap font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                Read about SBP (DFAS)
              </a>
            </>
          }
        >
          <span className="flex w-28 items-center gap-2">
            <input
              type="checkbox"
              name="sbpEnabled"
              checked={sbpEnabled}
              onChange={(e) => setSbpEnabled(e.target.checked)}
              className="size-4 cursor-pointer accent-[color:var(--brand)]"
              aria-label="Elect SBP"
            />
            <span className={`relative min-w-0 flex-1 ${sbpEnabled ? "" : "opacity-50"}`}>
              <input
                name="sbpPct"
                inputMode="decimal"
                value={sbpPct}
                onChange={(e) => setSbpPct(e.target.value)}
                disabled={!sbpEnabled}
                aria-label="SBP rate %"
                className="w-full min-w-0 rounded-md bg-surface py-1.5 pl-2 pr-6 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-foreground">%</span>
            </span>
          </span>
        </Field>
        {/* VGLI: SGLI ends 120 days after retirement; converting keeps up
            to the SGLI amount. Paid on a death after retirement. */}
        {/* Not a Field: a checkbox and two dropdowns are too wide to sit
            beside a note on a phone, so the note goes under them. */}
        <div>
          <span className="mb-1 block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">
            VGLI (Veterans&rsquo; Group Life Insurance)
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              name="vgliEnabled"
              checked={vgliEnabled && sgliCents > 0}
              disabled={sgliCents === 0}
              onChange={(e) => setVgliEnabled(e.target.checked)}
              className="size-4 cursor-pointer accent-[color:var(--brand)]"
              aria-label="Keep VGLI"
            />
            <span className={`flex flex-wrap items-center gap-2 ${vgliEnabled && sgliCents > 0 ? "" : "opacity-50"}`}>
              <select
                name="vgliCents"
                value={Math.min(vgliCents, sgliCents)}
                onChange={(e) => setVgliCents(Number(e.target.value))}
                aria-label="VGLI coverage"
                className="rounded-md bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {SGLI_STEPS_CENTS.filter((c) => c > 0 && c <= Math.max(sgliCents, 5_000_000)).map((c) => (
                  <option key={c} value={c}>{formatMoneyWhole(c, currency)}</option>
                ))}
              </select>
              <PayoutSelect name="vgliPayout" value={vgliPayout} onChange={setVgliPayout} label="VGLI payout" />
            </span>
          </span>
          <span className="mt-1 block text-xs leading-snug text-foreground sm:text-sm">
              {sgliCents === 0
                ? "Needs SGLI to convert."
                : (() => {
                    const age = toYear(retireYear) && toYear(birthYear) ? toYear(retireYear)! - toYear(birthYear)! : null;
                    return age != null
                      ? `At ${age}: ${formatMoneyWhole(vgliMonthlyPremiumCents(age, Math.min(vgliCents, sgliCents)), currency)}/mo, rising with age.`
                      : "Premium rises with age.";
                  })()}
              <a
                href="https://www.va.gov/life-insurance/options-eligibility/vgli/"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-fit whitespace-nowrap font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                Read about VGLI (VA)
              </a>
          </span>
        </div>
        {estimate ? (
          <p className="rounded-md bg-background px-3 py-2 text-sm ring-1 ring-line sm:col-span-2">
            <span className="block">
              <span className="font-semibold">High-3: {formatMoney(high3Cents ?? 0, currency)}/mo</span>, the average of
              those 36 months.
            </span>
            <span className="font-semibold">Retired pay: {formatMoneyWhole(estimate.grossAtRetireCents, currency)}/mo</span>{" "}
            in {toYear(retireYear)}
            {estimate.sbpAtRetireCents > 0 ? `, minus ${formatMoneyWhole(estimate.sbpAtRetireCents, currency)} SBP` : ""}, before tax.
            {/* The same pay a year at a time — twelve of each monthly figure. */}
            <span className="block">
              <span className="font-semibold">Yearly: {formatMoneyWhole(estimate.grossAtRetireCents * 12, currency)}</span>
              {estimate.sbpAtRetireCents > 0 ? `, minus ${formatMoneyWhole(estimate.sbpAtRetireCents * 12, currency)} SBP` : ""}, before tax.
              {" "}
              {colaMilitary ? "Rises with the COLA each year after." : "The same every year after."}
            </span>
          </p>
        ) : null}
        </div>

        {/* What the family gets on a death on active duty (Victor,
            2026-10-20): SGLI is the member's choice; the rest is automatic. */}
        <SectionHead
          title="Military survivor benefits"
          note="Paid if you die on active duty."
          open={isOpen("survivor")}
          onToggle={() => toggleSection("survivor")}
        />
        <div className={isOpen("survivor") ? "contents" : "hidden"}>
        <Field
          label="SGLI coverage"
          hint={
            <>
              {sgliCents > 0 ? null : "Declined: no SGLI payout."}
              <a
                href="https://www.va.gov/life-insurance/options-eligibility/sgli/"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-fit whitespace-nowrap font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                Read about SGLI (VA)
              </a>
            </>
          }
        >
          <select
            name="sgliCents"
            value={sgliCents}
            onChange={(e) => setSgliCents(Number(e.target.value))}
            aria-label="SGLI coverage"
            className="rounded-md bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {SGLI_STEPS_CENTS.map((c) => (
              <option key={c} value={c}>{c === 0 ? "Declined" : formatMoneyWhole(c, currency)}</option>
            ))}
          </select>
        </Field>
        <Field label="SGLI payout" hint="You can lock in 36 payments; otherwise your family picks.">
          <PayoutSelect name="sgliPayout" value={sgliPayout} onChange={setSgliPayout} label="SGLI payout" />
        </Field>
        {/* College only changes these benefits, so it is set here, not
            beside each child's birth year (Victor, 2026-10-20). Click a
            child to turn it on. */}
        {childDrafts.length > 0 ? (
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">In college after high school</span>
            <div className="flex flex-wrap gap-2">
              {childDrafts.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={c.college}
                  onClick={() => updateChild(c.key, { college: !c.college })}
                  className={`rounded-md px-2.5 py-1 text-sm font-semibold text-foreground ring-1 transition ${
                    c.college
                      ? "bg-sky-100 ring-sky-400 dark:bg-sky-900/50"
                      : "bg-surface ring-line hover:bg-sky-50 dark:hover:bg-sky-950/40"
                  }`}
                >
                  {c.college ? "✓ " : ""}Child #{i + 1}{c.birthYear.trim() ? ` (${c.birthYear.trim()})` : ""}
                </button>
              ))}
            </div>
            <span className="block text-xs text-foreground sm:text-sm">Keeps SBP to 22, DIC and TRICARE to 23.</span>
          </div>
        ) : null}
        <p className="rounded-md bg-background px-3 py-2 text-sm ring-1 ring-line sm:col-span-2">
          <span className="block">
            <span className="font-semibold">Death gratuity:</span> $100,000 lump sum, tax-free.
          </span>
          <span className="block">
            <span className="font-semibold">SBP:</span> 55% of 75% of High-3, automatic, no cost
            {high3Cents ? ` (${formatMoneyWhole(Math.round(high3Cents * 0.75 * 0.55), currency)}/mo)` : ""}.
          </span>
          <span className="block">
            <span className="font-semibold">DIC (VA):</span> $1,699/mo, +$421 per child under 18, +$359 the first 2 years.
          </span>
        </p>
        </div>

        {colaStarts.military != null || colaStarts.va != null || colaStarts.socialSecurity != null ? (
          <>
            <SectionHead
              title="COLA (yearly raise)"
              open={isOpen("cola")}
              onToggle={() => toggleSection("cola")}
              note={<>Raises retired pay, VA and Social Security every January.</>}
            />
            <div className={isOpen("cola") ? "contents" : "hidden"}>
            {/* Two columns on desktop: which incomes rise and any year the COLA
                differs on the left; the yearly rate on the right. */}
            <div className="space-y-2">
            <span className="block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Rises with COLA</span>
            {firstCola != null ? (
              <div className="space-y-0.5 text-xs sm:text-sm text-foreground">
                {colaNotes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
                <button
                  type="button"
                  onClick={() => setColaWhyOpen(true)}
                  className={infoLink}
                  style={{ color: "var(--viz-savings)" }}
                >
                  Why these years?
                </button>
              </div>
            ) : null}
            <div className="pt-2">
            <span className="mb-1 block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">COLA changes by year (all incomes)</span>
            {firstCola == null ? (
              <p className="text-xs sm:text-sm text-foreground">No income set to rise.</p>
            ) : (
              <div className="space-y-2">
                {colaRows.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <span className="block w-20">
                      <input
                        inputMode="numeric"
                        value={r.year}
                        onChange={(e) => setColaRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, year: e.target.value } : x)))}
                        aria-label="COLA year"
                        className={`${lineInput} text-center tabular-nums`}
                      />
                    </span>
                    <span className="relative block w-24">
                      <input
                        inputMode="decimal"
                        value={r.pct}
                        onChange={(e) => setColaRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, pct: e.target.value } : x)))}
                        placeholder={colaPct}
                        aria-label={`COLA ${r.year} %`}
                        className={`${lineInput} pr-6 text-center tabular-nums`}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-foreground">%</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setColaRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      const y = nextColaYear();
                      setColaRows((prev) => [...prev, { key: `cola-new-${Date.now()}`, year: String(y), pct: "" }]);
                    }}
                    className="shrink-0 rounded-md bg-surface px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 sm:text-sm dark:hover:bg-sky-900/50"
                  >
                    + Change a year
                  </button>
                  <span className="min-w-0 text-xs sm:flex-1 sm:text-sm text-foreground">Replaces Every year COLA (%/yr) for that year.</span>
                </div>
              </div>
            )}
            </div>
            </div>
            <div>
            <Field label="Every year COLA (%/yr)" hint={`Last 20 years averaged ${colaAverage(20)}%; last 10, ${colaAverage(10)}%.`}>
              <input name="colaPct" inputMode="decimal" value={colaPct} onChange={(e) => setColaPct(e.target.value)} className={`${inputClass} text-center`} />
            </Field>
            </div>
            </div>

          </>
        ) : null}
        {/* Always on: every income that can rise with the COLA does. */}
        <input type="hidden" name="colaMilitary" value="on" />
        <input type="hidden" name="colaVa" value="on" />
        <input type="hidden" name="colaSocialSecurity" value="on" />
        {colaStarts.military == null && colaStarts.va == null && colaStarts.socialSecurity == null ? (
          <input type="hidden" name="colaPct" value={colaPct} />
        ) : null}

        <SectionHead title="Healthcare / Insurance Plan" open={isOpen("health")} onToggle={() => toggleSection("health")} />
        <div className={isOpen("health") ? "contents" : "hidden"}>
        {/* One row per plan; two can run side by side (a TRICARE plan plus a
            private supplement). All of them stop when TFL starts. */}
        <div className="space-y-2 sm:col-span-2">
          {healthPlans.length === 0 ? (
            <p className="text-xs sm:text-sm text-foreground">No health plan premium before Medicare.</p>
          ) : null}
          {healthPlans.map((row) => (
            <PlanRow
              key={row.key}
              row={row}
              kinds={HEALTH_PLAN_KINDS}
              ariaLabel="Health plan"
              onChange={(patch) => updateHealthPlan(row.key, patch)}
              onRemove={() => setHealthPlans((rows) => rows.filter((r) => r.key !== row.key))}
              endPlaceholder="TFL"
              note={`${HEALTH_PLAN_NOTE[row.kind]} Blank end = until Medicare at 65${tflYear ? ` (${tflYear})` : ""}.`}
            />
          ))}
          <button
            type="button"
            onClick={() =>
              setHealthPlans((rows) => [...rows, { key: `new-${Date.now()}`, kind: "private", amount: "", ...newPlanDates() }])
            }
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-900/30"
          >
            + Add health plan
          </button>
        </div>
        {/* Dental & vision: a list like the health plans, each row FEDVIP or
            private. TFL covers neither, so these run for life by default. */}
        <div className="space-y-2 sm:col-span-2">
          <span className="block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Dental &amp; vision (/yr)</span>
          {dentalPlans.length === 0 ? <p className="text-xs sm:text-sm text-foreground">No dental or vision premium.</p> : null}
          {dentalPlans.map((row) => (
            <PlanRow
              key={row.key}
              row={row}
              kinds={DENTAL_PLAN_KINDS}
              ariaLabel="Dental or vision plan"
              onChange={(patch) => updateDentalPlan(row.key, patch)}
              onRemove={() => setDentalPlans((rows) => rows.filter((r) => r.key !== row.key))}
              endPlaceholder="Never"
              note={`${
                row.kind === "fedvip_dental"
                  ? "Retiree dental through FEDVIP, which replaced TRICARE's."
                  : row.kind === "fedvip_vision"
                    ? "FEDVIP vision, open to you while on a TRICARE plan."
                    : "Private plan premium."
              } Blank end = for life.`}
            />
          ))}
          <button
            type="button"
            onClick={() =>
              setDentalPlans((rows) => [...rows, { key: `new-${Date.now()}`, kind: "fedvip_vision", amount: "", ...newPlanDates() }])
            }
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-900/30"
          >
            + Add dental or vision plan
          </button>
        </div>
        <Field
          label="TRICARE For Life (/yr)"
          hint={
            <>
              Your Medicare Part B premium{tflYear ? `, from ${tflYear} (age ${TFL_AGE})` : ""}.{" "}
              <button
                type="button"
                onClick={() => setTflInfoOpen(true)}
                className="whitespace-nowrap font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                What is TRICARE For Life?
              </button>
            </>
          }
        >
          <input
            name="healthcareAnnual"
            inputMode="decimal"
            defaultValue={plan.healthcareAnnualCents ? centsToDisplay(plan.healthcareAnnualCents) : ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
        <Field label="Rises above inflation (%/yr)" hint="Medical costs grow faster than prices overall: inflation + this. 2.5% + 1.5% = 4% a year.">
          <input name="healthcareGrowthPct" inputMode="decimal" defaultValue={plan.healthcareGrowthPct} className={inputClass} />
        </Field>
        </div>

        <SectionHead
          title="Rental properties"
          open={isOpen("rentals")}
          onToggle={() => toggleSection("rentals")}
          note={
            <>
              Prices, rent and costs at today&rsquo;s rates.{" "}
              <button type="button" onClick={() => setInfo("rentals")} className={infoLink} style={{ color: "var(--viz-savings)" }}>
                How it works
              </button>
            </>
          }
        />
        <div className={isOpen("rentals") ? "contents" : "hidden"}>
        <div className="space-y-2 sm:col-span-2">
          {rentalDrafts.map((r) => {
            const owned = !!r.propertyAccountId;
            const preview = rentalPreview(r);
            return (
              <div key={r.key} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background p-2 ring-1 ring-line sm:grid-cols-4">
                <LineField label="Name" className="col-span-2">
                  <input value={r.name} onChange={(e) => updateRental(r.key, { name: e.target.value })} className={lineInput} />
                </LineField>
                <LineField label="Property" className="col-span-2">
                  <select
                    value={r.propertyAccountId}
                    onChange={(e) => updateRental(r.key, { propertyAccountId: e.target.value, loanAccountId: "" })}
                    className={lineInput}
                  >
                    <option value="">Planned purchase</option>
                    {plan.propertyAccounts.map((a) => (
                      <option key={a.id} value={a.id}>Owned: {a.name}</option>
                    ))}
                  </select>
                </LineField>
                {owned ? (
                  <>
                    {(() => {
                      const linkedLoan = plan.propertyAccounts.find((a) => a.id === r.propertyAccountId)?.loanCents ?? null;
                      return linkedLoan != null ? (
                        <p className="col-span-2 self-center text-xs sm:text-sm text-foreground">
                          <span className="font-semibold">Loan {formatMoneyWhole(linkedLoan, currency)}</span> — the
                          mortgage linked to this property on Accounts.
                        </p>
                      ) : (
                        <LineField label="Loan balance" className="col-span-2 sm:col-span-1">
                          <input inputMode="decimal" value={r.loanBalance} onChange={(e) => updateRental(r.key, { loanBalance: e.target.value })} placeholder="0.00" className={`${lineInput}`} />
                        </LineField>
                      );
                    })()}
                    <LineField label="Years left">
                      <input inputMode="numeric" value={r.loanYears} onChange={(e) => updateRental(r.key, { loanYears: e.target.value })} className={`${lineInput}`} />
                    </LineField>
                  </>
                ) : (
                  <>
                    <LineField label="Buy in">
                      <input inputMode="numeric" value={r.purchaseYear} onChange={(e) => updateRental(r.key, { purchaseYear: e.target.value })} className={`${lineInput}`} />
                    </LineField>
                    <LineField label="Price">
                      <input inputMode="decimal" value={r.value} onChange={(e) => updateRental(r.key, { value: e.target.value })} placeholder="0.00" className={`${lineInput}`} />
                    </LineField>
                    <LineField label="Down %">
                      <input inputMode="decimal" value={r.downPaymentPct} onChange={(e) => updateRental(r.key, { downPaymentPct: e.target.value })} className={`${lineInput}`} />
                    </LineField>
                    <LineField label="Closing %">
                      <input inputMode="decimal" value={r.closingCostPct} onChange={(e) => updateRental(r.key, { closingCostPct: e.target.value })} className={`${lineInput}`} />
                    </LineField>
                    <LineField label="Loan years">
                      <input inputMode="numeric" value={r.loanYears} onChange={(e) => updateRental(r.key, { loanYears: e.target.value })} className={`${lineInput}`} />
                    </LineField>
                  </>
                )}
                <LineField label="Loan rate %">
                  <input inputMode="decimal" value={r.loanRatePct} onChange={(e) => updateRental(r.key, { loanRatePct: e.target.value })} className={`${lineInput}`} />
                </LineField>
                <LineField label="Rent / mo">
                  <input inputMode="decimal" value={r.rent} onChange={(e) => updateRental(r.key, { rent: e.target.value })} placeholder="0.00" className={`${lineInput}`} />
                </LineField>
                <LineField label="Costs / mo">
                  <input inputMode="decimal" value={r.costs} onChange={(e) => updateRental(r.key, { costs: e.target.value })} placeholder="0.00" className={`${lineInput}`} />
                </LineField>
                <LineField label="Value growth %">
                  <input inputMode="decimal" value={r.appreciationPct} onChange={(e) => updateRental(r.key, { appreciationPct: e.target.value })} className={`${lineInput}`} />
                </LineField>
                <button
                  type="button"
                  onClick={() => setRentalDrafts((prev) => prev.filter((x) => x.key !== r.key))}
                  className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  Remove
                </button>
                <p className="col-span-2 text-xs sm:text-sm text-foreground sm:col-span-4">
                  {preview ? (
                    <>
                      {preview.first}:{" "}
                      <span className="font-semibold">
                        {preview.cashMonthly >= 0 ? "+" : "−"}
                        {formatMoneyWhole(Math.abs(preview.cashMonthly), currency)}/mo
                      </span>{" "}
                      after a {formatMoneyWhole(preview.payMonthly, currency)}/mo loan payment
                      {preview.purchaseCash > 0 ? ` · ${formatMoneyWhole(preview.purchaseCash, currency)} down + closing from savings` : ""}
                      {" "}· equity {formatMoneyWhole(preview.equity, currency)} by year end. Costs = taxes, insurance, management, repairs, vacancy. Value growth is on top of inflation.
                    </>
                  ) : (
                    "Enter the year and price to see the first year's cash flow."
                  )}
                </p>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addRental}
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
          >
            + Add rental
          </button>
        </div>
        </div>

        <div className="sm:col-span-full flex items-center justify-start gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : justSaved ? "Saved" : "Save"}
          </button>
          <button type="button" onClick={onClose} className={closeButtonClass}>
            Close
          </button>
        </div>
        {error ? (
          <p className="sm:col-span-full text-sm font-medium text-negative">{error}</p>
        ) : null}
      </form>
      {tflInfoOpen ? <TflInfo tflYear={tflYear} onClose={() => setTflInfoOpen(false)} /> : null}
      {info === "income" ? (
        <InfoPopup
          title="Income"
          onClose={() => setInfo(null)}
          items={[
            ["Only income", "Future years use only these lines and retired pay. No lines: $0."],
            ["Pay (work)", "Your pay from work. Blank end: never stops."],
            ["Pay Increase %/yr", "Added every January after the start year, on top of last year. VA and Social Security use the COLA."],
            ["Rises with COLA", "VA and Social Security. Other lines stay the same."],
            ["Amount changes", "End the old line, then + Add income with the new amount from the month after."],
          ]}
        />
      ) : null}
      {info === "rentals" ? (
        <InfoPopup
          title="Rental properties"
          onClose={() => setInfo(null)}
          items={[
            ["Prices", "Price, rent and costs at today's rates; they rise with inflation each year."],
            ["Counts as", "Net rent is income. Equity (value − loan) is net worth."],
            ["Planning to buy", "Fill it in here."],
            ["Already own one", "Add it on Accounts under Property, then pick it here."],
          ]}
        />
      ) : null}
      {colaWhyOpen ? (
        <ColaWhy
          retire={estimate && colaMilitary ? { year: estimate.retireYear, month: estimate.retireMonth } : null}
          ss={
            ssLineDraft && colaStarts.socialSecurity != null && colaSs
              ? {
                  colaFrom: colaStarts.socialSecurity,
                  paidFrom: toYear(ssLineDraft.startYear)!,
                }
              : null
          }
          onClose={() => setColaWhyOpen(false)}
        />
      ) : null}
    </ModalShell>
  );
}

/** How SGLI or VGLI pays out: once, or 36 equal monthly payments. */
function PayoutSelect({
  name,
  value,
  onChange,
  label,
}: {
  name: string;
  value: InsurancePayout;
  onChange: (v: InsurancePayout) => void;
  label: string;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value === "monthly36" ? "monthly36" : "lump")}
      aria-label={label}
      className="rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
    >
      <option value="lump">Lump sum</option>
      <option value="monthly36">36 monthly payments</option>
    </select>
  );
}

/** A popup section's header: tap to open or fold what's under it. */
function SectionHead({
  title,
  open,
  onToggle,
  note,
  id,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** The section's one-line footnote: beside the title on desktop, under it
   *  on a phone (Victor, 2026-10-16). */
  note?: React.ReactNode;
  id?: string;
}) {
  return (
    <h3
      id={id}
      className="sm:col-span-2 flex scroll-mt-2 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-2 text-left text-sm font-bold uppercase tracking-wide ${note ? "shrink-0 max-sm:w-full" : "w-full"}`}
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
        {title}
      </button>
      {/* The rest of the row opens the section too — only the title did, so a
          click beside it did nothing (Victor, 2026-10-16). A link or button
          inside the note ("How it works") keeps its own click. */}
      {note ? (
        <span
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) return;
            onToggle();
          }}
          className="min-w-0 flex-1 cursor-pointer self-stretch text-xs font-normal text-foreground sm:flex sm:items-center sm:text-sm"
        >
          <span>{note}</span>
        </span>
      ) : null}
    </h3>
  );
}

/** A COLA checkbox, with the year that income's first raise lands. */
/** Income that rises by its own yearly raise; VA and Social Security get the COLA. */
const RAISE_KINDS: IncomeLineKind[] = ["pay", "job", "spouse", "other"];

/** An account group's settings as typed; blank = the default. */
type GroupDraft = {
  returnPct: string;
  taxPct: string;
};

/** Income lines in date order: start, then end. A blank start is now, a
 *  blank end is never. */
function byLineDates(
  lines: LineDraft[],
  thisYear: number,
): LineDraft[] {
  const yr = (v: string) => (/^\d{4}$/.test(v.trim()) ? Number(v) : null);
  const start = (l: LineDraft) => {
    const y = yr(l.startYear);
    return y == null ? thisYear * 12 + new Date().getMonth() + 1 : y * 12 + (Number(l.startMonth) || 1);
  };
  const end = (l: LineDraft) => {
    const y = yr(l.endYear);
    if (y != null) return y * 12 + (Number(l.endMonth) || 12);
    return Number.MAX_SAFE_INTEGER;
  };
  return [...lines].sort((a, b) => start(a) - start(b) || end(a) - end(b));
}

const lineInput =
  "w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

function LineField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="mb-0.5 block text-center max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">{label}</span>
      {children}
    </label>
  );
}

// Sized to the longest value (80000.00), not the column — full-width boxes
// holding "5" or "1981" were mostly empty space.
/** "from Mar" on a line paid only part of the year (its first year). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Medicare Part A starts at 65, and TRICARE For Life with it. */
const TFL_AGE = 65;

// What TRICARE For Life is and what it costs — opened from the TFL box's
// "What is TRICARE For Life?" link (Victor, 2026-10-15). Figures checked
// against CMS and TRICARE on 2026-10-15.
/** Why each COLA starts when it does, worked out from the plan as typed, so
 *  the years move with the retirement date and birth year. */
function ColaWhy({
  retire,
  ss,
  onClose,
}: {
  retire: { year: number; month: number } | null;
  /** Social Security's first raise and first payment. */
  ss: { colaFrom: number; paidFrom: number } | null;
  onClose: () => void;
}) {
  const share = retire ? firstColaShare(retire.month) : 0;
  const mon = retire ? MONTHS[retire.month - 1] : "";
  const firstYear = retire ? retire.year + 1 : 0;
  return (
    <ModalShell title="Why these COLA years" onClose={onClose} className="sm:max-w-lg">
      <div className="space-y-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-sm leading-relaxed">
        {retire ? (
          share > 0 ? (
            <p>
              <span className="font-semibold">Why {firstYear}:</span>{" "}
              it&rsquo;s the DFAS rule. The first COLA after you
              retire only counts the months you were retired. For your {mon} {retire.year} retirement that&rsquo;s{" "}
              {Math.round(share * 100)}% of the January {firstYear} COLA, then the full COLA from January {firstYear + 1}.
            </p>
          ) : (
            <p>
              <span className="font-semibold">
                Why {firstYear + 1}, not {firstYear}:
              </span>{" "}
              it&rsquo;s the DFAS rule, not a mistake. If you retire between October and December, you get 0% of the
              first COLA after retiring. For your {mon} {retire.year} retirement that&rsquo;s the January {firstYear}{" "}
              COLA, so your first real raise is January {firstYear + 1}.
            </p>
          )
        ) : null}
        {retire ? (
          <p>
            <span className="font-semibold">First COLA by retirement month:</span> Jan–Mar 93%, Apr–Jun 57%, Jul–Sep
            25%, Oct–Dec 0%. Full every year after.
          </p>
        ) : null}
        {ss ? (
          <p>
            <span className="font-semibold">Social Security from {ss.colaFrom}:</span> payments start in {ss.paidFrom},
            so the first raise is January {ss.colaFrom}.
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}

/** A section's longer notes: one bold label and a short line each. */
function InfoPopup({ title, items, onClose }: { title: string; items: [string, string][]; onClose: () => void }) {
  return (
    <ModalShell title={title} onClose={onClose} className="sm:max-w-lg">
      <div className="space-y-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-sm leading-relaxed sm:text-base">
        {items.map(([label, text]) => (
          <p key={label}>
            <span className="font-semibold">{label}:</span> {text}
          </p>
        ))}
      </div>
    </ModalShell>
  );
}

function TflInfo({ tflYear, onClose }: { tflYear: number | null; onClose: () => void }) {
  const link = "font-semibold underline underline-offset-2";
  return (
    <ModalShell title="TRICARE For Life" onClose={onClose} className="sm:max-w-lg">
      <div className="space-y-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-sm leading-relaxed">
        <p>
          <span className="font-semibold">What it is:</span>{" "}
          your TRICARE once you&rsquo;re on Medicare. Medicare pays first; TFL pays most of what Medicare doesn&rsquo;t. It
          replaces TRICARE Select or Prime.
        </p>
        <p>
          <span className="font-semibold">When it starts:</span> at 65, the month Medicare starts
          {tflYear ? ` — ${tflYear} for you` : ""}. Each person starts at their own 65.
        </p>
        <p>
          <span className="font-semibold">What it costs:</span> TFL itself is free, but you must have Medicare Part B:{" "}
          <span className="font-semibold">$202.90/mo per person in 2026</span> ($2,434.80 a year). Higher incomes pay more.
        </p>
        <p>
          <span className="font-semibold">Don&rsquo;t skip Part B:</span> without it you lose TRICARE coverage at 65.
        </p>
        <p>
          <span className="font-semibold">What to enter:</span> 2434.80 for one person, 4869.60 for two. It rises with medical
          inflation each year.
        </p>
        <ul className="space-y-1 border-t border-line pt-3">
          <li>
            <a href="https://www.tricare.mil/tfl" target="_blank" rel="noopener noreferrer" className={link} style={{ color: "var(--viz-savings)" }}>
              TRICARE For Life (tricare.mil)
            </a>
          </li>
          <li>
            <a
              href="https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles"
              target="_blank"
              rel="noopener noreferrer"
              className={link}
              style={{ color: "var(--viz-savings)" }}
            >
              2026 Part B premium (cms.gov)
            </a>
          </li>
          <li>
            <a href="https://www.medicare.gov/basics/costs/medicare-costs" target="_blank" rel="noopener noreferrer" className={link} style={{ color: "var(--viz-savings)" }}>
              Medicare costs (medicare.gov)
            </a>
          </li>
        </ul>
      </div>
    </ModalShell>
  );
}

// One health or dental & vision plan: type, yearly premium, start, end and
// Remove, with a short note under it.
function PlanRow<K extends string>({
  row,
  kinds,
  ariaLabel,
  onChange,
  onRemove,
  endPlaceholder,
  note,
}: {
  row: PlanDraft<K>;
  kinds: { value: K; label: string }[];
  ariaLabel: string;
  onChange: (patch: Partial<PlanDraft<K>>) => void;
  onRemove: () => void;
  endPlaceholder: string;
  note: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg bg-background p-2 ring-1 ring-line">
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_9.5rem_9.5rem_auto]">
        <LineField label="Plan" className="col-span-2 sm:col-span-1">
          <select
            value={row.kind}
            onChange={(e) => onChange({ kind: e.target.value as K } as Partial<PlanDraft<K>>)}
            aria-label={ariaLabel}
            className={`${lineInput} cursor-pointer`}
          >
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </LineField>
        <LineField label="$ / yr">
          <input
            inputMode="decimal"
            value={row.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            placeholder="0.00"
            aria-label="Premium per year"
            className={`${lineInput} tabular-nums`}
          />
        </LineField>
        <LineField label="Starts">
          <MonthYearBox
            label="Start"
            blankMonth="Jan"
            month={row.startMonth}
            onMonth={(v) => onChange({ startMonth: v })}
            year={row.startYear}
            onYear={(v) => onChange({ startYear: v })}
          />
        </LineField>
        <LineField label="Ends">
          <MonthYearBox
            label="End"
            blankMonth="Dec"
            month={row.endMonth}
            onMonth={(v) => onChange({ endMonth: v })}
            year={row.endYear}
            onYear={(v) => onChange({ endYear: v })}
            yearPlaceholder={endPlaceholder}
          />
        </LineField>
        <button
          type="button"
          onClick={onRemove}
          className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
        >
          Remove
        </button>
      </div>
      <p className="text-xs leading-snug text-foreground sm:text-sm">{note}</p>
    </div>
  );
}

// A small month picker + year box for a start or end inside a row. A blank
// month reads as `blankMonth` (Jan for a start, Dec for an end), and that's
// what saving assumes too.
function MonthYearBox({
  label,
  blankMonth,
  month,
  onMonth,
  year,
  onYear,
  yearPlaceholder,
  monthName,
  yearName,
}: {
  label: string;
  blankMonth: "Jan" | "Dec";
  month: string;
  onMonth: (v: string) => void;
  year: string;
  onYear: (v: string) => void;
  yearPlaceholder?: string;
  monthName?: string;
  yearName?: string;
}) {
  const others = blankMonth === "Jan" ? MONTHS.map((m, i) => [m, i + 1] as const).slice(1) : MONTHS.map((m, i) => [m, i + 1] as const).slice(0, 11);
  return (
    <span className="flex gap-1">
      <select
        name={monthName}
        value={month}
        onChange={(e) => onMonth(e.target.value)}
        aria-label={`${label} month`}
        className="w-[4.5rem] shrink-0 cursor-pointer rounded-md bg-surface px-1.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <option value="">{blankMonth}</option>
        {others.map(([m, n]) => (
          <option key={m} value={n}>
            {m}
          </option>
        ))}
      </select>
      <input
        name={yearName}
        inputMode="numeric"
        value={year}
        onChange={(e) => onYear(e.target.value)}
        placeholder={yearPlaceholder}
        aria-label={`${label} year`}
        className={`${lineInput} flex-1 text-center`}
      />
    </span>
  );
}

// A month picker and a four-digit year box, side by side in one field.
function MonthYear({
  monthName,
  month,
  onMonth,
  yearName,
  year,
  onYear,
  label,
}: {
  monthName: string;
  month: string;
  onMonth: (v: string) => void;
  yearName: string;
  year: string;
  onYear: (v: string) => void;
  label: string;
}) {
  return (
    <span className="flex w-44 gap-1.5">
      <select
        name={monthName}
        value={month}
        onChange={(e) => onMonth(e.target.value)}
        aria-label={`${label} month`}
        className="w-[5.5rem] shrink-0 cursor-pointer rounded-md bg-surface px-1.5 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <input
        name={yearName}
        inputMode="numeric"
        value={year}
        onChange={(e) => onYear(e.target.value)}
        aria-label={`${label} year`}
        placeholder="Year"
        className="w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </span>
  );
}

const inputClass =
  "w-28 rounded-md bg-surface px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

// Each field: bold title on top, then the box with its note beside it, so
// the note explains the box it sits next to.
function Field({
  id,
  className,
  highlight = false,
  center = false,
  label,
  hint,
  children,
}: {
  id?: string;
  className?: string;
  /** Label and box centred in their column (General Profile Data). */
  center?: boolean;
  /** Light-blue outline for the box a button sent you to. */
  highlight?: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label
      id={id}
      className={`block ${className ?? ""} ${highlight ? "-m-2 rounded-md bg-sky-50 p-2 ring-2 ring-sky-400 dark:bg-sky-950/40" : ""}`}
    >
      <span className={`mb-1 block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground ${center ? "text-center" : ""}`}>{label}</span>
      <span className={center ? "flex justify-center" : "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3"}>
        {children}
        {hint ? <span className="text-xs leading-snug text-foreground sm:text-sm">{hint}</span> : null}
      </span>
    </label>
  );
}

// A header stat as its own small card, the same look as the milestone cards
// under it, so the summary and the detail read as one set rather than a line
// of labels floating over a divider.
/** One line of the retirement-income breakdown: a label, then the monthly and
 *  yearly amounts in fixed-width columns so they line up down the list. */
function IncomeRow({
  label,
  note,
  monthly,
  yearly,
  currency,
  tone = "",
  bold = false,
}: {
  label: React.ReactNode;
  note?: string;
  monthly: number;
  yearly: number;
  currency: string;
  tone?: string;
  bold?: boolean;
}) {
  return (
    <li className={`flex items-center justify-between gap-3 py-1 ${bold ? "font-semibold" : ""}`}>
      <span className="min-w-0">
        {label}
        {note ? <span className="block text-xs font-normal text-foreground sm:text-sm">{note}</span> : null}
      </span>
      <span className={`flex shrink-0 tabular-nums ${tone}`}>
        <span className="w-[4.5rem] text-right sm:w-24 xl:w-20 2xl:w-24">{formatMoneyWhole(monthly, currency)}</span>
        <span className="w-[5.75rem] text-right sm:w-28 xl:w-24 2xl:w-28">{formatMoneyWhole(yearly, currency)}</span>
      </span>
    </li>
  );
}


