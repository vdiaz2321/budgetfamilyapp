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
  projectFi,
  rentalForYear,
  rentalsForYear,
  type FiScheduleYear,
  type IncomeLine,
  type IncomeLineKind,
  type RentalProperty,
  type RentalRow,
} from "@/lib/retirement";
import { saveRetirementPlan } from "./actions";

export type FiPlan = {
  birthYear: number | null;
  targetRetireYear: number | null;
  annualSpendCents: number | null;
  annualContributionCents: number | null;
  realReturnPct: number;
  withdrawalRatePct: number;
  /** Spending drift above inflation, in real terms — 0 means "keeps pace". */
  spendingGrowthPct: number;
  /** Income drift above inflation, in real terms. */
  incomeGrowthPct: number;
  /** Pension + VA + Social Security per year, in today's money. */
  guaranteedIncomeCents: number | null;
  /** First year that income arrives; null means it already does. */
  guaranteedIncomeStartYear: number | null;
  /** Military retirement: service start, High-3 (retirement-year dollars). */
  serviceStartYear: number | null;
  high3MonthlyCents: number | null;
  inflationPct: number;
  sbpEnabled: boolean;
  sbpPct: number;
  /** Default tax on retirement income; a year in the table can override it. */
  retirementTaxPct: number;
  /** The age the plan runs to. */
  longevityAge: number;
  /** Yearly healthcare cost (today's dollars) from the start age, rising
   *  growthPct a year above inflation. */
  healthcareAnnualCents: number | null;
  healthcareStartAge: number;
  healthcareGrowthPct: number;
  incomeLines: IncomeLine[];
  /** Rentals as stored (for editing) and as the model reads them (linked
   *  Accounts balances already applied). */
  rentalRows: RentalRow[];
  rentals: RentalProperty[];
  /** What a rental can link to on Accounts. */
  propertyAccounts: { id: string; name: string; valueCents: number; loanCents: number | null }[];
};

export type FiMeasured = {
  /** Every asset on the Accounts page today (its Assets card: no kids
   *  accounts, no cards or loans) — cash and savings included. */
  assetsCents: number;
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
};

