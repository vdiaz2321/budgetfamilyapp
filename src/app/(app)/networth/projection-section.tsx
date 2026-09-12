"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, displayToCents, formatMoney } from "@/lib/money";
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
  incomeCents: number;
  spendingCents: number;
  growthCents: number;
  /** Signed one-time effect on that year's close — a house, a car, a windfall. */
  oneOffCents: number;
  eoyCents: number;
  /** Net worth actually recorded for that year, when there is one. */
  actualCents: number | null;
  /** What actually went into savings and investments that year, from the
   *  register — the same figure the Invest / Savings page counts. */
  actualSavedCents: number | null;
  /** Income received and money spent that year, as recorded. Null before the
   *  register has any category history for the year. */
  actualIncomeCents: number | null;
  actualSpendingCents: number | null;
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

export function ProjectionSection({
  years,
  currency,
  thisYear,
  seed,
  rates,
}: {
  years: ProjectionYear[];
  currency: string;
  thisYear: number;
  seed: ProjectionSeed;
  rates: ProjectionRates;
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

  // The year in progress is neither plan nor history: it is what has actually
  // happened so far plus whatever the estimate says is still to come. Once it
  // closes, the actual stands on its own and this disappears.
  const forecastFor = (y: ProjectionYear): number | null => {
    if (y.year !== thisYear || y.actualCents == null) return null;
    const estSaved = y.incomeCents - y.spendingCents;
    const savedLeft = Math.max(0, estSaved - (y.actualSavedCents ?? 0));
    // Gains already banked count against the estimate, measured ones included.
    // Before, only the typed year-end figure did — and that does not exist
    // until December, so all year the forecast added a full year of estimated
    // growth on top of an actual net worth that already held the real growth.
    const gainsSoFar = y.actualGainsCents ?? y.runningGainsCents ?? 0;
    const gainsLeft = Math.max(0, y.growthCents - gainsSoFar);
    return y.actualCents + savedLeft + gainsLeft;
  };
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
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
          <span className="text-sm font-bold">NW Projections</span>
        </button>

        {/* ml-auto, not just the row's justify-between: once the figures wrap
            onto their own line they start a fresh line and would sit hard
            left. This keeps them against the right edge either way. */}
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:ml-auto sm:justify-end">
          {current ? (
            <Figure
              label={`${thisYear} proj EOY NW`}
              value={formatMoney(current.eoyCents, currency)}
              tone="text-foreground"
            />
          ) : null}
          {forecast != null ? (
            <Figure
              label={`${thisYear} forecast`}
              value={formatMoney(forecast, currency)}
              tone={forecast >= (current?.eoyCents ?? 0) ? "text-positive" : "text-negative"}
            />
          ) : null}
          {gap != null ? (
            <Figure
              label={
                gapIsPace
                  ? gap >= 0
                    ? "On pace, ahead by"
                    : "On pace, behind by"
                  : gap >= 0
                    ? "Ahead by"
                    : "Behind by"
              }
              value={formatMoney(Math.abs(gap), currency)}
              tone={gap >= 0 ? "text-positive" : "text-negative"}
            />
          ) : null}
          {last ? (
            <Figure
              label={`By ${last.year}`}
              value={formatMoney(last.eoyCents, currency)}
              tone=""
              style={{ color: "var(--viz-savings)" }}
            />
          ) : null}
        </span>
      </div>

      {open ? (
        <>
          {/* The grid scrolls in its own box so thirty years of projection
              don't push the rest of the page down — and sticky only works
              against a bounded height, which is what gives the header row
              somewhere to freeze. */}
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_0_var(--color-line)]">
                <tr className="text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-center font-semibold">Year</th>
                  <th className="px-3 py-2 text-center font-semibold">Age</th>
                  <th className="px-3 py-2 text-center font-semibold">Income</th>
                  <th className="px-3 py-2 text-center font-semibold">Spending</th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">Saved / invested</th>
                  <th className="px-3 py-2 text-center font-semibold">Actual</th>
                  <th className="px-3 py-2 text-center font-semibold">Proj EOY NW</th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">Actual Diff</th>
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
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {y.year}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted">
                        {y.age ?? "—"}
                      </td>
                      {/* Plan on top, what actually happened underneath. */}
                      <td className="px-3 py-2 text-center tabular-nums">
                        {formatMoney(y.incomeCents, currency)}
                        <Actual cents={y.actualIncomeCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-negative">
                        {formatMoney(y.spendingCents, currency)}
                        <Actual cents={y.actualSpendingCents} currency={currency} row={y} thisYear={thisYear} />
                      </td>
                      {/* The plan's saving for the year — income less
                          spending — with what actually reached savings and
                          investments underneath it. */}
                      <td className="px-3 py-2 text-center tabular-nums">
                        <span style={{ color: "var(--viz-savings)" }}>
                          {formatMoney(
                            y.incomeCents - y.spendingCents,
                            currency,
                          )}
                        </span>
                        <Actual
                          cents={y.actualSavedCents}
                          currency={currency}
                          row={y}
                          thisYear={thisYear}
                          noun="saved"
                        />
                        {/* Gains are the sheet's Growth row, measured. The
                            reviewed year-end figure from Invest / Savings wins
                            where it exists; while a year is still running the
                            snapshots stand in, so the column isn't blank for
                            most of the year in the row you look at most. */}
                        {(() => {
                          const banked = y.actualGainsCents ?? y.runningGainsCents;
                          if (!banked) return null;
                          const measured = y.actualGainsCents == null;
                          return (
                            <span
                              className={`block text-[10px] font-normal ${
                                banked < 0 ? "text-negative" : "text-positive"
                              }`}
                            >
                              {banked < 0 ? "−" : "+"}
                              {formatMoney(Math.abs(banked), currency)} gains
                              {measured ? " so far" : ""}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {y.actualCents == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            {formatMoney(y.actualCents, currency)}
                            {y.inProgress ? (
                              <span className="block text-[10px] font-normal text-muted">
                                Actual so far
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {formatMoney(y.eoyCents, currency)}
                        {/* Named under the close it moved, rather than given a
                            ninth column — the grid already scrolls sideways on
                            a phone, and a one-off is rare enough that a column
                            of blanks would cost more than it tells. */}
                        {y.oneOffCents !== 0 ? (
                          <span
                            className={`block text-[10px] font-normal ${
                              y.oneOffCents < 0 ? "text-negative" : "text-positive"
                            }`}
                          >
                            {y.oneOffCents < 0 ? "−" : "+"}
                            {formatMoney(Math.abs(y.oneOffCents), currency)} one-off
                          </span>
                        ) : null}
                        {(() => {
                          const f = forecastFor(y);
                          return f == null ? null : (
                            <span
                              className={`block text-[10px] font-normal ${
                                f >= y.eoyCents ? "text-positive" : "text-negative"
                              }`}
                            >
                              {formatMoney(f, currency)} forecast
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {diff == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={`font-semibold ${
                              diff >= 0 ? "text-positive" : "text-negative"
                            }`}
                          >
                            {diff >= 0 ? "+" : "−"}
                            {formatMoney(Math.abs(diff), currency)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-6">
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
            ` This cannot be undone. Change the rates under NW Assumptions.`
          }
          confirmLabel="Fill forward"
          onConfirm={fillForward}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      {editing ? (
        <YearModal
          row={editing}
          isFirst={editing.year === years[0]?.year}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
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
  isFirst,
  currency,
  onClose,
}: {
  row: ProjectionYear;
  isFirst: boolean;
  currency: string;
  onClose: () => void;
}) {
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
  const [income, setIncome] = useState(centsToDisplay(row.incomeCents));
  const [spending, setSpending] = useState(centsToDisplay(row.spendingCents));
  const [gains, setGains] = useState(centsToDisplay(row.growthCents));
  const [oneOff, setOneOff] = useState(
    row.oneOffCents ? centsToDisplay(row.oneOffCents) : "",
  );
  const incomeCents = displayToCents(income);
  const spendingCents = displayToCents(spending);
  const savedCents = incomeCents - spendingCents;
  // What Save would land this year on, from what is typed right now — the same
  // equation the server re-chains with. It read the STORED closing balance
  // before, so a box labelled "Predicted" answered with the figure you were in
  // the middle of replacing.
  const predictedEoyCents =
    row.boyCents + savedCents + displayToCents(gains) + displayToCents(oneOff);

  // Planned EOY is arithmetic, not a stored column: opening balance + saved +
  // gains. Typing into it therefore has to land on one of those, and gains is
  // the only honest target — opening balance is last year's close, and income
  // and spending are figures you mean literally. So the box back-solves gains
  // and says so, rather than quietly redistributing across several fields the
  // way the old typeable "Saved" box did.
  //
  // While the box is being typed in it holds its own text (a half-typed
  // "37" isn't an EOY yet); it goes back to mirroring the equation on blur, or
  // as soon as another field moves the number.
  // Actual against what the boxes say right now, so the difference moves with
  // the fields above. Always coloured by sign — ahead of the projection or
  // behind it is the whole point of the figure, and a "close enough" grey band
  // hid exactly the small drifts worth watching.
  const liveDiffCents = row.actualCents == null ? null : row.actualCents - predictedEoyCents;

  const [eoyDraft, setEoyDraft] = useState<string | null>(null);
  // Gains can't go below zero (the server clamps them too), so this is the
  // lowest EOY reachable without changing income or spending.
  const floorEoyCents = row.boyCents + savedCents + displayToCents(oneOff);
  const eoyBelowFloor = eoyDraft != null && displayToCents(eoyDraft) < floorEoyCents;

  function editEoy(text: string) {
    setEoyDraft(text);
    setGains(centsToDisplay(Math.max(0, displayToCents(text) - floorEoyCents)));
  }
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
    if (measured.income != null) setIncome(centsToDisplay(measured.income));
    if (measured.spending != null) setSpending(centsToDisplay(measured.spending));
    if (measured.gains != null) setGains(centsToDisplay(measured.gains));
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

        <Field label="Age">
          <input name="age" inputMode="numeric" defaultValue={row.age ?? ""} className={inputClass} />
        </Field>
        {/* The year goes in the label rather than a hint underneath — the
            footnote said the same thing in smaller type. The earliest year has
            no year before it to inherit from. */}
        <Field label={isFirst ? "Opening balance (start)" : `Opening balance of ${row.year - 1}`}>
          <input
            value={centsToDisplay(row.boyCents)}
            readOnly={!isFirst}
            disabled
            className={`${inputClass} opacity-60`}
          />
        </Field>

        <Field label="Income">
          <input
            name="income"
            inputMode="decimal"
            value={income}
            onChange={(e) => {
              setIncome(e.target.value);
              setEoyDraft(null);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Spending">
          <input
            name="spending"
            inputMode="decimal"
            value={spending}
            onChange={(e) => {
              setSpending(e.target.value);
              setEoyDraft(null);
            }}
            className={inputClass}
          />
        </Field>
        {/* Saved, gains and the close read left to right as one sentence,
            so they share a row of their own — three narrow boxes fit where two
            wide ones wasted the space. */}
        <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Saved / invested" hint="Auto-calculated from Income & Spending.">
            <input
              value={centsToDisplay(savedCents)}
              readOnly
              disabled
              className={`${inputClass} opacity-60`}
            />
          </Field>
          <Field label="Est. gains">
            <input
              name="growth"
              inputMode="decimal"
              value={gains}
              onChange={(e) => {
                setGains(e.target.value);
                setEoyDraft(null);
              }}
              className={inputClass}
            />
          </Field>
          {/* Signed, and one number rather than a purchase model: the app does
              not track vehicles or amortisation, so what it can hold honestly
              is the net effect on this year's close. A house is roughly minus
              the closing costs (the down payment leaves cash and arrives as
              equity); a cash car is minus the car; a windfall is positive. */}
          <Field
            label="One-off (+/−)"
            hint="A house, a car, a windfall. This year only — never carried forward."
          >
            <input
              name="oneOff"
              inputMode="decimal"
              value={oneOff}
              placeholder="0.00"
              onChange={(e) => {
                setOneOff(e.target.value);
                setEoyDraft(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field
            label="Proj EOY NW"
            hint={
              eoyBelowFloor
                ? `Gains can't be negative — the lowest ${row.year} can close on with this income and spending is ${formatMoney(floorEoyCents, currency)}.`
                : "Typing here sets Est. gains to match."
            }
            hintTone={eoyBelowFloor ? "text-negative" : undefined}
          >
            <input
              inputMode="decimal"
              value={eoyDraft ?? centsToDisplay(predictedEoyCents)}
              onChange={(e) => editEoy(e.target.value)}
              onBlur={() => setEoyDraft(null)}
              className={inputClass}
            />
          </Field>
        </div>

        {/* What the rest of the app recorded for this year — the figures to
            copy in at year end, shown where they are needed rather than on
            another page. */}
        <div className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {row.year}: {row.inProgress ? "so far" : "actual"} from other pages
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {/* The register's own figures, always — this panel reports, it
                doesn't offer. What may be copied into the boxes above is a
                narrower question (`measured`), and tying the two together
                blanked the "so far" lines for the year in progress, which is
                the year you most want them for. */}
            <Recorded label="Income" cents={row.actualIncomeCents} currency={currency} from="Transactions" />
            <Recorded label="Spending" cents={row.actualSpendingCents} currency={currency} from="Transactions" />
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
              from={row.actualGainsCents == null ? "Measured from balances" : "Invest / Savings"}
            />
          </div>
        </div>

        {/* Plan, measured, and the gap between them — read left to right, and
            measured against what is typed right now rather than what is
            stored, so the difference moves with the fields above. */}
        <div className="sm:col-span-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
          <p>
            <span className="text-muted">Proj EOY NW: </span>
            <span className="font-semibold text-foreground">
              {formatMoney(predictedEoyCents, currency)}
            </span>
          </p>
          <p className="sm:text-center">
            <span className="text-muted">
              {row.inProgress ? "Actual net worth so far: " : "Actual net worth: "}
            </span>
            <span className="font-semibold text-foreground">
              {row.actualCents == null ? "—" : formatMoney(row.actualCents, currency)}
            </span>
          </p>
          <p className="sm:text-right">
            <span className="text-muted">Actual Diff: </span>
            {liveDiffCents == null ? (
              <span className="font-semibold text-foreground">—</span>
            ) : (
              <span
                className={`font-semibold ${
                  liveDiffCents >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {liveDiffCents >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(liveDiffCents), currency)}
              </span>
            )}
          </p>
        </div>

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
                  {formatMoney(c.from, currency)}
                  <span aria-hidden className="mx-1 text-muted">→</span>
                  <span className="font-semibold">{formatMoney(c.to ?? 0, currency)}</span>
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
                {formatMoney(Math.abs(missCents), currency)}
              </span>
              <span className="text-muted">
                {" "}
                {missCents >= 0 ? "better than planned" : "short of plan"}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-muted">
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
        <p className="text-sm font-bold">NW Projections</p>
        <p className="mt-1 text-xs text-muted">
          Where your net worth is heading, year by year, and how each year turns
          out against the plan. Start it from what you have already recorded —
          every figure stays editable, and changing a year carries the change
          forward.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SeedTile label="Starting balance" value={formatMoney(seed.boyCents, currency)} sub="net worth today" />
          <SeedTile label="Income / yr" value={formatMoney(seed.incomeCents, currency)} sub="last 12 months" />
          <SeedTile label="Spending / yr" value={formatMoney(seed.spendingCents, currency)} sub="last 12 months" />
          <SeedTile
            label="Saved / invested"
            value={formatMoney(savedCents, currency)}
            sub="income − spending"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-[11px] text-muted">
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
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted">{sub}</p>
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
  /** Word between the amount and the qualifier, e.g. "saved so far". */
  noun?: string;
}) {
  if (!cents) return null;
  const running = row.year === thisYear;
  if (!running && row.actualMonths < MIN_MONTHS_FOR_ACTUALS) return null;
  return (
    <span className="block text-[10px] font-normal text-muted">
      {formatMoney(cents, currency)} {[noun, running ? "so far" : "actual"].filter(Boolean).join(" ")}
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
}: {
  label: string;
  cents: number | null;
  currency: string;
  from: string;
}) {
  return (
    <span className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="block font-semibold tabular-nums">
        {cents ? formatMoney(cents, currency) : "—"}
      </span>
      <span className="block text-[10px] text-muted">{from}</span>
    </span>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

function Field({
  label,
  hint,
  hintTone,
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
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint ? (
        <span className={`mt-0.5 block text-[10px] ${hintTone ?? "text-muted"}`}>{hint}</span>
      ) : null}
    </label>
  );
}

function Figure({
  label,
  value,
  tone,
  style,
}: {
  label: string;
  value: string;
  tone: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`} style={style}>
        {value}
      </span>
    </span>
  );
}
