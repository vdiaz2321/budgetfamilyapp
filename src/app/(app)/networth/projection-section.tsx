"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, displayToCents, formatMoneyWhole } from "@/lib/money";
import {
  appendProjectionYears,
  fillProjectionForward,
  saveProjectionYear,
  seedProjection,
} from "./actions";

export type ProjectionYear = {
  year: number;
  age: number | null;
  boyCents: number;
  /** Total take-home: pay (before military retirement) + income lines after tax. */
  incomeCents: number;
  /** The take-home pay typed for the year. Not used from the military
   *  retirement year on — retirement income comes from the income lines. */
  workIncomeCents: number;
  /** Tax on retirement income this year; null = the plan's default. */
  taxPct: number | null;
  /** Total spending: the typed spending + healthcare from the plan. */
  spendingCents: number;
  /** The spending typed for the year. */
  baseSpendingCents: number;
  /** Debt payments no longer needed that year (debts paid off). */
  debtFreedCents: number;
  growthCents: number;
  /** Signed one-time effect on that year's close — a house, a car, a windfall. */
  oneOffCents: number;
  eoyCents: number;
  /** Net worth actually recorded for that year, when there is one. */
  actualCents: number | null;
  /** Net worth actually recorded at the end of the year before — where this
   *  year really started. */
  startActualCents: number | null;
  /** What went into net-worth accounts that year — the Investments page's
   *  Contrib total. Kids' accounts are excluded, as they are from net worth. */
  actualSavedCents: number | null;
  /** Income received and money spent that year, as recorded. Null before the
   *  register has any category history for the year. */
  actualIncomeCents: number | null;
  actualSpendingCents: number | null;
  /** Deposits into the kids' 529s that year — already inside
   *  actualSpendingCents, since they leave net worth. */
  actualKidsCents: number | null;
  /** Months of that year the register actually covers. */
  actualMonths: number;
  /** Year-end investment gains entered on Invest / Savings. Independent of the
   *  register's month coverage, so it shows whenever it exists. */
  actualGainsCents: number | null;
  /** Gains measured from the snapshots — what investments are worth now, less
   *  last December, less what was paid in since. Available all year, unlike the
   *  typed figure above, and never used to close a year out. */
  runningGainsCents: number | null;
  /** Contributions into investment accounts that year, from Invest / Savings. */
  actualInvestedCents: number | null;
  /** True while the year is still running — its actual is only part-way. */
  inProgress: boolean;
  /** Planned-but-unpaid cost of trips still ahead this year (Travel's
   *  "Planned"). Zero for every other year. */
  upcomingTravelCents: number;
  /** Net worth at the close of the last finished month this year, and how
   *  many months are finished — what the forecast's pace is built on. */
  monthEndCents: number | null;
  monthsDone: number;
};

// Below this many recorded months, a year's income and spending totals say
// more about when the register started than about the year itself, so they are
// left off rather than shown as a total nobody should trust. The year in
// progress is exempt — it is legitimately partial, and says so.
const MIN_MONTHS_FOR_ACTUALS = 6;

/** What a first projection would be built from, all measured from the
 *  register over the last twelve complete months. */
export type ProjectionSeed = {
  boyCents: number;
  incomeCents: number;
  spendingCents: number;
  fromMonth: string;
  toMonth: string;
};

/** The real (today's-money) rates Fill forward types with. Shown in the
 *  confirmation so the button is never a black box, and edited in the FI
 *  section's NW Assumptions modal. */
export type ProjectionRates = {
  returnPct: number;
  incomeGrowthPct: number;
  spendingGrowthPct: number;
};

// "At current pace": this year's real net-worth growth so far, carried on at
// the same monthly rate for the months left. It replaced a forecast that added
// whatever the PLAN still had to save on top of today's balance — in September
// that assumed $27,792 would be saved in three months against a real pace near
// $2,000 a month, so it read far too high (Victor, 2026-09-28).
//
// Net worth already holds everything real: contributions, market gains, cash
// and debt paydown, with the kids' 529s left out. What it can't see is a trip
// planned for later in the year and not paid yet, so that plan comes off the
// end (Victor, 2026-09-29). One function for the card, the table row and the
// popup.
//
// Built on whole months — last month's close, over the months finished — so
// it holds still all month and moves on the 1st. Measured from today it
// drifted a few dollars every day, and the popup's worked sum could never
// match the figure beside it for long.
export type YearForecast = {
  cents: number;
  startCents: number;
  monthEndCents: number;
  monthsDone: number;
  monthsLeft: number;
  perMonthCents: number;
  travelCents: number;
};
function yearForecast(y: ProjectionYear, thisYear: number): YearForecast | null {
  // January has no finished month yet — nothing to take a pace from.
  if (y.year !== thisYear || y.monthEndCents == null || y.startActualCents == null || y.monthsDone < 1) {
    return null;
  }
  const monthsLeft = 12 - y.monthsDone;
  // Whole dollars throughout, so the sum written out in the popup adds up to
  // the dollar on a calculator.
  const whole = (cents: number) => Math.round(cents / 100) * 100;
  const perMonthCents = whole((y.monthEndCents - y.startActualCents) / y.monthsDone);
  return {
    cents: whole(y.monthEndCents) + perMonthCents * monthsLeft - whole(y.upcomingTravelCents),
    startCents: y.startActualCents,
    monthEndCents: y.monthEndCents,
    monthsDone: y.monthsDone,
    monthsLeft,
    perMonthCents,
    travelCents: y.upcomingTravelCents,
  };
}