export function FiSection({
  plan,
  measured,
  currency,
  thisYear,
  projection,
}: {
  plan: FiPlan;
  measured: FiMeasured;
  currency: string;
  thisYear: number;
  /** Victor's year-by-year plan. When it has future years, they drive the
   *  spending and saving this section projects with. */
  projection: FiProjectionYear[];
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-fi", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  const [editing, setEditing] = useState(false);

  const portfolioCents = measured.assetsCents;

  // Military retired pay in today's dollars, from the DFAS High-3 formula.
  const pension = estimatePension(
    {
      retireYear: plan.targetRetireYear,
      serviceStartYear: plan.serviceStartYear,
      high3MonthlyCents: plan.high3MonthlyCents,
      inflationPct: plan.inflationPct,
      sbpEnabled: plan.sbpEnabled,
      sbpPct: plan.sbpPct,
    },
    thisYear,
  );
  const incomeIn = (year: number, taxPct: number | null) =>
    incomeForYear(year, pension, plan.targetRetireYear, plan.incomeLines, taxPct ?? plan.retirementTaxPct);
  const rentIn = (year: number, taxPct: number | null) =>
    rentalsForYear(plan.rentals, year, thisYear, plan.inflationPct, taxPct ?? plan.retirementTaxPct);

  // The Net Worth Plan table, read as today's money — which is what it holds
  // (round figures typed by hand: $90k while the kids are home, $45k once they
  // aren't). Its income already includes the retirement income lines after
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
            incomeIn(p.year, p.taxPct).guaranteedCents + Math.max(0, rentIn(p.year, p.taxPct).cashAfterTaxCents),
          // The table's own gains, so the chart can't drift from it (they
          // hold rental equity, which earns no investment return).
          growthCents: p.year > thisYear ? p.growthCents : undefined,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projection, thisYear, plan],
  );

  const usingGrid = schedule.length > 0;
  const contributionCents = measured.contributionCents;
  const untilYear = plan.birthYear ? plan.birthYear + plan.longevityAge : null;

  const fi = useMemo(
    () =>
      projectFi(
        {
          portfolioCents,
          annualContributionCents: measured.contributionCents,
          annualSpendCents: measured.spendCents,
          realReturnPct: plan.realReturnPct,
          withdrawalRatePct: plan.withdrawalRatePct,
          schedule,
          untilYear,
        },
        thisYear,
      ),
    [portfolioCents, measured.contributionCents, measured.spendCents, plan.realReturnPct, plan.withdrawalRatePct, schedule, untilYear, thisYear],
  );

  const fiAge = ageInYear(plan.birthYear, fi.fiYear ?? thisYear);
  // What the plan says about the military retirement year, when one is set.
  const atTarget = plan.targetRetireYear
    ? fi.years.find((y) => y.year === plan.targetRetireYear) ?? null
    : null;
  // The year the plan first crosses its target. Crossing today has no row in
  // fi.years (it starts next year), so today's figures stand in for it.
  const fiRow =
    fi.fiYear == null
      ? null
      : fi.years.find((y) => y.year === fi.fiYear) ?? {
          year: fi.fiYear,
          endCents: portfolioCents,
          targetCents: fi.fiNumberCents,
          spendCents: schedule.find((y) => y.year === fi.fiYear)?.spendCents ?? measured.spendCents,
          guaranteedCents: 0,
        };

  // What's left for the kids: net worth at 80 and at the plan-until age.
  const endAt = (age: number) =>
    plan.birthYear ? fi.years.find((y) => y.year === plan.birthYear! + age)?.endCents ?? null : null;
  const at80 = endAt(80);
  const atEnd = endAt(plan.longevityAge);
  const runsOutAge = fi.runsOutYear && plan.birthYear ? fi.runsOutYear - plan.birthYear : null;

  // Monthly income the first year of military retirement, by source.
  const retireIncome = (() => {
    if (!plan.targetRetireYear) return null;
    const tax = projection.find((p) => p.year === plan.targetRetireYear)?.taxPct ?? null;
    const base = incomeIn(plan.targetRetireYear, tax);
    const rent = rentIn(plan.targetRetireYear, tax);
    return {
      parts: [
        ...base.parts,
        ...rent.parts.map((r) => ({ name: `Rent: ${r.name}`, kind: "other" as const, monthlyAfterTaxCents: r.monthlyAfterTaxCents })),
      ],
      afterTaxCents: base.afterTaxCents + rent.cashAfterTaxCents,
    };
  })();
  const retireSpendMonthly = plan.targetRetireYear
    ? Math.round((projection.find((p) => p.year === plan.targetRetireYear)?.spendingCents ?? 0) / 12)
    : 0;
  const ssLine = plan.incomeLines.find((l) => l.kind === "social_security" && l.startYear != null) ?? null;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
          <span className="text-sm font-bold">Retirement Plan</span>
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* The two "today" facts live up here rather than in the body: they
              describe where he stands now, so they'd read as competing with
              the chart's per-year readout if they sat beside it. */}
          <Figure
            label="Current net worth"
            value={formatMoneyWhole(portfolioCents, currency)}
            tone="text-foreground"
          />
          {/* The goal and the year it's reached are one fact — the target
              and when you hit it — so they share a card. */}
          <Figure
            label="FI goal"
            value={formatMoneyWhole(fi.fiNumberCents, currency)}
            tone="text-foreground"
            sub={
              fi.fiYear
                ? `${fi.progress >= 1 ? "Reached" : "Expected"} ${fi.fiYear}${fiAge != null ? ` · age ${fiAge}` : ""}`
                : "Not expected on this plan"
            }
            subClassName={`font-semibold ${fi.fiYear ? "text-positive" : "text-negative"}`}
          />
          {/* Portfolio today ÷ FI number. */}
          <Figure
            label="Progress to FI"
            value={`${Math.round(fi.progress * 100)}%`}
            tone=""
            style={{ color: "var(--viz-savings)" }}
            bar={fi.progress}
          />
          {/* Portfolio today × withdrawal rate — what today's assets could pay
              out each year if he stopped working now. */}
          <Figure
            label="Income if you retired today"
            value={`${formatMoneyWhole(fi.sustainableSpendCents, currency)}/yr`}
            tone="text-foreground"
            sub={`Withdrawal ${plan.withdrawalRatePct}% of ${formatMoneyWhole(portfolioCents, currency)}/yr`}
          />
        </div>
      </div>

      {open ? (
        <div className="px-4 pb-4 sm:px-6">
          {/* One plain line of assumptions, then the two years that matter
              side by side. This used to be two long sentences, and because
              the plan spends more at retirement than at FI they quoted two
              different targets ($2.25M and $1.125M) with nothing saying why. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/80">
            <button
              type="button"
              onClick={() => setEditing(true)}
              // Soft blue from the viz palette (not brand indigo — no purple on data).
              className="rounded-md px-2 py-0.5 text-xs font-semibold ring-1 transition bg-[color-mix(in_srgb,var(--viz-savings)_12%,transparent)] text-[color-mix(in_srgb,var(--viz-savings)_80%,var(--foreground))] ring-[color-mix(in_srgb,var(--viz-savings)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--viz-savings)_22%,transparent)]"
            >
              Edit assumptions
            </button>
            <span>
              {plan.realReturnPct}% growth a year after inflation · withdraw {plan.withdrawalRatePct}% a year
              {" "}· {plan.retirementTaxPct}% tax on retirement income
              {usingGrid ? "" : ` · saving ${formatMoneyWhole(contributionCents, currency)} a year`}
              {" "}· in today&rsquo;s dollars
            </span>
          </p>

          {/* The three answers a retirement plan exists to give: does the
              money last, what's left for the kids, and what retirement pays. */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">Money lasts</p>
              {untilYear == null ? (
                <p className="mt-1 text-xs text-foreground/80">Add your birth year in Edit assumptions.</p>
              ) : runsOutAge != null ? (
                <>
                  <p className="mt-0.5 text-base font-bold text-negative">Runs out at age {runsOutAge}</p>
                  <p className="text-xs text-foreground/80">in {fi.runsOutYear} · plan runs to age {plan.longevityAge}</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-base font-bold text-positive">To age {plan.longevityAge}</p>
                  <p className="text-xs text-foreground/80">never runs out through {untilYear}</p>
                </>
              )}
            </div>
            <div className="rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">What is expected</p>
              {/* Stacked, not side by side: two seven-digit figures in one
                  row overlapped once the card got narrow. */}
              <div className="mx-auto mt-0.5 max-w-[14rem] space-y-0.5">
                {[
                  { age: 80, cents: at80 },
                  { age: plan.longevityAge, cents: atEnd },
                ].map((row) => (
                  <p key={row.age} className="flex items-baseline justify-between gap-2">
                    <span className="whitespace-nowrap text-xs text-foreground/80">at age {row.age}</span>
                    <span className="text-base font-bold tabular-nums">
                      {row.cents == null ? "—" : formatMoneyWhole(Math.max(0, row.cents), currency)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">Military retired pay</p>
              {pension ? (
                <>
                  <p className="mt-0.5 text-base font-bold tabular-nums">
                    {formatMoneyWhole(pension.grossAtRetireCents, currency)}/mo
                  </p>
                  <p className="text-xs text-foreground/80">
                    {pension.multiplierPct}% of High-3 · {plan.targetRetireYear} dollars ·{" "}
                    {formatMoneyWhole(pension.grossTodayCents, currency)} today
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-foreground/80">Add service start and High-3 in Edit assumptions.</p>
              )}
            </div>
          </div>

          {/* Monthly income the first year of military retirement, by source,
              against that year's monthly spending. */}
          {retireIncome && plan.targetRetireYear ? (
            <div className="mt-3 rounded-lg bg-background px-3 py-2 ring-1 ring-line">
              <p className="text-center text-sm font-bold">
                Monthly income in {plan.targetRetireYear}
                {plan.birthYear ? ` · age ${plan.targetRetireYear - plan.birthYear}` : ""}
                <span className="font-normal text-foreground/75"> · after tax, today&rsquo;s dollars</span>
              </p>
              {retireIncome.parts.length === 0 ? (
                <p className="mt-1 text-center text-xs text-foreground/80">No retirement income yet — add it in Edit assumptions.</p>
              ) : (
                <ul className="mt-1.5 divide-y divide-line/60 text-sm">
                  {retireIncome.parts.map((part) => (
                    <li key={part.name} className="flex justify-between gap-3 py-1">
                      <span className="min-w-0 truncate">{part.name}</span>
                      <span className="tabular-nums text-positive">{formatMoneyWhole(part.monthlyAfterTaxCents, currency)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 py-1 font-semibold">
                    <span>Total income</span>
                    <span className="tabular-nums">{formatMoneyWhole(Math.round(retireIncome.afterTaxCents / 12), currency)}</span>
                  </li>
                  <li className="flex justify-between gap-3 py-1">
                    <span>Spending (Net Worth Plan table)</span>
                    <span className="tabular-nums text-negative">{formatMoneyWhole(retireSpendMonthly, currency)}</span>
                  </li>
                  {(() => {
                    const net = Math.round(retireIncome.afterTaxCents / 12) - retireSpendMonthly;
                    return (
                      <li className="flex justify-between gap-3 py-1 font-semibold">
                        <span>{net >= 0 ? "Left to save" : "Taken from savings"}</span>
                        <span className={`tabular-nums ${net >= 0 ? "text-positive" : "text-negative"}`}>
                          {formatMoneyWhole(Math.abs(net), currency)}
                        </span>
                      </li>
                    );
                  })()}
                </ul>
              )}
            </div>
          ) : null}

          <div className={`mt-3 grid gap-3 ${atTarget && atTarget.year !== fi.fiYear ? "sm:grid-cols-2" : ""}`}>
            {atTarget && atTarget.year !== fi.fiYear ? (
              <Milestone
                title={`Military retirement ${atTarget.year}${plan.birthYear ? ` · age ${atTarget.year - plan.birthYear}` : ""}`}
                haveCents={atTarget.endCents}
                needCents={atTarget.targetCents}
                spendCents={atTarget.spendCents}
                guaranteedCents={atTarget.guaranteedCents}
                currency={currency}
              />
            ) : null}
            {fiRow ? (
              <Milestone
                title={`Financially free ${fiRow.year}${fiAge != null ? ` · age ${fiAge}` : ""}`}
                haveCents={fiRow.endCents}
                needCents={fiRow.targetCents}
                spendCents={fiRow.spendCents}
                guaranteedCents={fiRow.guaranteedCents}
                currency={currency}
              />
            ) : (
              <p className="rounded-lg bg-background px-3 py-2 text-xs ring-1 ring-line">
                <span className="font-semibold text-negative">Not reached on this plan.</span>{" "}
                Save more or spend less in the Net Worth Plan table.
              </p>
            )}
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

      {editing ? (
        <PlanModal plan={plan} thisYear={thisYear} currency={currency} onClose={() => setEditing(false)} />
      ) : null}
    </section>
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
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-foreground/75"
              style={{ bottom: `${(v / max) * 100}%` }}
            >
              {axisMoney(v)}
            </span>
          ))}
        </div>

        <div className="relative h-40 min-w-0 flex-1">
          {gridlines.map((v) => (
            <span
              key={v}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${(v / max) * 100}%`, borderColor: "var(--viz-grid)" }}
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
                    height: y.endCents < 0 ? "4%" : `${Math.max(1, (y.endCents / max) * 100)}%`,
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
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed opacity-70"
              style={{ left: `${centreOf(targetIndex)}%`, borderColor: "var(--foreground)" }}
            >
              <span
                className={`absolute top-5 whitespace-nowrap rounded bg-surface/90 px-1 text-[11px] font-semibold ${
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
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dotted opacity-70"
              style={{ left: `${centreOf(ssIndex)}%`, borderColor: "var(--foreground)" }}
            >
              <span
                className={`absolute top-10 whitespace-nowrap rounded bg-surface/90 px-1 text-[11px] font-semibold ${
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
                className="absolute top-0 flex flex-col items-center whitespace-nowrap text-[11px] tabular-nums leading-tight text-foreground/75"
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
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground/75">
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
        <span>Tap a bar to see that year.</span>
      </div>
    </div>
  );
}

// One milestone year: what the portfolio is expected to hold, what that year's spending
// needs, and the gap or "enough".
function Milestone({
  title,
  haveCents,
  needCents,
  spendCents,
  guaranteedCents,
  currency,
}: {
  title: string;
  haveCents: number;
  needCents: number;
  spendCents: number;
  guaranteedCents: number;
  currency: string;
}) {
  const gap = needCents - haveCents;
  const label = "text-[11px] font-semibold uppercase leading-tight tracking-wide text-foreground/75";
  const value = "mt-0.5 truncate text-sm font-bold tabular-nums sm:text-base";
  return (
    <div className="rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line">
      <p className="text-sm font-bold">{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-1 sm:gap-2">
        <div className="min-w-0">
          <p className={label}>Expected</p>
          <p className={value}>{formatMoneyWhole(haveCents, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className={label}>Needed</p>
          <p className={value}>{formatMoneyWhole(needCents, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className={label}>{gap > 0 ? "Shortfall" : "Status"}</p>
          <p className={`${value} ${gap > 0 ? "text-negative" : "text-positive"}`}>
            {gap > 0 ? formatMoneyWhole(gap, currency) : "On track"}
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-foreground/80">
        to spend {formatMoneyWhole(spendCents, currency)} a year
        {guaranteedCents > 0 ? `, ${formatMoneyWhole(guaranteedCents, currency)} of it from guaranteed income` : ""}
      </p>
    </div>
  );
}

// Same label/number styling as the milestone and header cards.
function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-foreground/75">{label}</p>
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
  const [high3, setHigh3] = useState(plan.high3MonthlyCents ? centsToDisplay(plan.high3MonthlyCents) : "");
  const [inflation, setInflation] = useState(String(plan.inflationPct));
  const [sbpEnabled, setSbpEnabled] = useState(plan.sbpEnabled);
  const [sbpPct, setSbpPct] = useState(String(plan.sbpPct));

  const toYear = (v: string) => (/^\d{4}$/.test(v.trim()) ? Number(v) : null);
  const estimate = estimatePension(
    {
      retireYear: toYear(retireYear),
      serviceStartYear: toYear(serviceStart),
      high3MonthlyCents: high3.trim() ? Math.round(Number(high3.replace(/[$,]/g, "")) * 100) || null : null,
      inflationPct: Number(inflation) || 0,
      sbpEnabled,
      sbpPct: Number(sbpPct) || 0,
    },
    thisYear,
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
    const payMonthly = Math.round((12 * (model.monthlyRentCents - model.monthlyCostsCents) - y.cashFlowCents) / 12);
    const payThenMonthly = Math.round(payMonthly * Math.pow(1 + (Number(inflation) || 0) / 100, Math.max(0, first - thisYear)));
    return { first, cashMonthly: Math.round(y.cashFlowCents / 12), payMonthly, payThenMonthly, purchaseCash: y.purchaseCashCents, equity: y.equityEndCents };
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        name: DEFAULT_LINE_NAME.va,
        kind: "va",
        monthly: "",
        startYear: retireYear,
        endYear: "",
        taxable: false,
      },
    ]);

  // onSubmit, not <form action>: a rejected save must keep what was typed.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
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
    <ModalShell title="Retirement / FI Assumptions" onClose={onClose} className="sm:max-w-3xl">
      <form
        onSubmit={submit}
        className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        <h3 className={heading}>You</h3>
        <Field label="Birth year" hint="Used to show your age on the chart.">
          <input name="birthYear" inputMode="numeric" defaultValue={plan.birthYear ?? ""} className={inputClass} />
        </Field>
        <Field label="Plan until age" hint="How far the plan runs, and the last age shown under What is expected.">
          <input name="longevityAge" inputMode="numeric" defaultValue={plan.longevityAge} className={inputClass} />
        </Field>

        <h3 className={heading}>Military retirement</h3>
        <Field label="Military retirement year" hint="Active-duty pay stops and retired pay starts.">
          <input
            name="targetRetireYear"
            inputMode="numeric"
            value={retireYear}
            onChange={(e) => setRetireYear(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          label="Service start year"
          hint={
            estimate
              ? `${estimate.yearsOfService} years of service × 2.5% = ${estimate.multiplierPct}% of High-3.`
              : "Years of service × 2.5% sets your retired pay %."
          }
        >
          <input
            name="serviceStartYear"
            inputMode="numeric"
            value={serviceStart}
            onChange={(e) => setServiceStart(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          label="High-3 (/mo)"
          hint={`Average of your highest 36 months of base pay, in ${toYear(retireYear) ?? "retirement-year"} dollars.`}
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
        <Field label="SBP (Survivor Benefit Plan)" hint="Tick if you elect it. The rate comes off gross retired pay, before tax.">
          <span className="flex w-28 items-center gap-2">
            <input
              type="checkbox"
              name="sbpEnabled"
              checked={sbpEnabled}
              onChange={(e) => setSbpEnabled(e.target.checked)}
              className="size-4 cursor-pointer accent-[color:var(--brand)]"
              aria-label="Elect SBP"
            />
            <input
              name="sbpPct"
              inputMode="decimal"
              value={sbpPct}
              onChange={(e) => setSbpPct(e.target.value)}
              disabled={!sbpEnabled}
              aria-label="SBP rate %"
              className="w-full min-w-0 rounded-md bg-background px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            />
            <span className="text-sm">%</span>
          </span>
        </Field>
        {estimate ? (
          <p className="rounded-md bg-background px-3 py-2 text-sm ring-1 ring-line sm:col-span-2">
            <span className="font-semibold">Retired pay: {formatMoneyWhole(estimate.grossAtRetireCents, currency)}/mo</span>{" "}
            in {toYear(retireYear)} dollars ={" "}
            <span className="font-semibold">{formatMoneyWhole(estimate.grossTodayCents, currency)}/mo</span>{" "}
            in today&rsquo;s dollars
            {estimate.sbpTodayCents > 0 ? `, minus ${formatMoneyWhole(estimate.sbpTodayCents, currency)} SBP` : ""}, before tax.
          </p>
        ) : null}

        <h3 className={heading}>Healthcare in retirement</h3>
        <Field label="Healthcare (/yr)" hint="Premiums, dental, vision and out-of-pocket for the family, in today's dollars. Added to that year's spending.">
          <input
            name="healthcareAnnual"
            inputMode="decimal"
            defaultValue={plan.healthcareAnnualCents ? centsToDisplay(plan.healthcareAnnualCents) : ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
        <Field label="Starts at age" hint="65 is when Medicare begins. Use an earlier age if costs start at military retirement.">
          <input name="healthcareStartAge" inputMode="numeric" defaultValue={plan.healthcareStartAge} className={inputClass} />
        </Field>
        <Field label="Rises above inflation (%/yr)" hint="Medical costs grow faster than prices overall. 1.5% = medical inflation of about 4%.">
          <input name="healthcareGrowthPct" inputMode="decimal" defaultValue={plan.healthcareGrowthPct} className={inputClass} />
        </Field>

        <h3 className={heading}>Rates</h3>
        <Field label="Real return (%)" hint="Yearly growth of your investments, after inflation.">
          <input name="realReturnPct" inputMode="decimal" defaultValue={plan.realReturnPct} className={inputClass} />
        </Field>
        <Field label="Withdrawal rate (%)" hint="Share of your savings you spend each year once retired. FI goal = yearly spending ÷ this rate.">
          <input name="withdrawalRatePct" inputMode="decimal" defaultValue={plan.withdrawalRatePct} className={inputClass} />
        </Field>
        <Field label="Inflation (%)" hint="Brings the High-3 back to today's dollars. Retired pay, VA and Social Security rise with it each year.">
          <input
            name="inflationPct"
            inputMode="decimal"
            value={inflation}
            onChange={(e) => setInflation(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Tax on retirement income (%)" hint="Default for every year. Change a single year in the Net Worth Plan table. VA is never taxed.">
          <input name="retirementTaxPct" inputMode="decimal" defaultValue={plan.retirementTaxPct} className={inputClass} />
        </Field>
        <Field label="Income growth (%/yr)" hint="Yearly raise above inflation. 0 = keeps pace. Used by Fill forward in the Net Worth Plan table.">
          <input name="incomeGrowthPct" inputMode="decimal" defaultValue={plan.incomeGrowthPct} className={inputClass} />
        </Field>
        <Field label="Spending growth (%/yr)" hint="Yearly spending rise above inflation. 0 = keeps pace. Used by Fill forward in the Net Worth Plan table.">
          <input name="personalInflationPct" inputMode="decimal" defaultValue={plan.spendingGrowthPct} className={inputClass} />
        </Field>

        <h3 className={heading}>Other income</h3>
        <p className="-mt-2 text-xs text-foreground/80 sm:col-span-2">
          Per month in today&rsquo;s dollars, before tax. For a VA rating change, end one line and start a new one that year.
        </p>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background p-2 ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_9.5rem_6rem_4.5rem_4.5rem_auto_auto]">
              <LineField label="Name" className="col-span-2 sm:col-span-1">
                <input
                  value={l.name}
                  onChange={(e) => updateLine(l.key, { name: e.target.value })}
                  className={lineInput}
                />
              </LineField>
              <LineField label="Type" className="col-span-2 sm:col-span-1">
                <select
                  value={l.kind}
                  onChange={(e) => {
                    const kind = e.target.value as IncomeLineKind;
                    const renamed = l.name === DEFAULT_LINE_NAME[l.kind] || !l.name.trim();
                    updateLine(l.key, {
                      kind,
                      taxable: kind !== "va",
                      ...(renamed ? { name: DEFAULT_LINE_NAME[kind] } : {}),
                    });
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
              <LineField label="Last year">
                <input
                  inputMode="numeric"
                  value={l.endYear}
                  onChange={(e) => updateLine(l.key, { endYear: e.target.value })}
                  placeholder="Life"
                  className={`${lineInput} text-center`}
                />
              </LineField>
              <label className="flex h-[34px] items-center gap-1.5 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={l.kind === "va" ? false : l.taxable}
                  disabled={l.kind === "va"}
                  onChange={(e) => updateLine(l.key, { taxable: e.target.checked })}
                  className="size-4 cursor-pointer accent-[color:var(--brand)] disabled:opacity-50"
                />
                Taxed
              </label>
              <button
                type="button"
                onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            + Add income
          </button>
        </div>

        <h3 className={heading}>Rental properties</h3>
        <p className="-mt-2 text-xs text-foreground/80 sm:col-span-2">
          Prices, rent and costs in today&rsquo;s dollars. Net rent counts as income (taxed when positive); equity
          (value − loan) counts toward net worth. Already own one? Add it on Accounts under Property, then pick it here.
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
                        <p className="col-span-2 self-center text-xs text-foreground/80">
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
                  className="h-[34px] rounded-md px-2 text-xs font-semibold text-negative ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Remove
                </button>
                <p className="col-span-2 text-xs text-foreground/80 sm:col-span-4">
                  {preview ? (
                    <>
                      {preview.first}:{" "}
                      <span className="font-semibold">
                        {preview.cashMonthly >= 0 ? "+" : "−"}
                        {formatMoneyWhole(Math.abs(preview.cashMonthly), currency)}/mo
                      </span>{" "}
                      after a {formatMoneyWhole(preview.payMonthly, currency)}/mo loan payment
                      {preview.payThenMonthly !== preview.payMonthly
                        ? ` (${formatMoneyWhole(preview.payThenMonthly, currency)} in ${preview.first} dollars)`
                        : ""}
                      {preview.purchaseCash > 0 ? ` · ${formatMoneyWhole(preview.purchaseCash, currency)} down + closing from savings` : ""}
                      {" "}· equity {formatMoneyWhole(preview.equity, currency)} by year end. Costs = taxes, insurance, management, repairs, vacancy. Value growth is above inflation.
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
            className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
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
      <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-foreground">{label}</span>
      {children}
    </label>
  );
}

// Sized to the longest value (80000.00), not the column — full-width boxes
// holding "5" or "1981" were mostly empty space.
const inputClass =
  "w-28 rounded-md bg-background px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

// Each field: bold title on top, then the box with its note beside it, so
// the note explains the box it sits next to.
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-foreground">{label}</span>
      <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
        {children}
        {hint ? <span className="text-xs leading-snug text-foreground/80">{hint}</span> : null}
      </span>
    </label>
  );
}

// A header stat as its own small card, the same look as the milestone cards
// under it, so the summary and the detail read as one set rather than a line
// of labels floating over a divider.
function Figure({
  label,
  value,
  tone,
  style,
  className,
  bar,
  sub,
  subClassName,
}: {
  label: string;
  value: string;
  tone: string;
  style?: React.CSSProperties;
  className?: string;
  /** 0–1: draws a thin progress bar under the value. */
  bar?: number;
  /** A short "how it's worked out" line under the value. */
  sub?: string;
  subClassName?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-background px-3 py-2 text-center ring-1 ring-line ${className ?? ""}`}>
      <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-foreground/75">{label}</p>
      <p className={`mt-0.5 truncate text-base font-bold tabular-nums ${tone}`} style={style}>
        {value}
      </p>
      {sub ? <p className={`text-[11px] leading-tight ${subClassName ?? "text-foreground/75"}`}>{sub}</p> : null}
      {bar != null ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, bar)) * 100)}%`, backgroundColor: "var(--viz-savings)" }}
          />
        </div>
      ) : null}
    </div>
  );
}

