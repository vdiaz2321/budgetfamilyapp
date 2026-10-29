"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { PctBox } from "@/components/pct-box";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, displayToCents, formatMoneyWhole } from "@/lib/money";
import { DEFAULT_TAX_PCT, GROUP_LABEL, groupAccountNames, type GroupKind, type StoredGroupYear, type YearOverrides } from "@/lib/account-groups";
import type { GroupSlot } from "@/lib/account-groups-load";
import {
  appendProjectionYears,
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
  /** "If you die first": the survivor spending % typed on this year (null =
   *  none), and the one in force — typed here or carried, 100% before any. */
  survivorPctTyped: number | null;
  survivorPct: number;
  /** The spending typed for the year. */
  baseSpendingCents: number;
  /** Debt payments no longer needed that year (debts paid off). */
  debtFreedCents: number;
  growthCents: number;
  /** Signed one-time effect on that year's close — a house, a car, a windfall. */
  oneOffCents: number;
  /** Expected contributions into savings / investments that year — tracking
   *  only, never part of EOY. Null = no estimate typed. */
  contributedCents: number | null;
  /** Taken out of the account groups that year — planned, required minimums
   *  and shortfall draws, before tax. Null on years the groups didn't run. */
  withdrawnCents: number | null;
  /** Tax on those withdrawals; already inside spendingCents. */
  withdrawalTaxCents: number;
  /** Planned contributions into the groups that year. */
  plannedAddCents: number | null;
  /** Each group's year, for the popup. */
  groups: StoredGroupYear[];
  /** Proj Contributed / Withdraw typed in the popup, as they apply this year. */
  groupOverrides: YearOverrides;
  /** The year's income by source (pay, retired pay, VA…). */
  incomeParts: { name: string; cents: number }[];
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
  /** Income, spending and debt come from the spreadsheet's yearly totals
   *  (Annual Overview's Breakdown), not the register. */
  actualFromSheet?: boolean;
  /** Debt payments recorded that year (Budget's debt categories). */
  actualDebtPaidCents: number | null;
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

// Frozen columns: on desktop Year + Age (+ Spouse Age); on a phone only Year,
// so the narrow screen keeps room for the money (Victor, 2026-10-19). Year has
// a fixed width so Age knows where to sit; the edge line goes on the last
// frozen column.
const pinYear = "sticky left-0 z-10 w-[3.75rem] min-w-[3.75rem] sm:w-[4.75rem] sm:min-w-[4.75rem] max-sm:shadow-[1px_0_0_0_var(--color-line)]";
const pinAge = "sm:sticky sm:left-[4.75rem] sm:z-10 sm:shadow-[1px_0_0_0_var(--color-line)]";
// With a spouse on the plan, Age gets a fixed width on desktop so Spouse Age
// can pin beside it and take over the edge line.
const pinAgeWithSpouse = "sm:w-[4.5rem] sm:min-w-[4.5rem] sm:shadow-none";
const pinSpouseAge = "sm:sticky sm:left-[9.25rem] sm:z-10 sm:shadow-[1px_0_0_0_var(--color-line)]";
// Opaque versions of the row's this-year wash and hover.
const pinNowBg = "bg-[var(--viz-sel)]";
// Fades at the same speed as the row, so the pinned cells don't change ahead of it.
const pinHover = "transition-colors group-hover:bg-sky-50 dark:group-hover:bg-[color-mix(in_srgb,var(--color-sky-950)_40%,var(--color-surface))]";

export function ProjectionSection({
  years,
  currency,
  thisYear,
  seed,
  militaryRetireYear,
  spouseBirthYear = null,
  groupSlots,
  currentNwCents,
  assumptions,
  details,
  onEditIncome,
}: {
  years: ProjectionYear[];
  currency: string;
  thisYear: number;
  seed: ProjectionSeed;
  militaryRetireYear: number | null;
  /** Spouse's birth year; null hides the Spouse Age column. */
  spouseBirthYear?: number | null;
  /** Today's accounts and the group each sits in — named under each group
   *  in the year popup. */
  groupSlots: GroupSlot[];
  /** Opens Edit Future Projections at Income; with no Pay line yet,
   *  one is started at the given yearly amount. */
  onEditIncome?: (suggestYearlyCents: number | null, onBack?: () => void) => void;
  /** Today's live net worth — the figure Accounts and the sidebar show. */
  currentNwCents: number;
  /** From the retirement plan: the Edit assumptions line that rebuilds this
   *  table, and the retirement details under it. */
  assumptions?: React.ReactNode;
  details?: React.ReactNode;
}) {
  // Open on a fresh login — the one section that starts expanded (Victor,
  // 2026-10-16); a fold is still remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-projection", () => ({ open: true }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  // The year-by-year table folds on its own, so Retirement details under it
  // is reachable without scrolling past it (Victor, 2026-10-15).
  const tableOpen = collapse.table === true;
  // The open year, by number: after a save the page sends fresh rows, and the
  // popup stays open showing them (Victor, 2026-10-17 — it used to close).
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const editing = editingYear == null ? null : years.find((y) => y.year === editingYear) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const current = years.find((y) => y.year === thisYear) ?? null;

  // Every figure is the plain dollar amount the plan works out — no
  // shrinking by inflation into "today's money". Victor removed that toggle
  // (2026-10-24): the table and the year popup showed different numbers for
  // the same year, and a deflated figure hides what the inputs really say.

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
  //
  // In January there is no finished month to take a pace from, and this
  // year's "actual" is only January's live balance — measured against the
  // whole year's plan it read as a large false "behind". So until the pace
  // exists, the card shows last year's close against last year's plan.
  const lastYear = years.find((y) => y.year === thisYear - 1) ?? null;
  const gap =
    forecast != null && current
      ? forecast - current.eoyCents
      : lastYear?.actualCents != null
        ? lastYear.actualCents - lastYear.eoyCents
        : null;
  const gapIsPace = forecast != null;
  const last = years.at(-1) ?? null;
  // The far-right card opens on age 80 on a fresh login (the plan's last year
  // if it never reaches 80); the age picker on it swaps in any future year
  // without opening the table (Victor, 2026-10-20). Remembered for the
  // session, like the folds.
  const pickYears = years.filter((y) => y.year >= thisYear && y.age != null);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  useEffect(() => {
    try {
      const saved = Number(window.sessionStorage.getItem("networth-card-year"));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setPickedYear(saved);
    } catch {
      // sessionStorage unavailable — the card just opens on age 80.
    }
  }, []);
  const pickYear = (year: number) => {
    setPickedYear(year);
    try {
      window.sessionStorage.setItem("networth-card-year", String(year));
    } catch {
      // Not remembered — fine.
    }
  };
  const target =
    years.find((y) => y.year === pickedYear) ?? years.find((y) => y.age === 80) ?? last;

  // Adding years rewrites the grid in one press, so it asks first — in an
  // in-app dialog rather than window.confirm(), which some browsers and every
  // embedded/preview frame silently answer "cancel" for.
  const [confirming, setConfirming] = useState<"add" | null>(null);

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

  if (years.length === 0) {
    return <ProjectionEmpty seed={seed} currency={currency} thisYear={thisYear} />;
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div className="px-4 py-3">
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
          <span className="text-sm font-semibold sm:text-lg">Current and Projected Net Worth</span>
        </button>

        {/* Now, this year's pace, and the end of the plan — each card says in
            a line what its number is. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {current ? (
            <Figure
              label={`${thisYear} Projected EOY NW`}
              value={formatMoneyWhole(current.eoyCents, currency)}
              tone="text-foreground"
              sub={
                <>
                  {/* "Current NW", not the month's name — matches the table's Current NW column. */}
                  {`Current NW: ${formatMoneyWhole(currentNwCents, currency)}`}
                  {/* How the latest month stands against this year's
                      projection: ahead reads Up in green, behind Down in red.
                      Its own line, apart from Current NW. */}
                  <span className="block">
                    <ChangePill up={currentNwCents >= current.eoyCents}>
                      {currentNwCents >= current.eoyCents ? "Up" : "Down"}: {formatMoneyWhole(Math.abs(currentNwCents - current.eoyCents), currency)}
                    </ChangePill>
                  </span>
                </>
              }
            />
          ) : null}
          {gap != null ? (
            <Figure
              label={gapIsPace ? `${thisYear} Forecasted NW` : `${thisYear - 1} actual`}
              value={formatMoneyWhole(gapIsPace ? forecast! : lastYear!.actualCents!, currency)}
              tone={gap >= 0 ? "text-positive" : "text-negative"}
              sub={
                gapIsPace ? (
                  <>
                    {/* Only the Up/Down figure carries the colour, like the card beside it. */}
                    <span className="block">
                      <ChangePill up={gap >= 0}>
                        {gap >= 0 ? "Up" : "Down"}: {formatMoneyWhole(Math.abs(gap), currency)}
                      </ChangePill>
                    </span>
                    <span className="block whitespace-nowrap">from Proj EOY NW</span>
                  </>
                ) : (
                  `${gap >= 0 ? "ahead of" : "behind"} projection by ${formatMoneyWhole(Math.abs(gap), currency)}`
                )
              }
              subClassName={gapIsPace ? undefined : `font-semibold ${gap >= 0 ? "text-positive" : "text-negative"}`}
            />
          ) : null}
          {target ? (
            <Figure
              label={`Net worth in ${target.year}`}
              value={formatMoneyWhole(target.eoyCents, currency)}
              tone=""
              style={{ color: "var(--viz-savings)" }}
              sub={
                <>
                  {target.age != null && pickYears.length > 1 ? (
                    <label className="inline-flex items-center gap-1">
                      Expected at age
                      <select
                        aria-label="Pick an age"
                        value={target.year}
                        onChange={(e) => pickYear(Number(e.target.value))}
                        className="cursor-pointer rounded-md bg-surface py-0.5 pl-1.5 pr-1 font-semibold text-foreground outline-none ring-1 ring-line focus:ring-brand"
                      >
                        {pickYears.map((y) => (
                          <option key={y.year} value={y.year}>
                            {y.age}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : target.age != null ? (
                    `Expected at age ${target.age}`
                  ) : (
                    "Expected"
                  )}
                </>
              }
              className="col-span-2 sm:col-span-1"
            />
          ) : null}
        </div>
      </div>

      {open ? (
        <>
          {/* Year by year's title row carries its buttons — Edit Future
              Projections and the money toggles — on the left beside the
              title, folded or open (Victor, 2026-10-18). */}
          {/* The whole row folds the table, like the other section rows — only
              its own buttons (Edit, the money toggles) do something else. */}
          <div
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button, select, a, input")) return;
              setCollapse((s) => ({ ...s, table: s.table !== true }));
            }}
            className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3"
          >
            <button
              type="button"
              onClick={() => setCollapse((s) => ({ ...s, table: s.table !== true }))}
              aria-expanded={tableOpen}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className={`h-3.5 w-3.5 shrink-0 text-foreground transition-transform ${tableOpen ? "" : "-rotate-90"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 7.5 10 12.5 15 7.5" />
              </svg>
              <span className="text-sm font-semibold sm:text-lg">Year by year</span>
            </button>
            {assumptions}
          </div>
          {tableOpen ? (
          <>
          {/* The grid scrolls in its own box so thirty years of projection
              don't push the rest of the page down — and sticky only works
              against a bounded height, which is what gives the header row
              somewhere to freeze. Boxed like the stat cards above it, so the
              header cards and the table read as one set. */}
          <div className="mx-4 overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1000px] text-sm sm:text-lg">
              <thead className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_0_var(--color-line)]">
                <tr className="max-sm:text-[12px] sm:text-base uppercase tracking-wide text-foreground">
                  {/* Year and Age stay pinned on the left so a row can be
                      read while scrolling across to the NW columns. */}
                  <th className={`${pinYear} bg-surface px-2.5 py-2 text-center font-semibold`}>Year</th>
                  <th className={`${pinAge} ${spouseBirthYear ? pinAgeWithSpouse : ""} bg-surface px-2.5 py-2 text-center font-semibold`}>Age</th>
                  {spouseBirthYear ? (
                    <th className={`${pinSpouseAge} bg-surface px-2.5 py-2 text-center font-semibold`}>Spouse<br />Age</th>
                  ) : null}
                  <th className="px-2.5 py-2 text-center font-semibold">Total<br />Income</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Total<br />Spending</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Diff Income -<br />Spending</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Contributed</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Withdraw</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Invested<br />Gains</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Current<br />NW</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Proj<br />EOY NW</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Diff Actual -<br />Proj NW</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => {
                  const diff = y.actualCents == null ? null : y.actualCents - y.eoyCents;
                  return (
                    <tr
                      key={y.year}
                      onClick={() => setEditingYear(y.year)}
                      className={`group cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-sky-50 dark:hover:bg-[color-mix(in_srgb,var(--color-sky-950)_40%,var(--color-surface))] ${
                        y.year === thisYear ? "bg-[var(--viz-sel)]" : ""
                      }`}
                    >
                      {/* Pinned cells need a solid fill or the scrolled
                          columns show through; it matches the row's wash. */}
                      <td className={`${pinYear} ${y.year === thisYear ? pinNowBg : "bg-surface"} ${pinHover} px-2.5 py-2 text-center font-semibold tabular-nums`}>
                        {y.year}
                      </td>
                      <td className={`${pinAge} ${spouseBirthYear ? pinAgeWithSpouse : ""} ${y.year === thisYear ? pinNowBg : "bg-surface"} ${pinHover} px-2.5 py-2 text-center font-semibold tabular-nums`}>
                        {y.age ?? "—"}
                      </td>
                      {spouseBirthYear ? (
                        <td className={`${pinSpouseAge} ${y.year === thisYear ? pinNowBg : "bg-surface"} ${pinHover} px-2.5 py-2 text-center font-semibold tabular-nums`}>
                          {y.year - spouseBirthYear}
                        </td>
                      ) : null}
                      {/* Plan on top, what actually happened underneath. */}
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {formatMoneyWhole(y.incomeCents, currency)}
                        {/* Before military retirement: the other income on top
                            of the typed pay. Income is gross — taxes are
                            budgeted as spending. */}
                        {/* Only the year in progress has typed pay; later
                            years are all income lines. */}
                        {(militaryRetireYear == null || y.year < militaryRetireYear) &&
                        y.incomeCents !== y.workIncomeCents &&
                        y.year === thisYear ? (
                          <span className="block whitespace-nowrap max-sm:text-[12px] sm:text-base font-normal text-foreground">
                            incl. {formatMoneyWhole(y.incomeCents - y.workIncomeCents, currency)} other
                          </span>
                        ) : null}
                        <Actual cents={y.actualIncomeCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums text-negative">
                        {formatMoneyWhole(y.spendingCents, currency)}
                        {y.spendingCents - y.baseSpendingCents + y.debtFreedCents - y.withdrawalTaxCents > 0 ? (
                          <span className="block whitespace-nowrap max-sm:text-[12px] sm:text-base font-normal text-foreground">
                            incl. {formatMoneyWhole(y.spendingCents - y.baseSpendingCents + y.debtFreedCents - y.withdrawalTaxCents, currency)} health
                          </span>
                        ) : null}
                        {/* Withdrawal tax stays in the figure; no "incl. … tax" line under it. */}
                        <Actual cents={y.actualSpendingCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      {/* The plan's saving for the year — income less
                          spending — with what actually reached savings and
                          investments underneath it. */}
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {/* Negative in retirement: the year's spending is coming
                            out of savings, so it reads as a draw, in red. */}
                        <span
                          className={y.incomeCents - y.spendingCents < 0 ? "text-negative" : "text-positive"}
                        >
                          {formatMoneyWhole(y.incomeCents - y.spendingCents, currency)}
                        </span>
                        {/* Logged income less logged spending — the same sum
                            as the column, so plan and actual compare like for
                            like. Contributed and Gains have their own columns
                            now (Victor, 2026-10-15). */}
                        {y.actualIncomeCents != null && y.actualSpendingCents != null ? (
                          <Actual
                            cents={y.actualIncomeCents - y.actualSpendingCents}
                            currency={currency}
                            row={y}
                            thisYear={thisYear}
                          />
                        ) : null}
                      </td>
                      {/* Est. Contributed from the year popup on top, what
                          Invest / Savings recorded underneath — same as the
                          popup's Contributed. */}
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {/* A typed estimate wins; otherwise what the account
                            groups plan to add that year. */}
                        {(y.contributedCents ?? (y.plannedAddCents || null)) == null ? (
                          <span className="text-foreground">—</span>
                        ) : (
                          <span className="text-foreground">
                            {formatMoneyWhole((y.contributedCents ?? y.plannedAddCents)!, currency)}
                          </span>
                        )}
                        <Actual cents={y.actualInvestedCents} currency={currency} row={y} thisYear={thisYear} always />
                      </td>
                      {/* Out of the account groups: planned, required minimums
                          and anything drawn to cover a shortfall. */}
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {y.withdrawnCents ? (
                          <span style={{ color: "var(--viz-spending)" }}>
                            {formatMoneyWhole(y.withdrawnCents, currency)}
                          </span>
                        ) : (
                          <span className="text-foreground">—</span>
                        )}
                      </td>
                      {/* Est. gains on top; underneath, the reviewed year-end
                          figure where it exists, else what the snapshots
                          measure so the running year isn't blank. */}
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        <span className={y.growthCents < 0 ? "text-negative" : "text-positive"}>
                          {formatMoneyWhole(y.growthCents, currency)}
                        </span>
                        <Actual
                          cents={y.actualGainsCents ?? y.runningGainsCents}
                          currency={currency}
                          row={y}
                          thisYear={thisYear}
                          always
                        />
                      </td>
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
                        {y.actualCents == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            {formatMoneyWhole(y.actualCents, currency)}
                            {y.inProgress ? (
                              <span className="block max-sm:text-[12px] sm:text-base font-normal text-foreground">
                                {/* Today's live net worth, as on Accounts. */}
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
                            className={`block max-sm:text-[12px] sm:text-base font-normal ${
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
                              className={`block whitespace-nowrap max-sm:text-[12px] sm:text-base font-normal ${
                                f >= y.eoyCents ? "text-positive" : "text-negative"
                              }`}
                            >
                              {/* Two lines on a phone, so the longer label
                                  doesn't push past the column's edge. */}
                              <span className="max-sm:block">Forecasted NW:</span> {formatMoneyWhole(f, currency)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-2.5 py-2 text-center font-semibold tabular-nums">
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

          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming("add")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-50 disabled:opacity-60 dark:hover:bg-sky-950/40"
              >
                {pending ? "Working…" : `Add 5 years${last ? ` (through ${last.year + 5})` : ""}`}
              </button>
            </div>
          </div>
          {error ? (
            <p className="px-4 pb-3 text-sm font-medium text-negative">{error}</p>
          ) : null}
          {!error && notice ? (
            <p className="px-4 pb-3 text-sm font-medium text-foreground">{notice}</p>
          ) : null}
          </>
          ) : null}
          {details}
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

      {editing ? (
        <YearModal
          row={editing}
          // The survivor % the year would carry if its own box were blank.
          carriedSurvivorPct={years.filter((y) => y.year < editing.year).at(-1)?.survivorPct ?? 100}
          currency={currency}
          thisYear={thisYear}
          militaryRetireYear={militaryRetireYear}
          groupSlots={groupSlots}
          onClose={() => setEditingYear(null)}
          onEditIncome={
            onEditIncome
              ? () => {
                  // Suggest this year's typed pay for a first Pay line.
                  const now = years.find((y) => y.year === thisYear);
                  // Closing Income brings this year's popup back.
                  const year = editing.year;
                  setEditingYear(null);
                  onEditIncome(now && now.workIncomeCents > 0 ? now.workIncomeCents : null, () => setEditingYear(year));
                }
              : undefined
          }
        />
      ) : null}
    </section>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Module scope, not inside ForecastBreakdown: a component declared during
// render is a new component every render, so React remounts its subtree.
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-semibold text-foreground">{label}:</span> {children}
    </p>
  );
}

function LeftOverBreakdown({ row, currency }: { row: ProjectionYear; currency: string }) {
  const $ = (cents: number) => formatMoneyWhole(Math.abs(cents), currency);
  const leftCents = (row.actualIncomeCents ?? 0) - (row.actualSpendingCents ?? 0);
  const contributedCents = row.actualInvestedCents ?? 0;
  const debtCents = row.actualDebtPaidCents ?? 0;
  // Whatever wasn't invested or paid on debt stayed in the bank — or, when
  // negative, came out of it.
  const cashCents = leftCents - contributedCents - debtCents;
  const savings = { color: "var(--viz-savings)" };
  return (
    <div className="sm:col-span-2 space-y-0.5 rounded-xl px-3 py-2 text-xs sm:text-sm tabular-nums text-foreground ring-1 ring-line">
      <Line label={row.inProgress ? "Left over so far" : "Left over"}>
        Income <span className="text-positive">{$(row.actualIncomeCents ?? 0)}</span> − Spending{" "}
        <span className="text-negative">{$(row.actualSpendingCents ?? 0)}</span> ={" "}
        <span className={`font-semibold ${leftCents < 0 ? "text-negative" : ""}`} style={leftCents < 0 ? undefined : savings}>
          {leftCents < 0 ? "−" : ""}
          {$(leftCents)}
        </span>
      </Line>
      <Line label="Where it went">
        Contributed <span style={savings}>{$(contributedCents)}</span> + Debt paid{" "}
        <span style={{ color: "var(--viz-debt)" }}>{$(debtCents)}</span>{" "}
        {cashCents < 0 ? "− Taken from bank " : "+ Left in bank "}
        <span className={cashCents < 0 ? "text-negative" : ""} style={cashCents < 0 ? undefined : savings}>
          {$(cashCents)}
        </span>
      </Line>
    </div>
  );
}

// Each account group's year: start, the plan's contributions and withdrawals
// (boxes — what you type there is what the plan runs on, carried into later
// years), what really went in and came out once the year is running, what it
// earned, where it ended. Withdrawals name any required minimum or shortfall
// draw under the box.
function GroupBreakdown({
  groups,
  overrides,
  slots,
  currency,
  year,
  thisYear,
}: {
  groups: StoredGroupYear[];
  overrides: YearOverrides;
  slots: GroupSlot[];
  currency: string;
  year: number;
  thisYear: number;
}) {
  const $ = (cents: number) => formatMoneyWhole(cents, currency);
  const isCurrent = year === thisYear;
  // Which of today's accounts each group holds, so "Roth retirement" reads
  // as Schwab, the Fidelity Roths and TSP Roth rather than a bare type.
  // An account named once when all of it sits in one group (Amex Savings, not
  // its four buckets); by bucket only when it's split (Fidelity, TSP).
  // Folded by default — Cash alone names seven accounts. Clicking a group's
  // name opens just that group (Victor, 2026-10-17).
  const [openKinds, setOpenKinds] = useState<GroupKind[]>([]);
  const toggleKind = (kind: GroupKind) =>
    setOpenKinds((list) => (list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]));
  const accountsIn = (kind: GroupKind) =>
    groupAccountNames(slots, (x) => x.group === kind);
  // Proj End, live as the Proj boxes are typed in (Victor, 2026-10-18).
  const [addEdit, setAddEdit] = useState<Partial<Record<GroupKind, string>>>({});
  const [pctEdit, setPctEdit] = useState<Partial<Record<GroupKind, string>>>({});
  const [retEdit, setRetEdit] = useState<Partial<Record<GroupKind, string>>>({});
  const [taxEdit, setTaxEdit] = useState<Partial<Record<GroupKind, string>>>({});
  // The figures each row's boxes start from — the same ones the rows show.
  const shownFor = (g: StoredGroupYear) => {
    const o = overrides[g.kind];
    return {
      addShown: o?.add ?? g.add,
      takePctShown:
        o?.takePct ?? (g.start > 0 && g.take - g.rmd > 0 ? Math.round(((g.take - g.rmd) / g.start) * 10000) / 100 : 0),
      // Rows saved before the rate was stored: read it back off the gain.
      rateShown: g.rate ?? o?.ret ?? (g.start > 0 ? Math.round((g.gain / g.start) * 10000) / 100 : null),
      taxShown: o?.tax ?? g.taxRate ?? DEFAULT_TAX_PCT[g.kind],
    };
  };
  // What's in each box right now: typed, else what it opened with.
  const liveFor = (g: StoredGroupYear) => {
    const { addShown, rateShown } = shownFor(g);
    const addText = addEdit[g.kind];
    const pctText = pctEdit[g.kind];
    const retText = retEdit[g.kind];
    const rate = retText == null ? rateShown : retText.trim() === "" ? rateShown : parseFloat(retText);
    return {
      addShown,
      add: addText == null ? addShown : displayToCents(addText.replace(/[^0-9.]/g, "") || "0"),
      take: (pctText == null ? g.take - g.rmd : g.start > 0 ? Math.round((g.start * (parseFloat(pctText) || 0)) / 100) : 0) + g.rmd,
      rateShown,
      rate: rate != null && Number.isFinite(rate) ? rate : null,
    };
  };
  // A future year's gain with the return typed right now.
  const gainOf = (g: StoredGroupYear) => {
    if (isCurrent) return g.gain;
    const { rate, rateShown } = liveFor(g);
    if (retEdit[g.kind] == null || rate == null || rateShown == null) return g.gain;
    return g.gain + Math.round((g.start * (rate - rateShown)) / 100);
  };
  // This year: Start + Proj Contributed − Withdraw + Start × the year's
  // return. Cash isn't projected — it moves with every paycheck and bill — so
  // it carries today's balance, keeping the total comparable with Current's.
  // A future year: the plan's End, moved by whatever the boxes change, so the
  // plan's own rules (Cash short, required draws) still count.
  const projEndOf = (g: StoredGroupYear): number => {
    const live = liveFor(g);
    if (isCurrent) {
      if (g.kind === "cash") return g.end;
      const gain = g.start > 0 && g.rate != null ? Math.round((g.start * g.rate) / 100) : 0;
      return g.start + live.add - live.take + gain;
    }
    return g.end + (live.add - live.addShown) - (live.take - g.take) + (gainOf(g) - g.gain);
  };
  const projEndTotal = groups.reduce((t, g) => t + projEndOf(g), 0);
  // A group's withdrawal with whatever percent is typed right now.
  const takeOf = (g: StoredGroupYear) => liveFor(g).take;
  const sum = (pick: (g: StoredGroupYear) => number) => groups.reduce((t, g) => t + pick(g), 0);
  const anyActual = groups.some((g) => g.actualAdd != null || g.actualTake != null);
  const cell = "px-1.25 py-1 text-center tabular-nums";
  // Pinned so the row's name stays in view while the table scrolls sideways
  // on a phone. Solid backgrounds, or the scrolled cells show through.
  const pin = "sticky left-0 z-10 text-left";
  const box =
    "mx-auto block w-20 rounded-md bg-surface px-1.5 py-1 text-center text-xs sm:text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
  // A percent box: narrower, with its "%" shown inside (see PctBox).
  const pctWrap = "mx-auto block w-16";
  const pctText = "text-xs sm:text-sm";
  // Where the box's figure came from: typed here, or carried from earlier.
  const source = (from: number | undefined) =>
    from == null ? null : (
      <span className="block text-[11px] text-foreground">{from === year ? "typed" : `from ${from}`}</span>
    );
  return (
    <div className="sm:col-span-2">
      <p className="border-t border-line pt-3 text-center max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
        By account group: {year}
      </p>
      <div className="mt-1 overflow-x-auto rounded-md ring-1 ring-line">
        <table className={`w-full text-xs sm:text-sm min-w-[980px]`}>
          <thead className="border-b border-line">
            <tr className="uppercase tracking-normal text-foreground">
              <th className={`${cell} ${pin} bg-surface font-semibold`}>Account Type</th>
              <th className={`${cell} font-semibold`}>Start</th>
              {/* What actually went in, then what the plan puts in (Victor, 2026-10-18). */}
              <th className={`${cell} font-semibold`}>Actual<br />Contributed</th>
              <th className={`${cell} font-semibold`}>Proj<br />Contributed</th>
              <th className={`${cell} font-semibold`}>Proj<br /><span className="whitespace-nowrap">Withdraw %</span></th>
              {/* Left to right: what went in, what it earned, what it's worth,
                  then what came out. This year that worth is today's balance;
                  a future year ends after its withdrawals. */}
              {/* A future year's gain is Start × the return; this year's is
                  measured from the balances, so it has no rate to type. */}
              {isCurrent ? null : <th className={`${cell} font-semibold`}>Proj<br /><span className="whitespace-nowrap">Return %</span></th>}
              {/* Tax on what each group pays out, typed per year like the
                  return (Victor, 2026-10-19). */}
              {isCurrent ? null : <th className={`${cell} font-semibold`}>Proj<br />Tax %</th>}
              <th className={`${cell} font-semibold`}>{isCurrent ? <>Actual<br />Gains</> : "Gains"}</th>
              {isCurrent ? <th className={`${cell} font-semibold`}>Current</th> : null}
              {isCurrent ? <th className={`${cell} font-semibold`}>Proj<br />End</th> : null}
              <th className={`${cell} font-semibold`}>Actual<br />Withdraw</th>
              {isCurrent ? null : <th className={`${cell} font-semibold`}>Proj<br />End</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const o = overrides[g.kind];
              const isCash = g.kind === "cash";
              // The withdrawal as a percent of the group's start: typed, else
              // what the group's own settings come to.
              const { addShown, takePctShown, rateShown: rate, taxShown } = shownFor(g);
              const pe = projEndOf(g);
              return (
                <Fragment key={g.kind}>
                <tr className="border-t border-line/60">
                  <td className={`${cell} ${pin} whitespace-nowrap bg-surface`}>
                    {accountsIn(g.kind).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleKind(g.kind)}
                        aria-expanded={openKinds.includes(g.kind)}
                        className="flex w-full items-start gap-1 rounded-md text-left font-semibold transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                      >
                        <svg
                          aria-hidden
                          viewBox="0 0 20 20"
                          className={`mt-1 h-3 w-3 shrink-0 transition-transform ${openKinds.includes(g.kind) ? "" : "-rotate-90"}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 7.5 10 12.5 15 7.5" />
                        </svg>
                        {GROUP_LABEL[g.kind]}
                      </button>
                    ) : (
                      <span className="block font-semibold">{GROUP_LABEL[g.kind]}</span>
                    )}
                  </td>
                  <td className={cell}>{$(g.start)}</td>
                  <td className={cell} style={g.actualAdd ? { color: "var(--viz-savings)" } : undefined}>
                    {g.actualAdd ? $(g.actualAdd) : "—"}
                  </td>
                  <td className={cell}>
                    {isCash ? (
                      "—"
                    ) : (
                      <>
                        <input type="hidden" name={`gaddWas_${g.kind}`} value={toWhole(addShown)} />
                        <input
                          name={`gadd_${g.kind}`}
                          inputMode="numeric"
                          aria-label={`${GROUP_LABEL[g.kind]} proj contributed`}
                          defaultValue={toWhole(addShown)}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            setAddEdit((m) => ({ ...m, [g.kind]: v }));
                          }}
                          className={box}
                          style={{ color: "var(--viz-savings)" }}
                        />
                        {source(o?.addFrom)}
                        {!isCurrent && o?.add != null && g.add < o.add ? (
                          <span className="block text-[11px] text-negative">{$(g.add)} fit — Cash short</span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className={cell}>
                    {isCash ? (
                      "—"
                    ) : (
                      <>
                        {/* A percent of the group's start, typed per group;
                            carries into later years, which show it with
                            "from 2027" (Victor, 2026-10-17). */}
                        <WithdrawPctBox
                          wrapClassName="mx-auto block w-20"
                          textClassName={pctText}
                          kind={g.kind}
                          startCents={g.start}
                          shown={takePctShown}
                          typed={o?.takePct != null}
                          className={box}
                          money={$}
                          onText={(v) => setPctEdit((m) => ({ ...m, [g.kind]: v }))}
                        />
                        {g.rmd > 0 ? <span className="block text-[11px] text-foreground">+{$(g.rmd)} required</span> : null}
                      </>
                    )}
                  </td>
                  {isCurrent ? null : (
                    <td className={cell}>
                      <input type="hidden" name={`gretWas_${g.kind}`} value={rate ?? ""} />
                      <PctBox value={retEdit[g.kind] ?? String(rate ?? "")} className={pctWrap} textClassName={pctText}>
                        <input
                          name={`gret_${g.kind}`}
                          inputMode="decimal"
                          aria-label={`${GROUP_LABEL[g.kind]} proj return %`}
                          defaultValue={rate ?? ""}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => {
                            const v = e.currentTarget.value.replace(/[%\s]/g, "");
                            setRetEdit((m) => ({ ...m, [g.kind]: v }));
                          }}
                          className={`${box} !w-full text-foreground`}
                        />
                      </PctBox>
                      {source(o?.retFrom)}
                    </td>
                  )}
                  {isCurrent ? null : (
                    <td className={cell}>
                      {isCash ? (
                        "—"
                      ) : (
                        <>
                          <input type="hidden" name={`gtaxWas_${g.kind}`} value={taxShown} />
                          <PctBox value={taxEdit[g.kind] ?? String(taxShown)} className={pctWrap} textClassName={pctText}>
                            <input
                              name={`gtax_${g.kind}`}
                              inputMode="decimal"
                              aria-label={`${GROUP_LABEL[g.kind]} tax on withdraw %`}
                              defaultValue={taxShown}
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) => {
                                const v = e.currentTarget.value.replace(/[%\s]/g, "");
                                setTaxEdit((m) => ({ ...m, [g.kind]: v }));
                              }}
                              className={`${box} !w-full text-foreground`}
                            />
                          </PctBox>
                          {source(o?.taxFrom)}
                        </>
                      )}
                    </td>
                  )}
                  <td className={`${cell} ${gainOf(g) < 0 ? "text-negative" : "text-positive"}`}>
                    {isCurrent && isCash ? <span className="text-foreground">—</span> : $(gainOf(g))}
                    {/* The sum behind a projected gain, in plain sight. */}
                    {!isCurrent && rate != null && g.start > 0 ? (
                      <span className="block whitespace-nowrap text-[11px] text-foreground">
                        {$(g.start)} × {liveFor(g).rate ?? rate}%
                      </span>
                    ) : null}
                  </td>
                  {isCurrent ? <td className={`${cell} font-semibold ${g.end < 0 ? "text-negative" : ""}`}>{$(g.end)}</td> : null}
                  {isCurrent ? <td className={`${cell} font-semibold ${pe < 0 ? "text-negative" : ""}`}>{$(pe)}</td> : null}
                  <td className={cell} style={g.actualTake ? { color: "var(--viz-spending)" } : undefined}>
                    {g.actualTake ? $(g.actualTake) : "—"}
                  </td>
                  {isCurrent ? null : <td className={`${cell} font-semibold ${pe < 0 ? "text-negative" : ""}`}>{$(pe)}</td>}
                </tr>
                {/* The group's accounts on one line across the whole table,
                    not stacked in the narrow name column. Pinned left so it
                    stays in view while a phone scrolls the table sideways. */}
                {openKinds.includes(g.kind) && accountsIn(g.kind).length > 0 ? (
                  <tr>
                    <td colSpan={10} className="px-2 pb-1.5 pt-0">
                      <span className="sticky left-2 block max-w-[calc(100vw-4rem)] pl-4 text-xs font-normal leading-snug text-foreground sm:max-w-none sm:text-sm">
                        {accountsIn(g.kind).join(" · ")}
                      </span>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
            <tr className="border-t border-line font-bold bg-sky-50 dark:bg-[color-mix(in_srgb,var(--color-sky-950)_40%,var(--color-surface))]">
              <td className={`${cell} ${pin} bg-sky-50 dark:bg-[color-mix(in_srgb,var(--color-sky-950)_40%,var(--color-surface))]`}>Total</td>
              <td className={cell}>{$(sum((g) => g.start))}</td>
              <td className={cell} style={anyActual ? { color: "var(--viz-savings)" } : undefined}>
                {anyActual ? $(sum((g) => g.actualAdd ?? 0)) : "—"}
              </td>
              <td className={cell} style={{ color: "var(--viz-savings)" }}>{$(sum((g) => g.add))}</td>
              {/* Only what the boxes withdraw — not what the plan sells on its own
                  to cover spending, which has no note here (Victor, 2026-10-17). */}
              <td className={cell} style={{ color: "var(--viz-spending)" }}>{$(sum(takeOf))}</td>
              {isCurrent ? null : <td className={cell} />}
              {isCurrent ? null : <td className={cell} />}
              <td className={`${cell} text-positive`}>{$(sum(gainOf))}</td>
              {isCurrent ? <td className={cell}>{$(sum((g) => g.end))}</td> : null}
              {isCurrent ? <td className={cell}>{$(projEndTotal)}</td> : null}
              <td className={cell} style={anyActual ? { color: "var(--viz-spending)" } : undefined}>
                {anyActual ? $(sum((g) => g.actualTake ?? 0)) : "—"}
              </td>
              {isCurrent ? null : <td className={cell}>{$(projEndTotal)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-foreground">
        {isCurrent
          ? "Actual = recorded so far this year. Proj End: Start + Proj Contributed − Withdraw + return; Cash = today's. A Proj figure typed here carries into later years."
          : "A Proj figure typed here carries into later years."}
      </p>
    </div>
  );
}

/**
 * One group's Proj Withdraw % box, with what it comes to worked out as you
 * type, on one line under it.
 */
function WithdrawPctBox({
  wrapClassName,
  textClassName,
  kind,
  startCents,
  shown,
  typed,
  className,
  money,
  onText,
}: {
  /** Sizes the box; its "%" sits inside (see PctBox). */
  wrapClassName: string;
  textClassName: string;
  kind: GroupKind;
  startCents: number;
  shown: number;
  /** A 0 that was typed shows as 0; an untouched one starts empty, so typing
   *  2 gives 2, not 02 (Victor, 2026-10-17). */
  typed: boolean;
  className: string;
  money: (cents: number) => string;
  /** Tells the table what's typed, so its Proj End moves as you type. */
  onText?: (text: string) => void;
}) {
  const [text, setText] = useState(shown === 0 && !typed ? "" : String(shown));
  const pct = parseFloat(text);
  const cents = Number.isFinite(pct) && pct > 0 && startCents > 0 ? Math.round((startCents * pct) / 100) : 0;
  return (
    <>
      <input type="hidden" name={`gtakepctWas_${kind}`} value={shown === 0 && !typed ? "" : shown} />
      <PctBox value={text} placeholder="0" className={wrapClassName} textClassName={textClassName} color="var(--viz-spending)">
        <input
          name={`gtakepct_${kind}`}
          inputMode="decimal"
          aria-label={`${GROUP_LABEL[kind]} proj withdraw %`}
          value={text}
          placeholder="0"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/%/g, "");
            setText(v);
            onText?.(v);
          }}
          className={`${className} !w-full`}
          style={{ color: "var(--viz-spending)" }}
        />
      </PctBox>
      {/* Just the amount (Victor, 2026-10-17 — no "from 2027"). */}
      {/* A year's withdrawal: the percent of the group's Start. */}
      {cents > 0 ? <span className="block whitespace-nowrap text-negative">{money(cents)}/yr</span> : null}
    </>
  );
}

function ForecastBreakdown({
  forecast: f,
  currency,
  planCents,
}: {
  forecast: YearForecast;
  currency: string;
  /** The year's Proj EOY NW — the forecast is green ahead of it, red behind. */
  planCents: number;
}) {
  const $ = (cents: number) => formatMoneyWhole(cents, currency);
  // Same colours as the rest of the popup: growth green, a fall or a cost red.
  const sign = (cents: number) => (cents < 0 ? "text-negative" : "text-positive");
  const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
  return (
    <Line label="Forecasted NW">
      {MONTH_NAMES[f.monthsDone - 1]} NW {$(f.monthEndCents)} + <span className={sign(f.perMonthCents)}>{$(f.perMonthCents)}</span> avg a
      month × {months(f.monthsLeft)}
      {f.travelCents > 0 ? (
        <>
          {" "}− <span className="text-negative">{$(f.travelCents)}</span> planned trips
        </>
      ) : null}{" "}
      ={" "}
      <span className={`font-semibold ${f.cents >= planCents ? "text-positive" : "text-negative"}`}>
        {$(f.cents)}
      </span>
    </Line>
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
            className="rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
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
  carriedSurvivorPct,
  currency,
  thisYear,
  militaryRetireYear,
  groupSlots,
  onClose,
  onEditIncome,
}: {
  row: ProjectionYear;
  carriedSurvivorPct: number;
  currency: string;
  thisYear: number;
  militaryRetireYear: number | null;
  groupSlots: GroupSlot[];
  onClose: () => void;
  onEditIncome?: () => void;
}) {
  // Future years' income comes only from Edit Future Projections, and
  // from the military retirement year on so does this one's — typed pay isn't
  // used. Future gains are the real return on the opening balance, figured
  // when the plan saves, so they aren't typed.
  const futureYear = row.year > thisYear;
  const retired = futureYear || (militaryRetireYear != null && row.year >= militaryRetireYear);
  const linesCents = row.incomeCents - (retired ? 0 : row.workIncomeCents);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // "Saved" on the button for a moment, since the popup now stays open.
  const [saved, setSaved] = useState(false);

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
  // Tax on the account groups' withdrawals rides on top too.
  const healthCents = row.spendingCents - row.baseSpendingCents + row.debtFreedCents - row.withdrawalTaxCents;
  const planAdjustCents = healthCents - row.debtFreedCents + row.withdrawalTaxCents;
  const [spending, setSpending] = useState(toWhole(row.baseSpendingCents));
  const [survivorPct, setSurvivorPct] = useState(row.survivorPctTyped == null ? "" : String(row.survivorPctTyped));
  const [gains, setGains] = useState(toWhole(row.growthCents));
  const [oneOff, setOneOff] = useState(row.oneOffCents ? toWhole(row.oneOffCents) : "");
  const [contributed, setContributed] = useState(row.contributedCents == null ? "" : toWhole(row.contributedCents));
  const contributedCents = contributed.trim() === "" ? null : displayToCents(contributed);
  const incomeCents = (retired ? 0 : displayToCents(income)) + linesCents;
  const spendingCents = displayToCents(spending) + planAdjustCents;
  const savedCents = incomeCents - spendingCents;
  // What Save would land this year on, from what is typed right now — the same
  // equation the server re-chains with. It read the STORED closing balance
  // before, so a box labelled "Predicted" answered with the figure you were in
  // the middle of replacing.
  // The box shows gains in whole dollars; left as shown, the exact figure
  // counts, so this matches the table's Proj EOY NW to the dollar.
  const gainsCents = gains === toWhole(row.growthCents) ? row.growthCents : displayToCents(gains);
  const predictedEoyCents =
    row.boyCents + savedCents + gainsCents + displayToCents(oneOff);

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
    <ModalShell
      title={
        // Capped on a phone so the title, Save and the X share one line — the
        // title wraps instead of pushing the X onto a row of its own.
        <span className="flex min-w-0 max-w-[calc(100vw-6rem)] items-center gap-2 py-0.5 sm:max-w-none sm:gap-3">
          <span className="min-w-0 whitespace-normal leading-tight sm:truncate">{`Year: ${row.year} EOY Net Worth`}</span>
          {/* Save at the top too, so a long popup needn't be scrolled to the
              end (Victor, 2026-10-17). Outside the <form>, so it points at it by id. */}
          <button
            type="submit"
            form="projection-year-form"
            disabled={pending}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : saved ? "Saved ✓" : "Save year"}
          </button>
          {/* A worded way out beside Save, not just the corner ✕. */}
          <button type="button" onClick={onClose} className="shrink-0 rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/15">
            Close
          </button>
        </span>
      }
      onClose={onClose}
      // Wider from lg up so the eight-column group table fits without a
      // sideways scroll on a desktop monitor.
      className="sm:max-w-4xl lg:max-w-6xl"
    >
      <form
        id="projection-year-form"
        action={(formData) =>
          start(async () => {
            const result = await saveProjectionYear(formData);
            if (result?.error) setError(result.error);
            // No router.refresh(): the action's revalidatePath already sends
            // the fresh page back with its reply, and a refresh on top fetched
            // the whole page a second time (~0.8s). The popup stays open on
            // the refreshed year.
            else {
              setError(null);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            }
          })
        }
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        <input type="hidden" name="year" value={row.year} />
        <input type="hidden" name="boy" value={centsToDisplay(row.boyCents)} />
        <input type="hidden" name="carryForward" value={fromActuals ? "0" : "1"} />
        {/* What the spending box opened with, so an untouched box keeps the
            year's typed amount instead of re-typing the inflated one. */}
        <input type="hidden" name="spendingWas" value={toWhole(row.baseSpendingCents)} />

        {/* Where the year stands, on top so it's read before any box is edited
            (Victor, 2026-09-28). */}
        {/* What the rest of the app recorded for this year — the figures to
            copy in at year end, shown where they are needed rather than on
            another page. */}
        <div className="sm:col-span-2 rounded-xl px-3 py-2 ring-1 ring-line">
          <p className="text-center max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
            {row.inProgress ? "Total Current Amounts From Pages" : `${row.year}: actual from other pages`}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-base sm:grid-cols-5 text-center">
            {/* The register's own figures, always — this panel reports, it
                doesn't offer. What may be copied into the boxes above is a
                narrower question (`measured`), and tying the two together
                blanked the "so far" lines for the year in progress, which is
                the year you most want them for. */}
            <Recorded label="Income" cents={row.actualIncomeCents} currency={currency} from={row.actualFromSheet ? "Annual Overview" : row.inProgress ? "Logged so far" : "Logged"} tone="income" estCents={incomeCents} />
            <Recorded
              label="Spending"
              cents={row.actualSpendingCents}
              currency={currency}
              from={row.actualFromSheet ? "Annual Overview" : `${row.inProgress ? "Logged so far" : "Logged"}${row.actualKidsCents ? " + 529s" : ""}`}
              tone="spending"
              estCents={spendingCents}
            />
            <Recorded
              label="Contributed"
              cents={row.actualInvestedCents}
              currency={currency}
              from="Invest / Savings"
              tone="savings"
              estCents={contributedCents}
            />
            {/* The reviewed year-end figure when it exists, else what the
                snapshots measure — and the source line says which, so a number
                that is still moving is never mistaken for a final one. */}
            <Recorded
              label="Gains"
              cents={row.actualGainsCents ?? row.runningGainsCents}
              currency={currency}
              from={row.actualGainsCents == null ? "From balances" : "Invest / Savings"}
              tone="gains"
              estCents={displayToCents(gains)}
            />
            {/* The two added together — the "Currently" figure under Saved /
                invested in the table, so it can be traced here. */}
            <Recorded
              label="Total"
              cents={(row.actualSavedCents ?? 0) + (row.actualGainsCents ?? row.runningGainsCents ?? 0) || null}
              currency={currency}
              from="Contributed + Gains"
              tone="savings"
              // Only once a contribution estimate exists — gains alone would
              // read as a huge "ahead".
              estCents={contributedCents == null ? null : contributedCents + displayToCents(gains)}
              className="col-span-2 sm:col-span-1"
            />
          </div>
        </div>

        {/* Where the year's money went, as two sums: what was left after
            spending, then where that went. Contributed sits INSIDE the left
            over, not on top of it — the popup only made that clear once it
            was written out (Victor, 2026-10-13). */}
        {row.actualIncomeCents != null && row.actualSpendingCents != null ? (
          <LeftOverBreakdown row={row} currency={currency} />
        ) : null}

        {/* Plan, measured, and the gap between them — read left to right, and
            measured against what is typed right now rather than what is
            stored, so the difference moves with the fields above. Label over
            value from sm up, so four columns don't wrap mid-figure; one line
            each on a phone, where they stack anyway. */}
        <div
          className={`sm:col-span-2 grid grid-cols-1 gap-1 text-xs sm:text-base sm:text-center ${
            forecastCents != null ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)]" : "sm:grid-cols-[repeat(2,minmax(0,1fr))_auto]"
          }`}
        >
          <p>
            <span className="text-foreground">
              {/* Two-line headers on desktop, like the table's; one line on a phone. */}
              {row.inProgress ? "Current " : "Actual "}<br className="max-sm:hidden" />{row.inProgress ? "NW: " : "net worth: "}
            </span>
            <span className="font-semibold text-foreground sm:block">
              {row.actualCents == null ? "—" : formatMoneyWhole(row.actualCents, currency)}
            </span>
          </p>
          <p>
            <span className="text-foreground">Proj <br className="max-sm:hidden" />EOY NW: </span>
            <span className="font-semibold text-foreground sm:block">
              {formatMoneyWhole(predictedEoyCents, currency)}
            </span>
          </p>
          <p>
            <span className="text-foreground sm:whitespace-nowrap">{row.inProgress ? "Diff Current NW - " : "Diff Actual NW - "}<br className="max-sm:hidden" />Proj EOY NW: </span>
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
          {/* The same forecast as the "Forecasted NW" card, coloured the same:
              green ahead of the plan, red behind it. */}
          {forecastCents != null ? (
            <p>
              <span className="text-foreground">Forecasted <br className="max-sm:hidden" />NW: </span>
              <span
                className={`font-semibold sm:block ${
                  forecastCents >= predictedEoyCents ? "text-positive" : "text-negative"
                }`}
              >
                {formatMoneyWhole(forecastCents, currency)}
              </span>
            </p>
          ) : null}
        </div>

        {/* The plan for the year, laid out as its own sum: start + income −
            spending + gains + one-off = Proj EOY NW. Every box shows whole
            dollars; the two calculated ones are locked, so there is only ever
            one way to change a number (Victor, 2026-09-28). */}
        <p className="sm:col-span-2 border-t border-line pt-3 text-center max-sm:text-[12px] sm:text-base font-semibold uppercase tracking-wide text-foreground">
          NW Estimated Projection: {row.year}
        </p>
        {/* Read left to right, top to bottom, as the sum itself:
            start + income − spending → saved, + gains + one-off → Proj EOY NW. */}
        {/* Top row in the same order as the panel above: income, spending,
            contributed, gains. */}
        <div className="sm:col-span-2 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-5">
          {/* Withdrawals are typed per group in the table below — no total
              box up here (Victor, 2026-10-17: it confused). Every label in this row on two lines from sm up, so the boxes
              sit level (Victor, 2026-10-17). */}
          <Field label={<>Start of NW:<br className="max-sm:hidden" />{row.year}</>}>
            <input
              value={formatMoneyWhole(row.boyCents, currency)}
              readOnly
              disabled
              className={`${inputClass} opacity-60`}
            />
          </Field>
          {retired ? (
            <Field label={<>Total<br className="max-sm:hidden" />Income</>}>
              <input type="hidden" name="income" value={income} />
              <input value={formatMoneyWhole(row.incomeCents, currency)} readOnly disabled className={`${inputClass} opacity-60 text-positive`} />
              {/* Set in one place for every year: this opens it. */}
              {onEditIncome ? (
                <button
                  type="button"
                  onClick={onEditIncome}
                  className={`mx-auto mt-1 block rounded-md px-2.5 py-1 text-xs font-semibold transition sm:text-sm ${
                    row.incomeCents > 0
                      ? "text-foreground ring-1 ring-line hover:ring-brand"
                      : "bg-brand text-white hover:bg-brand-strong"
                  }`}
                >
                  {row.incomeCents > 0 ? "Edit income" : "Add income"}
                </button>
              ) : null}
              {/* Where the income comes from, under its own box, one line per
                  source — so $0 is never a mystery (Victor, 2026-10-18). */}
              <span className="mt-1 block text-center text-xs leading-snug text-foreground sm:text-sm">
                {row.incomeParts.length > 0
                  ? row.incomeParts.map((p, i) => (
                      <span key={`${p.name}-${i}`} className="block">
                        {p.name} <span className="font-semibold text-positive tabular-nums">{formatMoneyWhole(p.cents, currency)}</span>
                      </span>
                    ))
                  : "None set yet"}
              </span>
            </Field>
          ) : (
            <Field
              label={<>Total<br className="max-sm:hidden" />Income</>}
              hint={linesCents > 0 ? `+${formatMoneyWhole(linesCents, currency)} other income` : undefined}
            >
              <input
                name="income"
                inputMode="numeric"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                className={`${inputClass} text-positive`}
              />
            </Field>
          )}
          <Field
            label={<>Total<br className="max-sm:hidden" />Spending</>}
            hint={
              // Short: "incl. $7,839 tax" (Victor, 2026-10-17 — long notes here
              // wrapped to three lines).
              [
                healthCents > 0 ? `incl. ${formatMoneyWhole(healthCents, currency)} health` : "",
                row.withdrawalTaxCents > 0 ? `incl. ${formatMoneyWhole(row.withdrawalTaxCents, currency)} tax` : "",
              ].filter(Boolean).join(" · ") || undefined
            }
          >
            <input
              name="spending"
              inputMode="numeric"
              value={spending}
              onChange={(e) => setSpending(e.target.value)}
              className={`${inputClass} text-negative`}
            />
          </Field>
          {/* Tracking only — moving money into investments doesn't change net
              worth, so it stays out of Proj EOY NW. */}
          <Field label={<>Est.<br className="max-sm:hidden" />Contributed</>}>
            <input
              name="contributed"
              inputMode="numeric"
              value={contributed}
              // Blank shows what the account groups plan to add — the same
              // figure the Year by year table's Contributed column shows.
              placeholder={row.plannedAddCents ? toWhole(row.plannedAddCents) : "0"}
              onChange={(e) => setContributed(e.target.value)}
              className={inputClass}
              style={{ color: "var(--viz-savings)" }}
            />
          </Field>
          <Field label={<>Est.<br className="max-sm:hidden" />Gains</>} hint={futureYear ? "Return on the start balance" : "Market growth"}>
            <input
              name="growth"
              inputMode="numeric"
              value={gains}
              readOnly={futureYear}
              onChange={(e) => setGains(e.target.value)}
              className={`${inputClass} ${futureYear ? "opacity-60" : ""} ${
                displayToCents(gains) < 0 ? "text-negative" : "text-positive"
              }`}
            />
          </Field>
        </div>
        <div className="sm:col-span-2 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-5">
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
          {/* The "If you die first" card spends this share of the year's Total
              Spending. Blank carries the last typed year's % (Victor,
              2026-10-19). */}
          <Field label="Survivor Spending">
            <PctBox value={survivorPct} placeholder={String(carriedSurvivorPct)} className="mx-auto block w-16 sm:w-20" textClassName="text-sm sm:text-base">
              <input
                name="survivorPct"
                inputMode="decimal"
                value={survivorPct}
                placeholder={String(carriedSurvivorPct)}
                onChange={(e) => setSurvivorPct(e.target.value)}
                className={`${smallInputClass} w-full`}
              />
            </PctBox>
          </Field>
          <Field label="Age">
            <input name="age" inputMode="numeric" defaultValue={row.age ?? ""} className={smallInputClass} />
          </Field>
          <Field label="Diff Income - Spending">
            <input
              value={formatMoneyWhole(savedCents, currency)}
              readOnly
              disabled
              className={`${inputClass} opacity-60 ${valueTone("savings", savedCents).className}`}
              style={valueTone("savings", savedCents).style}
            />
          </Field>
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
        <div className="sm:col-span-2 space-y-1 text-left text-xs sm:text-sm text-foreground">
          <p>
            <span className="font-semibold text-foreground">One-off:</span> extra money in (+) or
            out (−), {row.year} only — bonus, inheritance, closing costs.
          </p>
          <p>
            <span className="font-semibold text-foreground">Diff Income - Spending:</span>{" "}Total
            Income − Total Spending — what&apos;s left over.
          </p>
          <p>
            <span className="font-semibold text-foreground">Survivor Spending:</span> share of Total
            Spending if you die first. Blank uses the last year typed.
          </p>
        </div>

        {row.groups.length > 0 ? (
          <GroupBreakdown groups={row.groups} overrides={row.groupOverrides} slots={groupSlots} currency={currency} year={row.year} thisYear={thisYear} />
        ) : null}

        {/* The plan and the forecast worked out together, so neither is a
            black box — under the footnotes (Victor, 2026-09-29). Month-end
            figures, so the forecast only changes on the 1st. */}
        <div className="sm:col-span-2 space-y-0.5 rounded-xl px-3 py-2 text-xs sm:text-sm tabular-nums text-foreground ring-1 ring-line">
          <Line label="Proj EOY NW">Start of NW + Income - Spending + Est. Gains + One-off.</Line>
          {forecast ? <ForecastBreakdown forecast={forecast} currency={currency} planCents={predictedEoyCents} /> : null}
        </div>

        {/* Exactly what would change, before it changes. */}
        {preview ? (
          <div className="sm:col-span-2 rounded-xl px-3 py-2 ring-1 ring-line">
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
            <p className="mt-1 text-xs text-foreground">
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
                className="rounded-md px-3 py-1 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="sm:col-span-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : saved ? "Saved ✓" : "Save year"}
          </button>
          <button type="button" onClick={onClose} className="shrink-0 rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/15">
            Close
          </button>
          {hasMeasured && changes.length > 0 ? (
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
            >
              Use {row.year} actuals
            </button>
          ) : null}
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
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div className="px-4 py-3">
        <p className="text-sm font-semibold sm:text-lg">Current and Projected Net Worth</p>
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
            label="Diff Income - Spending"
            value={formatMoneyWhole(savedCents, currency)}
            sub="what's left over"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-foreground">
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
    <div className="rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
      <p className="max-sm:text-[12px] sm:text-sm font-semibold uppercase tracking-wide text-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      <p className="max-sm:text-[12px] sm:text-sm text-foreground">{sub}</p>
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
  always = false,
}: {
  cents: number | null;
  currency: string;
  row: ProjectionYear;
  thisYear: number;
  /** Label after the amount, e.g. "Saved"; replaces the "Currently:" / "actual" qualifier. */
  noun?: string;
  /** Skip the register-coverage check — for figures from Invest / Savings,
   *  which don't depend on how many months the register holds. */
  always?: boolean;
}) {
  if (!cents) return null;
  const running = row.year === thisYear;
  if (!always && !running && row.actualMonths < MIN_MONTHS_FOR_ACTUALS) return null;
  return (
    <span className="block whitespace-nowrap max-sm:text-[12px] sm:text-base font-normal text-foreground">
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
  tone,
  estCents,
}: {
  label: string;
  cents: number | null;
  currency: string;
  from: string;
  className?: string;
  /** Colours the figure the way the grid colours its column. */
  tone?: Tone;
  /** The estimate typed below — adds a "vs Est." line with the gap. */
  estCents?: number | null;
}) {
  const t = valueTone(tone, cents);
  // Over the estimate is good for income and contributions, bad for spending.
  const diff = estCents == null || cents == null ? null : cents - estCents;
  const good = diff != null && (tone === "spending" ? diff <= 0 : diff >= 0);
  return (
    <span className={`block ${className}`}>
      <span className="block max-sm:text-[12px] sm:text-sm font-semibold uppercase tracking-wide text-foreground">
        {label}
      </span>
      <span className={`block font-semibold tabular-nums ${t.className}`} style={t.style}>
        {cents ? formatMoneyWhole(cents, currency) : "—"}
      </span>
      <span className="block max-sm:text-[12px] sm:text-sm text-foreground">{from}</span>
      {diff != null ? (
        <span className="block max-sm:text-[12px] sm:text-sm text-foreground">
          vs Est.:{" "}
          <span className={`font-semibold tabular-nums ${good ? "text-positive" : "text-negative"}`}>
            {diff >= 0 ? "+" : "−"}
            {formatMoneyWhole(Math.abs(diff), currency)}
          </span>
        </span>
      ) : null}
    </span>
  );
}

// Money colours in the year popup: income and gains green, spending red,
// saved / invested blue — and anything negative red (a loss, or a draw on
// savings). Net worth stays plain.
type Tone = "income" | "gains" | "spending" | "savings";
function valueTone(tone: Tone | undefined, cents: number | null): { className: string; style?: React.CSSProperties } {
  if (!tone || !cents) return { className: "" };
  if (tone === "spending" || cents < 0) return { className: "text-negative" };
  if (tone === "income" || tone === "gains") return { className: "text-positive" };
  return { className: "", style: { color: "var(--viz-savings)" } };
}

const inputClass =
  "mx-auto block w-28 sm:w-32 rounded-md bg-surface px-2 py-1.5 text-center text-sm sm:text-base tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
// Boxes sized to what goes in them: six-figure dollars fit w-28, an age or a
// tax rate is two digits (Victor, 2026-09-28: full-width boxes for small
// values read as a form to fill, not a sum to check).
const smallInputClass = inputClass.replace("w-28 sm:w-32", "w-16 sm:w-20");

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
  label: React.ReactNode;
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
      <span className="mb-0.5 block max-sm:text-[12px] sm:text-[15px] font-semibold uppercase tracking-wide text-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className={`mt-0.5 block text-xs sm:text-sm ${hintTone ?? "text-foreground"}`}>{hint}</span>
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
  sub?: React.ReactNode;
  subClassName?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-surface px-3 py-2 text-center ring-1 ring-line ${className ?? ""}`}>
      {/* The number is sized like the Accounts page's summary cards
          (Victor, 2026-10-25); the label and lines stay readable. */}
      <p className="max-sm:text-[12px] sm:text-sm font-semibold uppercase leading-tight tracking-wide text-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-2xl font-bold tabular-nums sm:text-3xl xl:text-4xl ${tone}`} style={style}>
        {value}
      </p>
      {/* The phone keeps 12px; desktop steps up to 16px (Victor, 2026-10-18,
          again 2026-10-25 — the Accounts size read as tiny here). */}      {sub ? <p className={`max-sm:text-[12px] sm:text-base leading-snug ${subClassName ?? "text-foreground"}`}>{sub}</p> : null}
      {bar != null ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900/50">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, bar)) * 100)}%`, backgroundColor: "var(--viz-savings)" }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A gain or a fall as a small tinted pill — green up, red down — the one
 *  place the summary cards use colour beyond the number (Victor, 2026-10-25). */
function ChangePill({ up, children }: { up: boolean; children: React.ReactNode }) {
  const color = up ? "var(--positive)" : "var(--negative)";
  return (
    <span
      className="mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-semibold"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {children}
    </span>
  );
}
