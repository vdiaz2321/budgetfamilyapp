"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, formatMoneyWhole } from "@/lib/money";
import {
  INCOME_LINE_KINDS,
  ageInYear,
  estimatePension,
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
  /** Raises spending, healthcare and rental prices each year. */
  inflationPct: number;
  /** Yearly raise on retired pay, VA, Social Security and other income. */
  colaPct: number;
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
  /** Dental & vision per year from military retirement on. */
  dentalVisionAnnualCents: number | null;
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
  const [editing, setEditing] = useState(false);

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

  // Military retired pay from the DFAS High-3 formula, with a COLA each year after.
  const pension = estimatePension(
    {
      retireYear: plan.targetRetireYear,
      retireMonth: plan.targetRetireMonth,
      serviceStartYear: plan.serviceStartYear,
      serviceStartMonth: plan.serviceStartMonth,
      high3MonthlyCents: plan.high3MonthlyCents,
      colaPct: plan.colaPct,
      sbpEnabled: plan.sbpEnabled,
      sbpPct: plan.sbpPct,
    },
  );
  // Income is gross: taxes are budgeted as spending.
  const incomeIn = (year: number) =>
    incomeForYear(year, pension, plan.targetRetireYear, plan.incomeLines, 0, thisYear, plan.colaPct);
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

  // Monthly income in the first FULL year of military retirement, by source —
  // the same year as a row of the table, so "Left to save" matches it.
  const incomeYear = firstFullRetiredYear;
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
  // retirement starts, the worst year for it to happen.
  const [dropPct, setDropPct] = useState(30);
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
    () => projectFi({ ...baseInputs, schedule, shock: { year: shockYear, pct: dropPct } }, thisYear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startCents, measured.contributionCents, measured.spendCents, measured.cashCents, plan.investmentReturnPct, plan.cashReturnPct, toInvestPct, plan.withdrawalRatePct, schedule, untilYear, thisYear, shockYear, dropPct],
  );
  const endOf = (years: { year: number; endCents: number }[]) =>
    untilYear == null ? null : years.find((y) => y.year === untilYear)?.endCents ?? null;
  const shockRow = stressed.years.find((y) => y.year === shockYear) ?? null;
  const planEnd = endOf(fi.years);
  const stressEnd = endOf(stressed.years);

  // ---- Survivor view: the plan from `deathYear` on, if Victor dies first.
  // Only from the first FULL year of military retirement: before it, the
  // plan's income is his active-duty pay, which the table doesn't split out.
  const survivorFirst = Math.max(thisYear + 1, firstFullRetiredYear);
  const [deathYearPick, setDeathYear] = useState<number | null>(null);
  const deathYear = Math.max(survivorFirst, deathYearPick ?? survivorFirst);
  const insuranceCents = plan.survivorExtras.insurance.reduce((t, i) => t + i.cents, 0);
  const benefitsMonthly = plan.survivorExtras.benefits.reduce((t, b) => t + b.monthlyCents, 0);
  const survIn = (year: number) =>
    survivorIncomeForYear(year, pension, plan.targetRetireYear, plan.sbpEnabled, plan.incomeLines, 0, thisYear, plan.colaPct);
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
      const benefits = Math.round(benefitsMonthly * 12 * inflateTo(y.year, thisYear, plan.colaPct));
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
    return {
      tax: 0,
      parts: surv.parts,
      taxMonthly: beforeTax - afterTax,
      afterTaxMonthly: afterTax + Math.round(benefitsMonthly * inflateTo(deathYear, thisYear, plan.colaPct)),
      spendMonthly: Math.round(spendYearly / 12),
    };
  })();
  const yearOptions =
    untilYear == null ? [] : Array.from({ length: Math.max(0, untilYear - survivorFirst + 1) }, (_, i) => survivorFirst + i);

  // The button that opens the rates that rebuild the table, above it.
  const assumptions = (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-foreground">
      <button
        type="button"
        onClick={() => setEditing(true)}
        // Soft blue from the viz palette (not brand indigo — no purple on data).
        className="rounded-md px-2 py-0.5 text-xs font-semibold sm:text-sm ring-1 transition bg-[color-mix(in_srgb,var(--viz-savings)_12%,transparent)] text-[color-mix(in_srgb,var(--viz-savings)_80%,var(--foreground))] ring-[color-mix(in_srgb,var(--viz-savings)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--viz-savings)_22%,transparent)]"
      >
        Edit assumptions
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
          {/* Two panels instead of five scattered cards: what retirement
              pays (before tax, the tax, after tax, against spending) and what
              the investments have to do about the gap. Each reads top to
              bottom as one sum. */}
          <div className={`mt-3 grid gap-3 ${retireIncome ? "md:grid-cols-2" : ""}`}>
            {retireIncome && plan.targetRetireYear ? (
              <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
                <p className="text-center text-sm font-bold sm:text-lg">
                  Income in {incomeYear}
                  {plan.birthYear ? ` · age ${incomeYear - plan.birthYear}` : ""}
                  {incomeYear !== plan.targetRetireYear ? (
                    <span className="block text-xs font-normal sm:text-sm">First full year retired</span>
                  ) : null}
                </p>
                {retireIncome.parts.length === 0 ? (
                  <p className="mt-1 text-center text-xs sm:text-sm text-foreground">No retirement income yet — add it in Edit assumptions.</p>
                ) : (
                  <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg">
                    <li className="flex justify-between gap-3 py-1 max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
                      <span />
                      <span className="flex shrink-0">
                        <span className="w-[4.5rem] text-right sm:w-24">Monthly</span>
                        <span className="w-[5.75rem] text-right sm:w-28">Yearly</span>
                      </span>
                    </li>
                    {retireIncome.parts.map((part, i) => (
                      <IncomeRow
                        key={i}
                        label={part.name}
                        note={retireIncome.taxMonthly > 0 ? "before tax" : undefined}
                        monthly={part.monthlyBeforeTaxCents}
                        yearly={part.monthlyBeforeTaxCents * 12}
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
                  <p className="mt-1.5 text-center text-xs sm:text-sm text-foreground">Add service start and High-3 in Edit assumptions.</p>
                )}
              </div>
            ) : null}

            <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="text-center text-sm font-bold sm:text-lg">Investments</p>
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg">
                {mile ? (
                  <>
                    <ValueRow
                      label={`Needed in ${mile.year}`}
                      note={`to cover the gap at ${plan.withdrawalRatePct}% a year`}
                      value={formatMoneyWhole(mile.targetCents, currency)}
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
          </div>

          {/* What-ifs: a bad market at retirement, and the family's income if
              Victor dies first. Each reruns the same plan with one thing changed. */}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="text-center text-sm font-bold sm:text-lg">Bad-market test</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-xs sm:text-sm">
                <span className="text-foreground">Drop in {shockYear}:</span>
                {[20, 30, 40].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setDropPct(pct)}
                    aria-pressed={dropPct === pct}
                    className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 transition ${
                      dropPct === pct
                        ? "bg-negative/15 text-foreground ring-negative/30"
                        : "bg-surface text-foreground ring-line hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
                    }`}
                  >
                    −{pct}%
                  </button>
                ))}
              </div>
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg">
                <ValueRow
                  label={`Lost in ${shockYear}`}
                  value={shockRow ? `−${formatMoneyWhole(Math.abs(shockRow.growthCents), currency)}` : "—"}
                  tone="text-negative"
                />
                <ValueRow
                  label="Money lasts"
                  value={
                    untilYear == null
                      ? "Add birth year"
                      : stressed.runsOutYear
                        ? `Runs out at age ${stressed.runsOutYear - (plan.birthYear ?? 0)}`
                        : `To age ${plan.longevityAge}`
                  }
                  tone={untilYear == null ? "" : stressed.runsOutYear ? "text-negative" : "text-positive"}
                  bold
                />
                <ValueRow
                  label={`Left at age ${plan.longevityAge}`}
                  note={planEnd != null ? `Without the drop: ${formatMoneyWhole(Math.max(0, planEnd), currency)}` : undefined}
                  value={stressEnd == null ? "—" : formatMoneyWhole(Math.max(0, stressEnd), currency)}
                />
              </ul>
            </div>

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
              <ul className="mt-1.5 divide-y divide-line/60 text-sm sm:mx-auto sm:max-w-xl sm:text-lg">
                <li className="flex justify-between gap-3 py-1 max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
                  <span>Family income</span>
                  <span className="flex shrink-0">
                    <span className="w-[4.5rem] text-right sm:w-24">Monthly</span>
                    <span className="w-[5.75rem] text-right sm:w-28">Yearly</span>
                  </span>
                </li>
                {survivorYear.parts.map((part, i) => (
                  <IncomeRow
                    key={i}
                    label={part.name}
                    note={part.monthlyBeforeTaxCents !== part.monthlyAfterTaxCents ? "before tax" : undefined}
                    monthly={part.monthlyBeforeTaxCents}
                    yearly={part.monthlyBeforeTaxCents * 12}
                    currency={currency}
                  />
                ))}
                {plan.survivorExtras.benefits.map((b) => {
                  const monthly = Math.round(b.monthlyCents * inflateTo(deathYear, thisYear, plan.colaPct));
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
                  yearly={survivorYear.afterTaxMonthly * 12}
                  currency={currency}
                  tone="text-positive"
                  bold
                />
                <IncomeRow
                  label="Planned spending"
                  monthly={-survivorYear.spendMonthly}
                  yearly={-survivorYear.spendMonthly * 12}
                  currency={currency}
                />
                {(() => {
                  const net = survivorYear.afterTaxMonthly - survivorYear.spendMonthly;
                  return (
                    <IncomeRow
                      label={net >= 0 ? "Left to save" : "Gap from savings"}
                      monthly={Math.abs(net)}
                      yearly={Math.abs(net) * 12}
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
            </div>
          </div>

          <FiChart
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
        <PlanModal plan={plan} thisYear={thisYear} currency={currency} onClose={() => setEditing(false)} />
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
  fi,
  thisYear,
  birthYear,
  targetRetireYear,
  ssYear,
  projection,
  currency,
}: {
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
  const max = Math.max(1, ...fi.years.map((y) => Math.max(0, y.endCents)));
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
                className="group flex h-full flex-1 cursor-pointer items-end rounded-t-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
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
        {fi.runsOutYear != null ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2.5 rounded-[1px]" style={{ backgroundColor: "var(--negative)" }} />
            Money ran out
          </span>
        ) : null}
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
  endYear: string;
  taxable: boolean;
};

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
  onClose,
}: {
  plan: FiPlan;
  thisYear: number;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The retired-pay inputs are live so the estimate under them updates as
  // they're typed.
  const [retireYear, setRetireYear] = useState(plan.targetRetireYear?.toString() ?? "");
  const [serviceStart, setServiceStart] = useState(plan.serviceStartYear?.toString() ?? "");
  const [retireMonth, setRetireMonth] = useState(plan.targetRetireMonth?.toString() ?? "");
  const [serviceMonth, setServiceMonth] = useState(plan.serviceStartMonth?.toString() ?? "");
  const [high3, setHigh3] = useState(plan.high3MonthlyCents ? centsToDisplay(plan.high3MonthlyCents) : "");
  const [inflation, setInflation] = useState(String(plan.inflationPct));
  const [sbpEnabled, setSbpEnabled] = useState(plan.sbpEnabled);
  const [sbpPct, setSbpPct] = useState(String(plan.sbpPct));
  // Starts with one TRICARE Select row so the choice is visible; an empty
  // amount saves as $0.
  const [healthPlans, setHealthPlans] = useState<{ key: string; kind: HealthPlanKind; amount: string }[]>(() =>
    plan.healthPlans.length > 0
      ? plan.healthPlans.map((p, i) => ({
          key: `saved-${i}`,
          kind: p.kind,
          amount: p.annualCents ? centsToDisplay(p.annualCents) : "",
        }))
      : [{ key: "new-0", kind: "tricare_select", amount: "" }],
  );
  const updateHealthPlan = (key: string, patch: Partial<{ kind: HealthPlanKind; amount: string }>) =>
    setHealthPlans((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toYear = (v: string) => (/^\d{4}$/.test(v.trim()) ? Number(v) : null);
  const estimate = estimatePension(
    {
      retireYear: toYear(retireYear),
      retireMonth: retireMonth ? Number(retireMonth) : null,
      serviceStartYear: toYear(serviceStart),
      serviceStartMonth: serviceMonth ? Number(serviceMonth) : null,
      high3MonthlyCents: high3.trim() ? Math.round(Number(high3.replace(/[$,]/g, "")) * 100) || null : null,
      colaPct: plan.colaPct,
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
        endYear: "",
        taxable: kind !== "va",
      },
    ]);

  // onSubmit, not <form action>: a rejected save must keep what was typed.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("healthPlans", JSON.stringify(healthPlans.map(({ kind, amount }) => ({ kind, amount }))));
    formData.set(
      "incomeLines",
      JSON.stringify(
        lines.map((l) => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          monthly: l.monthly,
          startYear: l.startYear,
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

  return (
    <ModalShell
      title={
        // Capped on a phone so the title, Save and Close share one line.
        <span className="flex min-w-0 max-w-[calc(100vw-5.5rem)] items-center gap-2 text-base sm:max-w-none sm:gap-3 sm:text-lg">
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
        </span>
      }
      onClose={onClose}
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
          <input name="birthYear" inputMode="numeric" defaultValue={plan.birthYear ?? ""} className={inputClass} />
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
        <Field
          label="High-3 (/mo)"
          hint={`Add total amount expected from monthly Base Pay${toYear(retireYear) ? ` in ${toYear(retireYear)}` : ""}.`}
        >
          <input
            name="high3"
            inputMode="decimal"
            value={high3}
            onChange={(e) => setHigh3(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
        <Field
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
            <span className="font-semibold">Retired pay: {formatMoneyWhole(estimate.grossAtRetireCents, currency)}/mo</span>{" "}
            in {toYear(retireYear)}
            {estimate.sbpAtRetireCents > 0 ? `, minus ${formatMoneyWhole(estimate.sbpAtRetireCents, currency)} SBP` : ""}, before tax.
            {/* The same pay a year at a time — twelve of each monthly figure. */}
            <span className="block">
              <span className="font-semibold">Yearly: {formatMoneyWhole(estimate.grossAtRetireCents * 12, currency)}</span>
              {estimate.sbpAtRetireCents > 0 ? `, minus ${formatMoneyWhole(estimate.sbpAtRetireCents * 12, currency)} SBP` : ""}, before tax.
              {" "}Goes up by the COLA each year after.
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
          <span className="block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground">Health plan (/yr)</span>
          {healthPlans.length === 0 ? (
            <p className="text-xs text-foreground">No health plan premium before TRICARE For Life.</p>
          ) : null}
          {healthPlans.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3">
              <select
                value={row.kind}
                onChange={(e) => updateHealthPlan(row.key, { kind: e.target.value as HealthPlanKind })}
                aria-label="Health plan"
                className="w-40 cursor-pointer rounded-md bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:w-44"
              >
                <option value="tricare_prime">TRICARE Prime</option>
                <option value="tricare_select">TRICARE Select</option>
                <option value="private">Private insurance</option>
              </select>
              <input
                inputMode="decimal"
                value={row.amount}
                onChange={(e) => updateHealthPlan(row.key, { amount: e.target.value })}
                placeholder="0.00"
                aria-label="Premium per year"
                className="w-24 rounded-md bg-surface px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:w-28"
              />
              <button
                type="button"
                onClick={() => setHealthPlans((rows) => rows.filter((r) => r.key !== row.key))}
                aria-label="Remove health plan"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-negative/10 hover:text-negative"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <span className="basis-full text-xs leading-snug text-foreground sm:basis-0 sm:flex-1">
                {row.kind === "private"
                  ? "Private or employer plan premium, from the month you retire until TRICARE For Life starts."
                  : `Retiree ${row.kind === "tricare_prime" ? "TRICARE Prime" : "TRICARE Select"} enrollment fee, from the month you retire until TRICARE For Life starts.`}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setHealthPlans((rows) => [...rows, { key: `new-${Date.now()}`, kind: "private", amount: "" }])
            }
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-900/30"
          >
            + Add health plan
          </button>
        </div>
        <Field
          label="Dental & vision (/yr)"
          hint="From the month you retire. TRICARE For Life covers neither."
        >
          <input
            name="dentalVisionAnnual"
            inputMode="decimal"
            defaultValue={plan.dentalVisionAnnualCents ? centsToDisplay(plan.dentalVisionAnnualCents) : ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
        <Field
          label="TRICARE For Life (/yr)"
          hint="Your Medicare Part B premium. TFL itself has no fee."
        >
          <input
            name="healthcareAnnual"
            inputMode="decimal"
            defaultValue={plan.healthcareAnnualCents ? centsToDisplay(plan.healthcareAnnualCents) : ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
        <Field
          label="TFL starts at age"
          hint={
            <>
              At age 65, Medicare begins or adjust if earlier.{" "}
              <a
                href="https://www.tricare.mil/tfl"
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                Read about TRICARE For Life
              </a>
            </>
          }
        >
          <input name="healthcareStartAge" inputMode="numeric" defaultValue={plan.healthcareStartAge} className={inputClass} />
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
        <Field label="Expected COLA increase (%)" hint="The yearly raise on retired pay, VA, Social Security and other income.">
          <input name="colaPct" inputMode="decimal" defaultValue={plan.colaPct} className={inputClass} />
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
          Per month at current rates, before tax; goes up by the COLA each year. If an amount changes, type an End Year on the old line,
          then + Add income with the new amount starting the year after.
        </p>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background p-2 ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_6rem_4.5rem_4.5rem_auto]">
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
              <LineField label="First year">
                <input
                  inputMode="numeric"
                  value={l.startYear}
                  onChange={(e) => updateLine(l.key, { startYear: e.target.value })}
                  placeholder="Now"
                  className={`${lineInput} text-center`}
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

        <div className="sm:col-span-full flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? (
          <p className="sm:col-span-full text-sm font-medium text-negative">{error}</p>
        ) : null}
      </form>
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
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
        <span className="w-[4.5rem] text-right sm:w-24">{formatMoneyWhole(monthly, currency)}</span>
        <span className="w-[5.75rem] text-right sm:w-28">{formatMoneyWhole(yearly, currency)}</span>
      </span>
    </li>
  );
}


