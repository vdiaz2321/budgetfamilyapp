"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { ageInYear, projectFi, type FiScheduleYear } from "@/lib/retirement";
import { saveRetirementPlan } from "./actions";

export type FiPlan = {
  birthYear: number | null;
  targetRetireYear: number | null;
  annualSpendCents: number | null;
  annualContributionCents: number | null;
  realReturnPct: number;
  withdrawalRatePct: number;
  includeCash: boolean;
};

export type FiMeasured = {
  /** Invested (non-kids) accounts today. */
  investedCents: number;
  /** Cash sitting in savings and checking, offered as an opt-in. */
  cashCents: number;
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
  /** The plan's closing net worth for that year — the grid's "Planned EOY". */
  eoyCents: number;
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

  const portfolioCents = measured.investedCents + (plan.includeCash ? measured.cashCents : 0);

  // The projection grid, read as today's money — which is what it holds. The
  // rows are typed by hand in round figures ($90k while the kids are home,
  // $45k once they aren't), not as inflated future dollars, so they go into
  // this section as they are. Discounting them would read a plan for a $45k
  // retirement as a plan for a $20k one and hand back an FI date years too
  // early.
  const schedule = useMemo<FiScheduleYear[]>(() => {
    // An explicit spending override means "ignore what you measured and what
    // I planned, use this" — it has to beat the grid too, or it can't be used
    // to answer a what-if.
    if (plan.annualSpendCents != null) return [];
    return projection
      .filter((p) => p.year >= thisYear)
      .map((p) => ({
        year: p.year,
        spendCents: p.spendingCents,
        // What the plan puts away that year: income less spending.
        contributionCents: Math.max(0, p.incomeCents - p.spendingCents),
      }));
  }, [projection, thisYear, plan.annualSpendCents]);

  const usingGrid = schedule.length > 0;

  // One representative figure for the sentence under the header. With a grid
  // driving things that is this year's planned number, not a forty-year
  // average.
  const thisYearPlan = schedule.find((y) => y.year === thisYear) ?? null;
  const contributionCents =
    plan.annualContributionCents ?? thisYearPlan?.contributionCents ?? measured.contributionCents;

  const fi = useMemo(
    () =>
      projectFi(
        {
          portfolioCents,
          annualContributionCents: plan.annualContributionCents ?? measured.contributionCents,
          annualSpendCents: plan.annualSpendCents ?? measured.spendCents,
          realReturnPct: plan.realReturnPct,
          withdrawalRatePct: plan.withdrawalRatePct,
          schedule,
        },
        thisYear,
      ),
    [
      portfolioCents,
      plan.annualContributionCents,
      plan.annualSpendCents,
      measured.contributionCents,
      measured.spendCents,
      plan.realReturnPct,
      plan.withdrawalRatePct,
      schedule,
      thisYear,
    ],
  );

  const fiAge = ageInYear(plan.birthYear, fi.fiYear ?? thisYear);
  // What the plan says about the year he'd like to stop, when one is set.
  const atTarget = plan.targetRetireYear
    ? fi.years.find((y) => y.year === plan.targetRetireYear) ?? null
    : null;

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
          <span className="text-sm font-bold">FI Projections</span>
        </button>

        {/* Sat at the very bottom of the panel before, which meant scrolling
            past the whole chart to change the numbers the chart is drawn
            from. */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mr-auto rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
        >
          Assumptions
        </button>

        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* The two "today" facts live up here rather than in the body: they
              describe where he stands now, so they'd read as competing with
              the chart's per-year readout if they sat beside it. */}
          <Figure
            label="Portfolio today"
            value={formatMoney(portfolioCents, currency)}
            tone="text-foreground"
          />
          <Figure
            label="FI number"
            value={formatMoney(fi.fiNumberCents, currency)}
            tone="text-foreground"
          />
          <Figure
            label="Funded"
            value={`${Math.round(fi.progress * 100)}%`}
            tone=""
            style={{ color: "var(--viz-savings)" }}
          />
          <Figure
            label="Supports today"
            value={`${formatMoney(fi.sustainableSpendCents, currency)}/yr`}
            tone="text-foreground"
          />
          <Figure
            label={fi.fiYear ? "Independent in" : "Independent"}
            value={
              fi.fiYear
                ? `${fi.fiYear}${fiAge != null ? ` · age ${fiAge}` : ""}`
                : "not on this path"
            }
            tone={fi.fiYear ? "text-positive" : "text-negative"}
          />
        </span>
      </div>

      {open ? (
        <div className="border-t border-line px-4 py-4 sm:px-6">
          <p className="text-xs text-muted">
            At a {plan.realReturnPct}% real return, this
            {usingGrid ? " plan" : ` ${formatMoney(contributionCents, currency)} a year`}
            {usingGrid ? " reaches FI" : " covers your spending"}
            {fi.fiYear ? (
              <>
                {" "}
                by <span className="font-semibold text-foreground">{fi.fiYear}</span> — {fi.yearsToFi}{" "}
                {fi.yearsToFi === 1 ? "year" : "years"} from now
                {fiAge != null ? `, at age ${fiAge}` : ""}.
              </>
            ) : (
              <> nowhere inside 60 years. Raise the contributions or lower the spending.</>
            )}{" "}
            Every figure is in today&rsquo;s money.
          </p>


          {atTarget ? (
            <p className="mt-1 text-xs text-muted">
              By your target of{" "}
              <span className="font-semibold text-foreground">{plan.targetRetireYear}</span> the
              portfolio reaches{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(atTarget.endCents, currency)}
              </span>
              , which supports{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(Math.round((atTarget.endCents * plan.withdrawalRatePct) / 100), currency)}
              </span>{" "}
              a year —{" "}
              {atTarget.endCents >= fi.fiNumberCents ? (
                <span className="font-semibold text-positive">enough</span>
              ) : (
                <span className="font-semibold text-negative">
                  {formatMoney(fi.fiNumberCents - atTarget.endCents, currency)} short
                </span>
              )}
              .
            </p>
          ) : null}

          <FiChart
            fi={fi}
            thisYear={thisYear}
            birthYear={plan.birthYear}
            targetRetireYear={plan.targetRetireYear}
            projection={projection}
            currency={currency}
          />

        </div>
      ) : null}

      {editing ? (
        <PlanModal
          plan={plan}
          measured={measured}
          currency={currency}
          onClose={() => setEditing(false)}
        />
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
  projection,
  currency,
}: {
  fi: ReturnType<typeof projectFi>;
  thisYear: number;
  birthYear: number | null;
  targetRetireYear: number | null;
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
  const max = Math.max(1, ...fi.years.map((y) => y.endCents));

  // Two or three gridlines: enough to size a bar by eye, few enough to stay
  // out of the way of the bars themselves.
  const step = niceStep(max / 3);
  const gridlines: number[] = [];
  for (let v = step; v <= max; v += step) gridlines.push(v);

  // Full four-digit years, so the axis reads 2027 rather than '27. They no
  // longer live in a per-bar span — a 4-digit label is wider than a bar once
  // the projection runs past ~20 years, so each one is positioned over its bar
  // and allowed to spill across its neighbours. Six of them is what fits at
  // mobile width without the labels touching.
  const labelEvery = Math.max(1, Math.ceil(count / 6));
  const targetIndex =
    targetRetireYear == null ? -1 : fi.years.findIndex((y) => y.year === targetRetireYear);

  // The crossing year and the two ends are named first — they carry the
  // meaning. The every-nth rhythm then fills the gaps, but only where it
  // clears the labels already placed; two four-digit years a bar apart run
  // into each other.
  const minGap = Math.max(2, Math.ceil(count / 8));
  const anchors = [0, count - 1, ...(fiIndex >= 0 ? [fiIndex] : [])];
  const labelled = new Set<number>(anchors);
  for (let i = 0; i < count; i += labelEvery) {
    if ([...labelled].every((placed) => Math.abs(placed - i) >= minGap)) labelled.add(i);
  }

  const centreOf = (i: number) => ((i + 0.5) / count) * 100;
  const fiRow = fiIndex >= 0 ? fi.years[fiIndex] : null;
  const targetRow = targetIndex >= 0 ? fi.years[targetIndex] : null;

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
              className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted"
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
                aria-label={`${y.year}: ${formatMoney(y.endCents, currency)}`}
                aria-pressed={i === selectedIndex}
                className="group flex h-full flex-1 cursor-pointer items-end rounded-t-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span
                  className="w-full rounded-t-[2px] transition-opacity group-hover:opacity-80"
                  style={{
                    height: `${Math.max(1, (y.endCents / max) * 100)}%`,
                    backgroundColor: y.independent ? "var(--positive)" : "var(--viz-spending)",
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
                className={`absolute top-0 whitespace-nowrap rounded bg-surface/90 px-1 text-[10px] font-semibold text-positive ${
                  fiIndex > count / 2 ? "right-1" : "left-1"
                }`}
              >
                FI {fiRow.year}
                {birthYear ? ` · age ${fiRow.year - birthYear}` : ""} · {axisMoney(fiRow.endCents)}
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
                className={`absolute top-5 whitespace-nowrap rounded bg-surface/90 px-1 text-[10px] font-semibold ${
                  targetIndex > count / 2 ? "right-1" : "left-1"
                }`}
              >
                Target {targetRow.year}
                {birthYear ? ` · age ${targetRow.year - birthYear}` : ""}
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
                className="absolute top-0 flex flex-col items-center text-[10px] tabular-nums leading-tight text-muted"
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
                  <span className="text-[9px] opacity-70">age {y.year - birthYear}</span>
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
        <div className="mt-2 rounded-lg bg-background px-3 py-2 ring-1 ring-line">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {selected.year}
            {birthYear ? ` · age ${selected.year - birthYear}` : ""}
            {selected.independent ? " · past the FI number" : ""}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
            <Readout label="Income" value={selectedPlan ? formatMoney(selectedPlan.incomeCents, currency) : "—"} />
            <Readout label="Spending" value={selectedPlan ? formatMoney(selectedPlan.spendingCents, currency) : "—"} />
            <Readout
              label="Saved"
              value={
                selectedPlan
                  ? formatMoney(selectedPlan.incomeCents - selectedPlan.spendingCents, currency)
                  : "—"
              }
            />
            <Readout
              label="Planned EOY"
              value={selectedPlan ? formatMoney(selectedPlan.eoyCents, currency) : "—"}
            />
            <Readout label="Portfolio" value={formatMoney(selected.endCents, currency)} />
          </div>
        </div>
      ) : null}

      {/* What the two bar colours mean. The chart has no hover state on
          purpose — the colours have to say it on their own. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2.5 rounded-[1px]"
            style={{ backgroundColor: "var(--viz-spending)" }}
          />
          Portfolio at year end — still short of the FI number
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2.5 rounded-[1px]"
            style={{ backgroundColor: "var(--positive)" }}
          />
          {fi.fiYear ? `Reach FI — ${fi.fiYear} onward` : "Reach FI"}
        </span>
        <span className="text-muted">Press a bar for that year&rsquo;s figures.</span>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="truncate text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PlanModal({
  plan,
  measured,
  currency,
  onClose,
}: {
  plan: FiPlan;
  measured: FiMeasured;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <ModalShell title="Assumptions" onClose={onClose}>
      <form
        action={(formData) =>
          start(async () => {
            const result = await saveRetirementPlan(formData);
            if (result?.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          })
        }
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        <Field label="Birth year">
          <input
            name="birthYear"
            inputMode="numeric"
            defaultValue={plan.birthYear ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Target retirement year">
          <input
            name="targetRetireYear"
            inputMode="numeric"
            defaultValue={plan.targetRetireYear ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Real return (%)">
          <input
            name="realReturnPct"
            inputMode="decimal"
            defaultValue={plan.realReturnPct}
            className={inputClass}
          />
        </Field>
        <Field label="Withdrawal rate (%)">
          <input
            name="withdrawalRatePct"
            inputMode="decimal"
            defaultValue={plan.withdrawalRatePct}
            className={inputClass}
          />
        </Field>

        <Field label="Spending / yr — blank uses the last 12 months">
          <input
            name="annualSpend"
            inputMode="decimal"
            defaultValue={plan.annualSpendCents ? centsToDisplay(plan.annualSpendCents) : ""}
            placeholder={centsToDisplay(measured.spendCents)}
            className={inputClass}
          />
        </Field>
        <Field label="Invest/Saving / yr — blank uses the last 12 months">
          <input
            name="annualContribution"
            inputMode="decimal"
            defaultValue={
              plan.annualContributionCents ? centsToDisplay(plan.annualContributionCents) : ""
            }
            placeholder={centsToDisplay(measured.contributionCents)}
            className={inputClass}
          />
        </Field>

        <label className="sm:col-span-2 flex items-start gap-2">
          <input
            type="checkbox"
            name="includeCash"
            defaultChecked={plan.includeCash}
            className="mt-0.5 h-4 w-4 rounded accent-[var(--brand)]"
          />
          <span className="text-xs">
            Count cash savings ({formatMoney(measured.cashCents, currency)}) as retirement money.
            <span className="block text-muted">
              Off by default — money earmarked for a house or a car isn&rsquo;t funding a
              retirement.
            </span>
          </span>
        </label>

        <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? (
          <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p>
        ) : null}
      </form>
    </ModalShell>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
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