export function ProjectionSection({
  years,
  currency,
  thisYear,
  seed,
  rates,
  militaryRetireYear,
  defaultTaxPct,
  currentNwCents,
}: {
  years: ProjectionYear[];
  currency: string;
  thisYear: number;
  seed: ProjectionSeed;
  rates: ProjectionRates;
  militaryRetireYear: number | null;
  defaultTaxPct: number;
  /** Today's net worth — the same figure as the Retirement Financial Planner's card. */
  currentNwCents: number;
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-projection", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  const [editing, setEditing] = useState<ProjectionYear | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const current = years.find((y) => y.year === thisYear) ?? null;

  const forecastFor = (y: ProjectionYear) => yearForecast(y, thisYear)?.cents ?? null;
  const forecast = current ? forecastFor(current) : null;
  // Where the year is heading against the plan.
  //
  // This measured the actual SO FAR against the plan for the whole year, which
  // in September compares nine months of living against twelve months of
  // planning — it read "behind by $6,633" while the forecast beside it was
  // $26k ahead and coloured green. Two figures, one year, opposite answers.
  // The honest comparison at any point mid-year is forecast against plan; once
  // the year closes there is no forecast left and the actual is the answer.
  const gap =
    forecast != null && current
      ? forecast - current.eoyCents
      : current?.actualCents != null
        ? current.actualCents - current.eoyCents
        : null;
  const gapIsPace = forecast != null;
  const last = years.at(-1) ?? null;

  // Adding years rewrites the grid in one press, so it asks first — in an
  // in-app dialog rather than window.confirm(), which some browsers and every
  // embedded/preview frame silently answer "cancel" for.
  const [confirming, setConfirming] = useState<"add" | "fill" | null>(null);

  // Tacks five more years onto the end, carrying the last planned year
  // forward.
  function addYears() {
    setConfirming(null);
    start(async () => {
      const result = await appendProjectionYears(5);
      if (result?.error) {
        setError(result.error);
        setNotice(null);
      } else {
        setError(null);
        setNotice(last ? `Added 5 years — the plan now runs to ${last.year + 5}.` : "Added 5 years.");
        router.refresh();
      }
    });
  }

  // Retypes every year after this one from the assumptions, in today's money:
  // gains become the real return on each year's opening balance instead of a
  // flat figure carried forward forever, which is what let the grid and the FI
  // chart quote different numbers for the same year.
  //
  // This year itself is the anchor and is never touched — it holds figures the
  // register can check.
  const fillFrom = years.some((y) => y.year === thisYear) ? thisYear : years[0]?.year ?? null;
  const fillableYears = fillFrom == null ? 0 : years.filter((y) => y.year > fillFrom).length;

  function fillForward() {
    setConfirming(null);
    if (fillFrom == null) return;
    start(async () => {
      const result = await fillProjectionForward(fillFrom!);
      if (result?.error) {
        setError(result.error);
        setNotice(null);
      } else {
        setError(null);
        setNotice(`Rebuilt ${fillableYears} ${fillableYears === 1 ? "year" : "years"} after ${fillFrom}.`);
        router.refresh();
      }
    });
  }

  if (years.length === 0) {
    return <ProjectionEmpty seed={seed} currency={currency} thisYear={thisYear} />;
  }

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-2 text-left"
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
          <span className="text-sm font-bold">Current and Projected Net Worth</span>
        </button>

        {/* Same treatment as the Retirement Financial Planner cards: the pace and how far
            ahead of the projection it is answer one question, so they share a card, and
            each card says in a line what its number is. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {current ? (
            <Figure
              label={`${thisYear} projected NW`}
              value={formatMoneyWhole(current.eoyCents, currency)}
              tone="text-foreground"
              sub={`Current NW: ${formatMoneyWhole(currentNwCents, currency)}`}
            />
          ) : null}
          {gap != null ? (
            <Figure
              label={gapIsPace ? `${thisYear} at current pace` : `${thisYear} actual`}
              value={formatMoneyWhole(gapIsPace ? forecast! : current!.actualCents!, currency)}
              tone={gap >= 0 ? "text-positive" : "text-negative"}
              sub={`${gap >= 0 ? "ahead of" : "behind"} projection by ${formatMoneyWhole(Math.abs(gap), currency)}`}
              subClassName={`font-semibold ${gap >= 0 ? "text-positive" : "text-negative"}`}
            />
          ) : null}
          {last ? (
            <Figure
              label={`Net worth in ${last.year}`}
              value={formatMoneyWhole(last.eoyCents, currency)}
              tone=""
              style={{ color: "var(--viz-savings)" }}
              sub={last.age != null ? `end of plan · age ${last.age}` : "end of plan"}
              className="col-span-2 sm:col-span-1"
            />
          ) : null}
        </div>
      </div>

      {open ? (
        <>
          {/* The grid scrolls in its own box so thirty years of projection
              don't push the rest of the page down — and sticky only works
              against a bounded height, which is what gives the header row
              somewhere to freeze. Boxed like the stat cards above it, so the
              header cards and the table read as one set. */}
          <div className="mx-4 overflow-hidden rounded-lg bg-background ring-1 ring-line sm:mx-6">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_var(--color-line)]">
                <tr className="text-[11px] uppercase tracking-wide text-foreground/75">
                  <th className="px-2.5 py-2 text-center font-semibold">Year</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Age</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Income</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Spending</th>
                  <th className="whitespace-nowrap px-2.5 py-2 text-center font-semibold">Saved / invested</th>
                  <th className="whitespace-nowrap px-2.5 py-2 text-center font-semibold">Actual NW</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Proj EOY NW</th>
                  <th className="whitespace-nowrap px-2.5 py-2 text-center font-semibold">Actual vs Proj NW</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => {
                  const diff = y.actualCents == null ? null : y.actualCents - y.eoyCents;
                  return (
                    <tr
                      key={y.year}
                      onClick={() => setEditing(y)}
                      className={`cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${
                        y.year === thisYear ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""
                      }`}
                    >
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {y.year}
                      </td>
                      <td className="px-2.5 py-2 text-center tabular-nums text-muted">
                        {y.age ?? "—"}
                      </td>
                      {/* Plan on top, what actually happened underneath. */}
                      <td className="px-2.5 py-2 text-center tabular-nums">
                        {formatMoneyWhole(y.incomeCents, currency)}
                        {/* Where the year's income comes from once the income
                            lines are paying, and the tax taken off them. */}
                        {militaryRetireYear != null && y.year >= militaryRetireYear ? (
                          <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/75">
                            after {y.taxPct ?? defaultTaxPct}% tax
                          </span>
                        ) : y.incomeCents !== y.workIncomeCents && y.year >= thisYear ? (
                          <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/75">
                            incl. {formatMoneyWhole(y.incomeCents - y.workIncomeCents, currency)} other
                          </span>
                        ) : null}
                        <Actual cents={y.actualIncomeCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      <td className="px-2.5 py-2 text-center tabular-nums text-negative">
                        {formatMoneyWhole(y.spendingCents, currency)}
                        {y.spendingCents - y.baseSpendingCents + y.debtFreedCents > 0 ? (
                          <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/75">
                            incl. {formatMoneyWhole(y.spendingCents - y.baseSpendingCents + y.debtFreedCents, currency)} health
                          </span>
                        ) : null}
                        <Actual cents={y.actualSpendingCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      {/* The plan's saving for the year — income less
                          spending — with what actually reached savings and
                          investments underneath it. */}
                      <td className="px-2.5 py-2 text-center tabular-nums">
                        {/* Negative in retirement: the year's spending is coming
                            out of savings, so it reads as a draw, in red. */}
                        <span
                          className={y.incomeCents - y.spendingCents < 0 ? "text-negative" : undefined}
                          style={y.incomeCents - y.spendingCents < 0 ? undefined : { color: "var(--viz-savings)" }}
                        >
                          {formatMoneyWhole(
                            y.incomeCents - y.spendingCents,
                            currency,
                          )}
                        </span>
                        {/* The year still running: what went in plus what the
                            market added, as one "Currently" total like the
                            Income and Spending cells beside it. The split is in
                            the year popup — two more lines here doubled the
                            row's height. */}
                        {y.year === thisYear ? (
                          (() => {
                            const banked = y.actualGainsCents ?? y.runningGainsCents ?? 0;
                            const total = (y.actualSavedCents ?? 0) + banked;
                            return total ? (
                              <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/75">
                                Currently: {formatMoneyWhole(total, currency)}
                              </span>
                            ) : null;
                          })()
                        ) : (
                          <>
                            <Actual
                              cents={y.actualSavedCents}
                              currency={currency}
                              row={y}
                              thisYear={thisYear}
                              noun="Contributed"
                            />
                            {/* Gains are the sheet's Growth row, measured. The
                                reviewed year-end figure from Invest / Savings wins
                                where it exists; while a year is still running the
                                snapshots stand in, so the column isn't blank for
                                most of the year in the row you look at most. */}
                            {(() => {
                              const banked = y.actualGainsCents ?? y.runningGainsCents;
                              if (!banked) return null;
                              return (
                                <span
                                  className={`block text-[11px] font-normal ${
                                    banked < 0 ? "text-negative" : "text-positive"
                                  }`}
                                >
                                  {banked < 0 ? "−" : "+"}
                                  {formatMoneyWhole(Math.abs(banked), currency)} Gains
                                </span>
                              );
                            })()}
                          </>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-center tabular-nums">
                        {y.actualCents == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            {formatMoneyWhole(y.actualCents, currency)}
                            {y.inProgress ? (
                              <span className="block text-[11px] font-normal text-foreground/75">
                                Currently
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {formatMoneyWhole(y.eoyCents, currency)}
                        {/* Named under the close it moved, rather than given a
                            ninth column — the grid already scrolls sideways on
                            a phone, and a one-off is rare enough that a column
                            of blanks would cost more than it tells. */}
                        {y.oneOffCents !== 0 ? (
                          <span
                            className={`block text-[11px] font-normal ${
                              y.oneOffCents < 0 ? "text-negative" : "text-positive"
                            }`}
                          >
                            {y.oneOffCents < 0 ? "−" : "+"}
                            {formatMoneyWhole(Math.abs(y.oneOffCents), currency)} one-off
                          </span>
                        ) : null}
                        {(() => {
                          const f = forecastFor(y);
                          return f == null ? null : (
                            <span
                              className={`block whitespace-nowrap text-[11px] font-normal ${
                                f >= y.eoyCents ? "text-positive" : "text-negative"
                              }`}
                            >
                              Forecast: {formatMoneyWhole(f, currency)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-2.5 py-2 text-center tabular-nums">
                        {diff == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={`font-semibold ${
                              diff >= 0 ? "text-positive" : "text-negative"
                            }`}
                          >
                            {diff >= 0 ? "+" : "−"}
                            {formatMoneyWhole(Math.abs(diff), currency)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              {fillFrom != null && fillableYears > 0 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming("fill")}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
                >
                  {pending ? "Working…" : `Fill forward from ${fillFrom}`}
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming("add")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
              >
                {pending ? "Working…" : `Add 5 years${last ? ` (through ${last.year + 5})` : ""}`}
              </button>
            </div>
          </div>
          {error ? (
            <p className="px-4 pb-3 text-sm font-medium text-negative sm:px-6">{error}</p>
          ) : null}
          {!error && notice ? (
            <p className="px-4 pb-3 text-sm font-medium text-muted sm:px-6">{notice}</p>
          ) : null}
        </>
      ) : null}

      {confirming === "add" ? (
        <ConfirmModal
          title="Add 5 years?"
          body={
            last
              ? `This extends the plan through ${last.year + 5}, carrying ${last.year}'s income and spending forward. Nothing already in the grid changes, and the new years can be edited afterwards.`
              : "This adds 5 more years to the end of the plan. Nothing already in the grid changes."
          }
          confirmLabel="Add 5 years"
          onConfirm={addYears}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      {confirming === "fill" ? (
        <ConfirmModal
          title={`Rebuild ${fillableYears} ${fillableYears === 1 ? "year" : "years"} after ${fillFrom}?`}
          body={
            `Every year after ${fillFrom} is retyped from your assumptions: gains become ${rates.returnPct}% of ` +
            `each year's opening balance, income drifts ${rates.incomeGrowthPct}% a year and spending ` +
            `${rates.spendingGrowthPct}% a year — all above inflation, because the grid is in today's money. ` +
            `${fillFrom} itself is left exactly as it is, and the shape of your later years is kept: their own ` +
            `income and spending are scaled, not replaced.` +
            // With any drift set, the scaling applies to the figures as they
            // stand right now — so pressing twice drifts them twice. At 0%
            // (the default) it is idempotent and there is nothing to warn
            // about, so the sentence only appears when it is actually true.
            (rates.incomeGrowthPct !== 0 || rates.spendingGrowthPct !== 0
              ? " Because the drift applies to the years as they stand now, pressing this twice applies it twice."
              : "") +
            ` This cannot be undone. Change the rates under Edit assumptions.`
          }
          confirmLabel="Fill forward"
          onConfirm={fillForward}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      {editing ? (
        <YearModal
          row={editing}
          currency={currency}
          thisYear={thisYear}
          militaryRetireYear={militaryRetireYear}
          defaultTaxPct={defaultTaxPct}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ForecastBreakdown({
  forecast: f,
  year,
  currency,
}: {
  forecast: YearForecast;
  year: number;
  currency: string;
}) {
  const $ = (cents: number) => formatMoneyWhole(cents, currency);
  const grown = f.monthEndCents - f.startCents;
  const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
  const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <p>
      <span className="font-semibold text-foreground">{label}:</span> {children}
    </p>
  );
  return (
    <div className="sm:col-span-2 space-y-0.5 rounded-md bg-black/5 px-3 py-2 text-xs tabular-nums text-foreground/80 dark:bg-white/10">
      <p className="pb-0.5 font-semibold text-foreground">
        Forecast breakdown and the &quot;at current pace&quot; card:
      </p>
      <Line label={`Start of ${year}`}>{$(f.startCents)}</Line>
      <Line label={`End of ${MONTH_NAMES[f.monthsDone - 1]}`}>
        {$(f.monthEndCents)} ({grown >= 0 ? "+" : "−"}
        {$(Math.abs(grown))} in {months(f.monthsDone)})
      </Line>
      <Line label="Pace">
        {$(f.perMonthCents)} a month
      </Line>
      <Line label="Forecast">
        {$(f.monthEndCents)} + {$(f.perMonthCents)} × {months(f.monthsLeft)}
        {f.travelCents > 0 ? ` − ${$(f.travelCents)} planned trips` : ""} ={" "}
        <span className="font-semibold text-foreground">{$(f.cents)}</span>
      </Line>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose} className="sm:max-w-md">
      {/* On phones this is a bottom sheet, so the action row has to clear the
          home indicator. */}
      <div className="px-5 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:pb-4">
        <p className="text-sm text-muted">{body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white transition ${
              destructive ? "bg-negative hover:opacity-90" : "bg-brand hover:opacity-90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function YearModal({
  row,
  currency,
  thisYear,
  militaryRetireYear,
  defaultTaxPct,
  onClose,
}: {
  row: ProjectionYear;
  currency: string;
  thisYear: number;
  militaryRetireYear: number | null;
  defaultTaxPct: number;
  onClose: () => void;
}) {
  // From the military retirement year on, income is the income lines (after
  // tax) and the typed pay isn't used. Future gains are the real return on the
  // opening balance, figured when the plan saves, so they aren't typed.
  const retired = militaryRetireYear != null && row.year >= militaryRetireYear;
  const futureYear = row.year > thisYear;
  const linesCents = row.incomeCents - (retired ? 0 : row.workIncomeCents);
  const [taxPct, setTaxPct] = useState(row.taxPct == null ? "" : String(row.taxPct));
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // What the rest of the app recorded for this year. Income and spending only
  // count once the register covers enough of the year to mean anything; gains
  // come from the year-end figures and are trustworthy whenever they exist.
  // A zero here means "nothing recorded yet", not "the answer is zero" — gains
  // are typed once a year, so mid-year they are simply absent. Offering to
  // replace a $4,000 estimate with $0 in March would be a trap, not a feature.
  //
  // The year still RUNNING offers neither income nor spending, however many
  // months are in. A nine-month total is not a twelve-month figure, and the
  // only thing to do with it in a row that means the whole year is get the row
  // wrong — in September it would have swapped a $130,000 income plan for
  // $97,130 of income-so-far. Its gains are still offered: those are typed
  // once, at year end, so a figure existing at all means it is final. The
  // "so far" lines under each box already say where the year stands.
  const canUseFlows = !row.inProgress && row.actualMonths >= MIN_MONTHS_FOR_ACTUALS;
  const measured = {
    income: canUseFlows ? row.actualIncomeCents || null : null,
    spending: canUseFlows ? row.actualSpendingCents || null : null,
    gains: row.actualGainsCents || null,
  };
  const hasMeasured = Object.values(measured).some((v) => v != null);

  // What pressing "use actuals" would change, so it can be read before it
  // happens rather than discovered afterwards.
  const [preview, setPreview] = useState(false);

  // How far the estimate turned out to be off, as one number. The per-field
  // arrows say what moved; this says whether the year as a whole came out
  // ahead of the plan or behind it, which is the only reason to look.
  //
  // It is the change to what the year ADDS to net worth — saved plus gains —
  // so an income miss cancelled by an equal spending miss correctly reads as
  // no miss at all.
  const plannedAddCents =
    row.incomeCents - row.spendingCents + row.growthCents + row.oneOffCents;
  const actualAddCents =
    (measured.income ?? row.incomeCents) -
    (measured.spending ?? row.spendingCents) +
    (measured.gains ?? row.growthCents) +
    row.oneOffCents;
  const missCents = actualAddCents - plannedAddCents;

  // Income and spending are the only two figures stored; what the year saves
  // is the difference between them and is shown, not typed. It used to be
  // typeable and back-solved onto spending, which meant the same number could
  // be reached two ways and neither box said which one it was.
  const [income, setIncome] = useState(toWhole(row.workIncomeCents));
  // The box edits the typed spending; healthcare from the plan rides on top.
  // Healthcare adds and paid-off debt subtracts; both come from the plan.
  const healthCents = row.spendingCents - row.baseSpendingCents + row.debtFreedCents;
  const planAdjustCents = healthCents - row.debtFreedCents;
  const [spending, setSpending] = useState(toWhole(row.baseSpendingCents));
  const [gains, setGains] = useState(toWhole(row.growthCents));
  const [oneOff, setOneOff] = useState(row.oneOffCents ? toWhole(row.oneOffCents) : "");
  const incomeCents = (retired ? 0 : displayToCents(income)) + linesCents;
  const spendingCents = displayToCents(spending) + planAdjustCents;
  const savedCents = incomeCents - spendingCents;
  // What Save would land this year on, from what is typed right now — the same
  // equation the server re-chains with. It read the STORED closing balance
  // before, so a box labelled "Predicted" answered with the figure you were in
  // the middle of replacing.
  const predictedEoyCents =
    row.boyCents + savedCents + displayToCents(gains) + displayToCents(oneOff);

  // Actual against what the boxes say right now, so the difference moves with
  // the fields above. Always coloured by sign — ahead of the projection or
  // behind it is the whole point of the figure, and a "close enough" grey band
  // hid exactly the small drifts worth watching.
  const liveDiffCents = row.actualCents == null ? null : row.actualCents - predictedEoyCents;
  const forecast = yearForecast(row, thisYear);
  const forecastCents = forecast?.cents ?? null;

  const changes = [
    { name: "income", label: "Income", from: row.incomeCents, to: measured.income },
    { name: "spending", label: "Spending", from: row.spendingCents, to: measured.spending },
    { name: "growth", label: "Est. gains", from: row.growthCents, to: measured.gains },
  ].filter((c) => c.to != null && c.to !== c.from);

  // Set once the boxes hold measured figures rather than estimates. It rides
  // along on the save as `carryForward=0`, which stops what one year actually
  // did from being written over every later year as a forecast.
  const [fromActuals, setFromActuals] = useState(false);

  // Fills the fields; still does not save. Closing a year takes two deliberate
  // presses: this one, then Save.
  function applyActuals() {
    if (measured.income != null) setIncome(toWhole(measured.income));
    if (measured.spending != null) setSpending(toWhole(measured.spending));
    if (measured.gains != null) setGains(toWhole(measured.gains));
    setFromActuals(true);
    setPreview(false);
  }

  return (
    <ModalShell title={`Year: ${row.year} EOY Net Worth`} onClose={onClose}>
      <form
        action={(formData) =>
          start(async () => {
            const result = await saveProjectionYear(formData);
            if (result?.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          })
        }
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        <input type="hidden" name="year" value={row.year} />
        <input type="hidden" name="boy" value={centsToDisplay(row.boyCents)} />
        <input type="hidden" name="carryForward" value={fromActuals ? "0" : "1"} />

        {/* Where the year stands, on top so it's read before any box is edited
            (Victor, 2026-09-28). */}
        {/* What the rest of the app recorded for this year — the figures to
            copy in at year end, shown where they are needed rather than on
            another page. */}
        <div className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
          <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
            {row.inProgress ? "Total Current Amounts From Pages" : `${row.year}: actual from other pages`}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5 text-center">
            {/* The register's own figures, always — this panel reports, it
                doesn't offer. What may be copied into the boxes above is a
                narrower question (`measured`), and tying the two together
                blanked the "so far" lines for the year in progress, which is
                the year you most want them for. */}
            <Recorded label="Income" cents={row.actualIncomeCents} currency={currency} from="Transactions" />
            <Recorded
              label="Spending"
              cents={row.actualSpendingCents}
              currency={currency}
              from={row.actualKidsCents ? "Transactions + 529s" : "Transactions"}
            />
            <Recorded
              label="Contributed"
              cents={row.actualInvestedCents}
              currency={currency}
              from="Invest / Savings"
            />
            {/* The reviewed year-end figure when it exists, else what the
                snapshots measure — and the source line says which, so a number
                that is still moving is never mistaken for a final one. */}
            <Recorded
              label="Gains"
              cents={row.actualGainsCents ?? row.runningGainsCents}
              currency={currency}
              from={row.actualGainsCents == null ? "From balances" : "Invest / Savings"}
            />
            {/* The two added together — the "Currently" figure under Saved /
                invested in the table, so it can be traced here. */}
            <Recorded
              label="Total"
              cents={(row.actualSavedCents ?? 0) + (row.actualGainsCents ?? row.runningGainsCents ?? 0) || null}
              currency={currency}
              from="Contributed + Gains"
              className="col-span-2 sm:col-span-1"
            />
          </div>
        </div>

        {/* Plan, measured, and the gap between them — read left to right, and
            measured against what is typed right now rather than what is
            stored, so the difference moves with the fields above. Label over
            value from sm up, so four columns don't wrap mid-figure; one line
            each on a phone, where they stack anyway. */}
        <div
          className={`sm:col-span-2 grid grid-cols-1 gap-1 text-xs sm:text-center ${
            forecastCents != null ? "sm:grid-cols-4" : "sm:grid-cols-3"
          }`}
        >
          <p>
            <span className="text-muted">Proj EOY NW: </span>
            <span className="font-semibold text-foreground sm:block">
              {formatMoneyWhole(predictedEoyCents, currency)}
            </span>
          </p>
          <p>
            <span className="text-muted">
              {row.inProgress ? "Current NW: " : "Actual net worth: "}
            </span>
            <span className="font-semibold text-foreground sm:block">
              {row.actualCents == null ? "—" : formatMoneyWhole(row.actualCents, currency)}
            </span>
          </p>
          {/* The same forecast as the "at current pace" card. */}
          {forecastCents != null ? (
            <p>
              <span className="text-muted">Forecast: </span>
              <span className="font-semibold text-foreground sm:block">
                {formatMoneyWhole(forecastCents, currency)}
              </span>
              {forecast && forecast.travelCents > 0 ? (
                <span className="text-muted sm:block">
                  {" "}after {formatMoneyWhole(forecast.travelCents, currency)} planned trips
                </span>
              ) : null}
            </p>
          ) : null}
          <p>
            <span className="text-muted">{row.inProgress ? "Current vs Proj NW: " : "Actual vs Proj NW: "}</span>
            {liveDiffCents == null ? (
              <span className="font-semibold text-foreground sm:block">—</span>
            ) : (
              <span
                className={`font-semibold sm:block ${
                  liveDiffCents >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {liveDiffCents >= 0 ? "+" : "−"}
                {formatMoneyWhole(Math.abs(liveDiffCents), currency)}
              </span>
            )}
          </p>
        </div>

        {/* The plan for the year, laid out as its own sum: start + income −
            spending + gains + one-off = Proj EOY NW. Every box shows whole
            dollars; the two calculated ones are locked, so there is only ever
            one way to change a number (Victor, 2026-09-28). */}
        <p className="sm:col-span-2 border-t border-line pt-3 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
          NW Estimated Projection: {row.year}
        </p>
        {/* Read left to right, top to bottom, as the sum itself:
            start + income − spending → saved, + gains + one-off → Proj EOY NW. */}
        <div className="sm:col-span-2 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          <Field label={`Start of NW: ${row.year}`}>
            <input
              value={formatMoneyWhole(row.boyCents, currency)}
              readOnly
              disabled
              className={`${inputClass} opacity-60`}
            />
          </Field>
          {retired ? (
            <Field label="Est. Income" hint="Retired pay + income lines">
              <input type="hidden" name="income" value={income} />
              <input value={formatMoneyWhole(row.incomeCents, currency)} readOnly disabled className={`${inputClass} opacity-60`} />
            </Field>
          ) : (
            <Field
              label="Est. Income"
              hint={linesCents > 0 ? `+${formatMoneyWhole(linesCents, currency)} other income` : undefined}
            >
              <input
                name="income"
                inputMode="numeric"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <Field
            label="Est. Spending"
            hint={
              [
                healthCents > 0 ? `+${formatMoneyWhole(healthCents, currency)} healthcare` : "",
              ].filter(Boolean).join(" · ") || undefined
            }
          >
            <input
              name="spending"
              inputMode="numeric"
              value={spending}
              onChange={(e) => setSpending(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Est. Saved / Invested">
            <input
              value={formatMoneyWhole(savedCents, currency)}
              readOnly
              disabled
              className={`${inputClass} opacity-60`}
            />
          </Field>
          <Field label="Est. gains" hint={futureYear ? "Return on the start balance" : "Market growth"}>
            <input
              name="growth"
              inputMode="numeric"
              value={gains}
              readOnly={futureYear}
              onChange={(e) => setGains(e.target.value)}
              className={`${inputClass} ${futureYear ? "opacity-60" : ""}`}
            />
          </Field>
          {/* Signed, and one number rather than a purchase model: the net
              effect on this year's close (a house ≈ minus closing costs). */}
          <Field label="One-off (+/−)">
            <input
              name="oneOff"
              inputMode="numeric"
              value={oneOff}
              placeholder="0"
              onChange={(e) => setOneOff(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Age">
            <input name="age" inputMode="numeric" defaultValue={row.age ?? ""} className={smallInputClass} />
          </Field>
          {/* Retirement tax only matters once retired pay starts; before that
              the box was a long note about a number the year doesn't use. It
              still rides along hidden so saving never clears it. */}
          {retired ? (
            <Field label="Tax %" hint={`Default ${defaultTaxPct}%. VA isn't taxed.`}>
              <input
                name="taxPct"
                inputMode="decimal"
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                placeholder={String(defaultTaxPct)}
                className={smallInputClass}
              />
            </Field>
          ) : (
            <input type="hidden" name="taxPct" value={taxPct} />
          )}
          <Field label="Proj EOY NW">
            <input
              value={formatMoneyWhole(predictedEoyCents, currency)}
              readOnly
              disabled
              className={`${inputClass} font-semibold opacity-80`}
            />
          </Field>


        </div>
        {/* Explained in full sentences under the boxes, where there's width for
            them — squeezed under a narrow box they wrapped into fragments
            ("House, car, windfall. This year only") that said nothing. */}
        <div className="sm:col-span-2 space-y-1 text-left text-xs text-foreground/80">
          <p>
            <span className="font-semibold text-foreground">One-off:</span> {row.year} only
            — bonus, inheritance, closing costs.
          </p>
          <p>
            <span className="font-semibold text-foreground">Proj EOY NW:</span> Auto-calculate
            from entries: Start of NW + Est. Income − Est. Spending + Est. Gains + One-off.
          </p>
        </div>

        {/* The forecast worked out, so it's never a black box — under the
            footnotes (Victor, 2026-09-29). Month-end figures, so it only
            changes on the 1st. */}
        {forecast ? (
          <ForecastBreakdown forecast={forecast} year={row.year} currency={currency} />
        ) : null}

        {/* Exactly what would change, before it changes. */}
        {preview ? (
          <div className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
            <p className="text-xs font-semibold">
              Replace your estimates for {row.year} with what was recorded?
            </p>
            <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
              {changes.map((c) => (
                <li key={c.name}>
                  <span className="text-muted">{c.label}: </span>
                  {formatMoneyWhole(c.from, currency)}
                  <span aria-hidden className="mx-1 text-muted">→</span>
                  <span className="font-semibold">{formatMoneyWhole(c.to ?? 0, currency)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 border-t border-line pt-1.5 text-xs tabular-nums">
              <span className="text-muted">
                {row.inProgress ? `${row.year} so far vs your estimate: ` : "You were off by: "}
              </span>
              <span
                className={`font-semibold ${missCents >= 0 ? "text-positive" : "text-negative"}`}
              >
                {missCents >= 0 ? "+" : "−"}
                {formatMoneyWhole(Math.abs(missCents), currency)}
              </span>
              <span className="text-muted">
                {" "}
                {missCents >= 0 ? "better than planned" : "short of plan"}
              </span>
            </p>
            <p className="mt-1 text-xs text-foreground/80">
              Nothing is saved until you press Save year. What actually happened
              in {row.year} stays in {row.year} — later years keep their own
              income and spending and only their balances re-chain.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={applyActuals}
                className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-strong"
              >
                Fill the fields
              </button>
              <button
                type="button"
                onClick={() => setPreview(false)}
                className="rounded-md px-3 py-1 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {hasMeasured && changes.length > 0 ? (
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="mr-auto rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              Use {row.year} actuals
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save year"}
          </button>
        </div>
        {error ? <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p> : null}
      </form>
    </ModalShell>
  );
}

// Nothing planned yet. This is the only place a projection can be started, so
// it has to do more than say "no data": it shows the twelve months the register
// already has and offers to turn them into a first draft.
function ProjectionEmpty({
  seed,
  currency,
  thisYear,
}: {
  seed: ProjectionSeed;
  currency: string;
  thisYear: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const savedCents = seed.incomeCents - seed.spendingCents;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-4 py-3 sm:px-6">
        <p className="text-sm font-bold">Current and Projected Net Worth</p>
        <p className="mt-1 text-xs text-muted">
          Where your net worth is heading, year by year, and how each year turns
          out against the plan. Start it from what you have already recorded —
          every figure stays editable, and changing a year carries the change
          forward.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SeedTile label="Starting balance" value={formatMoneyWhole(seed.boyCents, currency)} sub="net worth today" />
          <SeedTile label="Income / yr" value={formatMoneyWhole(seed.incomeCents, currency)} sub="last 12 months" />
          <SeedTile label="Spending / yr" value={formatMoneyWhole(seed.spendingCents, currency)} sub="last 12 months" />
          <SeedTile
            label="Saved / invested"
            value={formatMoneyWhole(savedCents, currency)}
            sub="income − spending"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-foreground/80">
            Measured from {seed.fromMonth} to {seed.toMonth}. Creates {thisYear}–
            {thisYear + 24}.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await seedProjection({
                  boyCents: seed.boyCents,
                  incomeCents: seed.incomeCents,
                  spendingCents: seed.spendingCents,
                });
                if (result?.error) setError(result.error);
                else router.refresh();
              })
            }
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Starting…" : "Start my projection"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm font-medium text-negative">{error}</p> : null}
      </div>
    </section>
  );
}

function SeedTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-foreground/75">{sub}</p>
    </div>
  );
}

// The measured figure under a planned one. Absent until the register has
// something to say about that year, and never a zero standing in for silence.
function Actual({
  cents,
  currency,
  row,
  thisYear,
  noun = "",
}: {
  cents: number | null;
  currency: string;
  row: ProjectionYear;
  thisYear: number;
  /** Label after the amount, e.g. "Saved"; replaces the "Currently:" / "actual" qualifier. */
  noun?: string;
}) {
  if (!cents) return null;
  const running = row.year === thisYear;
  if (!running && row.actualMonths < MIN_MONTHS_FOR_ACTUALS) return null;
  return (
    <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/75">
      {/* A named figure reads as "$21,208 Saved" — the Actual column beside it
          already says the year is still running, so "so far" only wrapped the
          cell onto extra lines. */}
      {noun
        ? `${formatMoneyWhole(cents, currency)} ${noun}`
        : running
          ? `Currently: ${formatMoneyWhole(cents, currency)}`
          : `${formatMoneyWhole(cents, currency)} actual`}
    </span>
  );
}

// One measured figure, with the page it came from — so it is obvious that this
// is a reading, not something to type into.
function Recorded({
  label,
  cents,
  currency,
  from,
  className = "",
}: {
  label: string;
  cents: number | null;
  currency: string;
  from: string;
  className?: string;
}) {
  return (
    <span className={`block ${className}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
        {label}
      </span>
      <span className="block font-semibold tabular-nums">
        {cents ? formatMoneyWhole(cents, currency) : "—"}
      </span>
      <span className="block text-[11px] text-foreground/75">{from}</span>
    </span>
  );
}

const inputClass =
  "mx-auto block w-28 rounded-md bg-background px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
// Boxes sized to what goes in them: six-figure dollars fit w-28, an age or a
// tax rate is two digits (Victor, 2026-09-28: full-width boxes for small
// values read as a form to fill, not a sum to check).
const smallInputClass = inputClass.replace("w-28", "w-16");

// Whole dollars with commas for the plan boxes — "130,000", not "130000.00".
// displayToCents strips the commas back out on save.
function toWhole(cents: number): string {
  return Math.round(cents / 100).toLocaleString("en-US");
}

function Field({
  label,
  hint,
  hintTone,
  className = "",
  children,
}: {
  label: string;
  /** Where the number comes from, when the box does not hold a figure of its
   *  own. Shown under the input, because a field that is calculated or locked
   *  has to say so on the screen — not on hover, which mobile never gets. */
  hint?: string;
  /** Overrides the hint colour when it is reporting a limit rather than
   *  explaining the field. */
  hintTone?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-center ${className}`}>
      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
        {label}
      </span>
      {children}
      {hint ? (
        <span className={`mt-0.5 block text-xs ${hintTone ?? "text-foreground/80"}`}>{hint}</span>
      ) : null}
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
  /** A short line under the value saying what it is. */
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
