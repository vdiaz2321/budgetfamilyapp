"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, formatMoney, formatMoneyWhole } from "@/lib/money";
import {
  INCOME_LINE_KINDS,
  ageInYear,
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
} from "@/lib/retirement";
import { saveRetirementPlan } from "./actions";

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
  sbpEnabled: boolean;
  sbpPct: number;
  /** The age the plan runs to. */
  longevityAge: number;
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
  children: (parts: { assumptions: React.ReactNode; details: React.ReactNode }) => React.ReactNode;
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-fi", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  // true = open at the top; "sbp" = open scrolled to the SBP box.
  const [editing, setEditing] = useState<boolean | "sbp">(false);

  const portfolioCents = measured.assetsCents;
  // The projection starts from this year's planned year-end net worth (the
  // Current and Projected Net Worth table's own figure), so every future year matches the
  // table exactly.
  const startCents =
    projection.find((p) => p.year === thisYear)?.eoyCents || portfolioCents;
  // The first FULL year of military retirement: a November retirement year
  // holds ten months of active-duty pay and only two of retired pay.
  const firstFullRetiredYear =
    plan.targetRetireYear == null
      ? thisYear + 1
      : plan.targetRetireYear + ((plan.targetRetireMonth ?? 1) > 1 ? 1 : 0);

  // Military retired pay from the DFAS High-3 formula — the same every year, no COLA.
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
  // Income is gross: taxes are budgeted as spending.
  const incomeIn = (year: number) =>
    incomeForYear(year, pension, plan.targetRetireYear, plan.incomeLines, 0);
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
  const untilYear = plan.birthYear ? plan.birthYear + plan.longevityAge : null;

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
  // The year 4% withdrawals start — set on its own (a civilian job can follow
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
    if (!plan.targetRetireYear) return null;
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
  const retireSpendYearly = plan.targetRetireYear
    ? projection.find((p) => p.year === incomeYear)?.spendingCents ?? 0
    : 0;
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
  // Only from the first FULL year of military retirement: before it, the
  // plan's income is his active-duty pay, which the table doesn't split out.
  const survivorFirst = Math.max(thisYear + 1, firstFullRetiredYear);
  const [deathYearPick, setDeathYear] = useState<number | null>(null);
  const deathYear = Math.max(survivorFirst, deathYearPick ?? survivorFirst);
  const insuranceCents = plan.survivorExtras.insurance.reduce((t, i) => t + i.cents, 0);
  const benefitsMonthly = plan.survivorExtras.benefits.reduce((t, b) => t + b.monthlyCents, 0);
  const survIn = (year: number) =>
    survivorIncomeForYear(year, pension, plan.targetRetireYear, plan.sbpEnabled, plan.incomeLines, 0);
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
      return {
        year: y.year,
        spendCents: y.spendCents,
        // Same spending; his income out, the survivor's in, the payout once.
        contributionCents:
          y.contributionCents - base.afterTaxCents + surv.afterTaxCents + benefits + (y.year === deathYear ? insuranceCents : 0),
        guaranteedCents: surv.guaranteedCents + benefits + rent,
      };
    });
    return projectFi({ ...baseInputs, schedule: survSchedule, ownGrowthFrom: deathYear }, thisYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, usingGrid, untilYear, deathYear, insuranceCents, benefitsMonthly, plan, projection, thisYear, startCents]);
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
      spendMonthly: Math.round(spendYearly / 12),
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

  // The button that opens the rates that rebuild the table, above it.
  const assumptions = (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-foreground">
      <button
        type="button"
        onClick={() => setEditing(true)}
        // Soft blue from the viz palette (not brand indigo — no purple on data).
        className="rounded-md px-2 py-0.5 text-xs font-semibold sm:text-sm ring-1 transition bg-[color-mix(in_srgb,var(--viz-savings)_12%,transparent)] text-[color-mix(in_srgb,var(--viz-savings)_80%,var(--foreground))] ring-[color-mix(in_srgb,var(--viz-savings)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--viz-savings)_22%,transparent)]"
      >
        Edit Retirement / FI Assumptions
      </button>
    </p>
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
            {retireIncome && plan.targetRetireYear ? (
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
                  {incomeYear === firstFullRetiredYear && incomeYear !== plan.targetRetireYear ? (
                    <span className="block basis-full text-xs font-normal sm:text-sm">First full year retired</span>
                  ) : null}
                </p>
                {retireIncome.parts.length === 0 ? (
                  <p className="mt-1 text-center text-xs sm:text-sm text-foreground">No retirement income yet — add it in Edit Retirement / FI Assumptions.</p>
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
                        note={[partNote(part), retireIncome.taxMonthly > 0 ? "before tax" : ""].filter(Boolean).join(", ") || undefined}
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
                      note={retireIncome.parts.some((p) => (p.months ?? 12) < 12) ? "monthly = yearly ÷ 12" : undefined}
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
                {pension ? null : (
                  <p className="mt-1.5 text-center text-xs sm:text-sm text-foreground">Add service start and base pay in Edit Retirement / FI Assumptions.</p>
                )}
              </div>
            ) : null}

            <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="text-center text-sm font-bold sm:text-lg">Investments</p>
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg xl:text-base 2xl:text-lg">
                {mile ? (
                  <>
                    {/* No gap means nothing for the investments to fund —
                        said in words, since "$0" read like a missing figure. */}
                    <ValueRow
                      label={`Needed in ${mile.year}`}
                      note={
                        mile.targetCents > 0
                          ? `to cover the gap at ${plan.withdrawalRatePct}% a year`
                          : "Retired pay covers spending"
                      }
                      value={mile.targetCents > 0 ? formatMoneyWhole(mile.targetCents, currency) : "Nothing"}
                      tone={mile.targetCents > 0 ? "" : "text-positive"}
                    />
                    <ValueRow label={`Expected in ${mile.year}`} value={formatMoneyWhole(mile.endCents, currency)} />
                    <ValueRow
                      label="Status"
                      value={
                        mile.endCents >= mile.targetCents
                          ? "On track"
                          : `Short ${formatMoneyWhole(mile.targetCents - mile.endCents, currency)}`
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
                <ValueRow
                  label="Money lasts"
                  // The gap as a share of the expected balance — how hard the
                  // investments work that year, next to the 4% rule of thumb.
                  note={
                    mile && mile.endCents > 0 && mile.targetCents > 0
                      ? (() => {
                          // The share of the investments the year's gap uses,
                          // read against the withdrawal-rate limit set in
                          // Edit assumptions — the one % he can find there.
                          const usePct = (plan.withdrawalRatePct * mile.targetCents) / mile.endCents;
                          return `you'd use ${usePct.toFixed(1)}% a year in ${mile.year} · ${
                            usePct <= plan.withdrawalRatePct ? "under" : "over"
                          } your ${plan.withdrawalRatePct}% limit`;
                        })()
                      : undefined
                  }
                  value={
                    untilYear == null
                      ? "Add birth year"
                      : runsOutAge != null
                        ? `Runs out at age ${runsOutAge}`
                        : `To age ${plan.longevityAge}`
                  }
                  tone={untilYear == null ? "" : runsOutAge != null ? "text-negative" : "text-positive"}
                />
                {/* The plan-until age is the last card above the table. */}
                <ValueRow
                  label="Left at age 80"
                  // The year that age falls in — the balance is its year-end
                  // bar in the chart below.
                  note={plan.birthYear ? `Year: ${plan.birthYear + 80}` : undefined}
                  value={at80 == null ? "—" : formatMoneyWhole(Math.max(0, at80), currency)}
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
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg xl:text-base 2xl:text-lg">
                <li className="flex justify-between gap-3 py-1 max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
                  <span>Family income</span>
                  <span className="flex shrink-0">
                    <span className="w-[4.5rem] text-right sm:w-24 xl:w-20 2xl:w-24">Monthly</span>
                    <span className="w-[5.75rem] text-right sm:w-28 xl:w-24 2xl:w-28">Yearly</span>
                  </span>
                </li>
                {survivorYear.parts.map((part, i) => (
                  <IncomeRow
                    key={i}
                    label={part.name}
                    note={[partNote(part), part.monthlyBeforeTaxCents !== part.monthlyAfterTaxCents ? "before tax" : ""].filter(Boolean).join(", ") || undefined}
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
                  label="Planned spending"
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
                <ValueRow
                  label="Money lasts"
                  value={
                    !survivor
                      ? untilYear == null ? "Add birth year" : "Add a plan above"
                      : survivor.runsOutYear
                        ? `Runs out in ${survivor.runsOutYear}`
                        : `Through ${untilYear}`
                  }
                  tone={!survivor ? "" : survivor.runsOutYear ? "text-negative" : "text-positive"}
                  bold
                />
              </ul>
              {/* Without SBP the retired pay stops at death, which is why
                  family income can read $0 — said here, with the way to fix it
                  one press away (Victor, 2026-10-15). */}
              {!plan.sbpEnabled ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-md bg-negative/10 px-2 py-1.5 text-center text-xs sm:text-sm">
                  <span className="text-foreground">
                    <span className="font-semibold text-negative">SBP: off</span> — retired pay stops for the family
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing("sbp")}
                    className="rounded-md bg-surface px-2 py-0.5 font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
                  >
                    Turn on SBP
                  </button>
                </div>
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
              {" · "}Money lasts:{" "}
              <span className={`font-semibold ${untilYear == null ? "" : stressed.runsOutYear ? "text-negative" : "text-positive"}`}>
                {untilYear == null
                  ? "Add birth year"
                  : stressed.runsOutYear
                    ? `Runs out at age ${stressed.runsOutYear - (plan.birthYear ?? 0)}`
                    : `To age ${plan.longevityAge}`}
              </span>
              {stressEnd != null ? (
                <>
                  {" · "}Left at age {plan.longevityAge}:{" "}
                  <span className="font-semibold">{formatMoneyWhole(Math.max(0, stressEnd), currency)}</span>
                  {planEnd != null ? ` (without the drop ${formatMoneyWhole(Math.max(0, planEnd), currency)})` : ""}
                </>
              ) : null}
            </p>
          ) : null}

          <FiChart
            view={chartView}
            stressEnds={stressed && chartView === "nw" ? new Map(stressed.years.map((y) => [y.year, y.endCents])) : null}
            stressPct={dropPct}
            fi={fi}
            thisYear={thisYear}
            birthYear={plan.birthYear}
            targetRetireYear={plan.targetRetireYear}
            ssYear={ssLine?.startYear ?? null}
            projection={projection}
            currency={currency}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {children({ assumptions, details })}
      {editing ? (
        <PlanModal
          plan={plan}
          thisYear={thisYear}
          currency={currency}
          focusSbp={editing === "sbp"}
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

/** One label/value line in the Investments panel, styled like IncomeRow. */
function ValueRow({
  label,
  note,
  value,
  tone = "",
  bold = false,
}: {
  label: string;
  note?: string;
  value: string;
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
  { value: "private", label: "Private insurance" },
];

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
  focusSbp = false,
  onClose,
}: {
  plan: FiPlan;
  thisYear: number;
  currency: string;
  /** Opened from "Turn on SBP": scroll to that box and outline it. */
  focusSbp?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!focusSbp) return;
    const box = document.getElementById("fi-sbp");
    box?.scrollIntoView({ block: "center" });
    box?.querySelector("input")?.focus({ preventScroll: true });
  }, [focusSbp]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  const [lines, setLines] = useState<LineDraft[]>(() =>
    plan.incomeLines.map((l) => ({
      key: l.id,
      id: l.id,
      name: l.name,
      kind: l.kind,
      monthly: centsToDisplay(l.monthlyCents),
      startYear: l.startYear?.toString() ?? "",
      startMonth: l.startMonth?.toString() ?? "",
      endYear: l.endYear?.toString() ?? "",
      taxable: l.taxable,
    })),
  );
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

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (kind: IncomeLineKind) =>
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        name: DEFAULT_LINE_NAME[kind],
        kind,
        monthly: "",
        startYear: retireYear,
        // Retired pay's own start month, so VA lines up with it by default.
        startMonth: retireMonth,
        endYear: "",
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
    formData.set("healthPlans", planJson(healthPlans));
    formData.set("dentalPlans", planJson(dentalPlans));
    formData.set(
      "incomeLines",
      JSON.stringify(
        lines.map((l) => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          monthly: l.monthly,
          startYear: l.startYear,
          startMonth: l.startMonth,
          endYear: l.endYear,
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
    start(async () => {
      const result = await saveRetirementPlan(formData);
      if (result?.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  }

  const heading = "sm:col-span-2 border-t border-line pt-3 text-sm font-bold uppercase tracking-wide first:border-t-0 first:pt-0";
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
          <span className="min-w-0 whitespace-normal leading-tight sm:truncate">Retirement / FI Assumptions</span>
          {/* Outside the <form>, so it points at it by id. */}
          <button
            type="submit"
            form="fi-plan-form"
            disabled={pending}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
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
      className="sm:max-w-3xl"
    >
      <form
        id="fi-plan-form"
        onSubmit={submit}
        className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        {/* Also up here, so a rejected save from the top Save is seen. */}
        {error ? <p className="sm:col-span-full text-sm font-medium text-negative">{error}</p> : null}
        <h3 className={heading}>Info Data About You</h3>
        <Field label="Birth year" hint="Used to show your age on the chart.">
          <input name="birthYear" inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Plan until age" hint="How far the plan runs, and the last age shown under What is expected.">
          <input name="longevityAge" inputMode="numeric" defaultValue={plan.longevityAge} className={inputClass} />
        </Field>

        <h3 className={heading}>Military retirement</h3>
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
          highlight={focusSbp}
          label="SBP (Survivor Benefit Plan)"
          hint={
            <>
              Select and the rate comes off gross retired pay, before tax.{" "}
              <a
                href="https://www.dfas.mil/RetiredMilitary/provide/sbp/"
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap font-semibold underline underline-offset-2"
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
              {" "}The same every year after.
            </span>
          </p>
        ) : null}

        <h3 className={heading}>Healthcare in retirement</h3>
        <p className="-mt-2 text-xs text-foreground sm:col-span-2">
          Yearly premiums for the family at current rates. Each one is added to that year&rsquo;s spending.
        </p>
        {/* One row per plan; two can run side by side (a TRICARE plan plus a
            private supplement). All of them stop when TFL starts. */}
        <div className="space-y-2 sm:col-span-2">
          {healthPlans.length === 0 ? (
            <p className="text-xs text-foreground">No health plan premium before TRICARE For Life.</p>
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
              note={`${
                row.kind === "private"
                  ? "Private or employer plan premium."
                  : `Retiree ${row.kind === "tricare_prime" ? "TRICARE Prime" : "TRICARE Select"} enrollment fee.`
              } Blank end = until TRICARE For Life starts${tflYear ? ` (${tflYear})` : ""}.`}
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
          {dentalPlans.length === 0 ? <p className="text-xs text-foreground">No dental or vision premium.</p> : null}
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

        <h3 className={heading}>Rates &amp; withdrawals</h3>
        <Field label="Expected rate of return (%)" hint="What your investments earn a year. Only investments — not income or savings.">
          <input name="investmentReturnPct" inputMode="decimal" defaultValue={plan.investmentReturnPct} className={inputClass} />
        </Field>
        <Field label="Savings APY (%)" hint="What your checking and savings accounts on Accounts earn a year.">
          <input name="cashReturnPct" inputMode="decimal" defaultValue={plan.cashReturnPct} className={inputClass} />
        </Field>
        <Field label="Spending inflation (%)" hint="How much your spending, healthcare and rental costs go up each year.">
          <input
            name="inflationPct"
            inputMode="decimal"
            value={inflation}
            onChange={(e) => setInflation(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Withdrawal rate (%)" hint="The most you plan to take from investments each year once you stop working. Needed = the yearly gap ÷ this rate.">
          <input name="withdrawalRatePct" inputMode="decimal" defaultValue={plan.withdrawalRatePct} className={inputClass} />
        </Field>
        <Field label="Withdrawals start (year)" hint="When you stop working and start drawing on investments. Blank = the military retirement year.">
          <input
            name="withdrawStartYear"
            inputMode="numeric"
            defaultValue={plan.withdrawStartYear ?? ""}
            placeholder={plan.targetRetireYear ? String(plan.targetRetireYear) : ""}
            className={inputClass}
          />
        </Field>

        <h3 className={heading}>Other income</h3>
        <p className="-mt-2 text-xs text-foreground sm:col-span-2">
          Per month, before tax; stays the same every year. If an amount changes, type an End Year on the old line,
          then + Add income with the new amount starting the year after.
        </p>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background p-2 ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_6rem_9.5rem_4.5rem_auto]">
              <LineField label="Type" className="col-span-2 sm:col-span-1">
                <select
                  value={l.kind}
                  onChange={(e) => {
                    // The type is the line's name — there is no separate Name field.
                    const kind = e.target.value as IncomeLineKind;
                    updateLine(l.key, { kind, taxable: kind !== "va", name: DEFAULT_LINE_NAME[kind] });
                  }}
                  className={lineInput}
                >
                  {INCOME_LINE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </LineField>
              <LineField label="$ / mo">
                <input
                  inputMode="decimal"
                  value={l.monthly}
                  onChange={(e) => updateLine(l.key, { monthly: e.target.value })}
                  placeholder="0.00"
                  className={`${lineInput} text-center`}
                />
              </LineField>
              {/* Month + year: the first year only counts from this month on. */}
              <LineField label="Starts">
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
              <LineField label="End year">
                <input
                  inputMode="numeric"
                  value={l.endYear}
                  onChange={(e) => updateLine(l.key, { endYear: e.target.value })}
                  className={`${lineInput} text-center`}
                />
              </LineField>
              <button
                type="button"
                onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                Remove
              </button>
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

        <h3 className={heading}>Rental properties</h3>
        <p className="-mt-2 text-xs text-foreground sm:col-span-2">
          Prices, rent and costs at current rates; they go up with inflation each year. Net rent counts as income; equity
          (value − loan) counts toward net worth. Planning to buy? Fill it in here. Already own one? Add it on
          Accounts under Property, then pick it in Property.
        </p>
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
                        <p className="col-span-2 self-center text-xs text-foreground">
                          <span className="font-semibold">Loan {formatMoneyWhole(linkedLoan, currency)}</span> — the
                          mortgage linked to this property on Accounts.
                        </p>
                      ) : (
                        <LineField label="Loan balance" className="col-span-2 sm:col-span-1">
                          <input inputMode="decimal" value={r.loanBalance} onChange={(e) => updateRental(r.key, { loanBalance: e.target.value })} placeholder="0.00" className={`${lineInput} text-center`} />
                        </LineField>
                      );
                    })()}
                    <LineField label="Years left">
                      <input inputMode="numeric" value={r.loanYears} onChange={(e) => updateRental(r.key, { loanYears: e.target.value })} className={`${lineInput} text-center`} />
                    </LineField>
                  </>
                ) : (
                  <>
                    <LineField label="Buy in">
                      <input inputMode="numeric" value={r.purchaseYear} onChange={(e) => updateRental(r.key, { purchaseYear: e.target.value })} className={`${lineInput} text-center`} />
                    </LineField>
                    <LineField label="Price">
                      <input inputMode="decimal" value={r.value} onChange={(e) => updateRental(r.key, { value: e.target.value })} placeholder="0.00" className={`${lineInput} text-center`} />
                    </LineField>
                    <LineField label="Down %">
                      <input inputMode="decimal" value={r.downPaymentPct} onChange={(e) => updateRental(r.key, { downPaymentPct: e.target.value })} className={`${lineInput} text-center`} />
                    </LineField>
                    <LineField label="Closing %">
                      <input inputMode="decimal" value={r.closingCostPct} onChange={(e) => updateRental(r.key, { closingCostPct: e.target.value })} className={`${lineInput} text-center`} />
                    </LineField>
                    <LineField label="Loan years">
                      <input inputMode="numeric" value={r.loanYears} onChange={(e) => updateRental(r.key, { loanYears: e.target.value })} className={`${lineInput} text-center`} />
                    </LineField>
                  </>
                )}
                <LineField label="Loan rate %">
                  <input inputMode="decimal" value={r.loanRatePct} onChange={(e) => updateRental(r.key, { loanRatePct: e.target.value })} className={`${lineInput} text-center`} />
                </LineField>
                <LineField label="Rent / mo">
                  <input inputMode="decimal" value={r.rent} onChange={(e) => updateRental(r.key, { rent: e.target.value })} placeholder="0.00" className={`${lineInput} text-center`} />
                </LineField>
                <LineField label="Costs / mo">
                  <input inputMode="decimal" value={r.costs} onChange={(e) => updateRental(r.key, { costs: e.target.value })} placeholder="0.00" className={`${lineInput} text-center`} />
                </LineField>
                <LineField label="Value growth %">
                  <input inputMode="decimal" value={r.appreciationPct} onChange={(e) => updateRental(r.key, { appreciationPct: e.target.value })} className={`${lineInput} text-center`} />
                </LineField>
                <button
                  type="button"
                  onClick={() => setRentalDrafts((prev) => prev.filter((x) => x.key !== r.key))}
                  className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  Remove
                </button>
                <p className="col-span-2 text-xs text-foreground sm:col-span-4">
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

        <div className="sm:col-span-full flex items-center justify-start gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
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
    </ModalShell>
  );
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
const partNote = (p: { months?: number; firstMonth?: number }) =>
  p.months != null && p.months < 12 && p.firstMonth ? `from ${MONTHS[p.firstMonth - 1]}` : "";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Medicare Part A starts at 65, and TRICARE For Life with it. */
const TFL_AGE = 65;

// What TRICARE For Life is and what it costs — opened from the TFL box's
// "What is TRICARE For Life?" link (Victor, 2026-10-15). Figures checked
// against CMS and TRICARE on 2026-10-15.
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
            className={`${lineInput} text-center tabular-nums`}
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
      <p className="text-xs leading-snug text-foreground">{note}</p>
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
  highlight = false,
  label,
  hint,
  children,
}: {
  id?: string;
  /** Light-blue outline for the box a button sent you to. */
  highlight?: boolean;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label
      id={id}
      className={`block ${highlight ? "-m-2 rounded-md bg-sky-50 p-2 ring-2 ring-sky-400 dark:bg-sky-950/40" : ""}`}
    >
      <span className="mb-1 block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">{label}</span>
      <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
        {children}
        {hint ? <span className="text-xs leading-snug text-foreground">{hint}</span> : null}
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
  label: string;
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


