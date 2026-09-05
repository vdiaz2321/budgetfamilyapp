"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, displayToCents, formatMoney } from "@/lib/money";
import { fillProjectionForward, saveProjectionYear } from "./actions";

export type ProjectionYear = {
  year: number;
  age: number | null;
  boyCents: number;
  incomeCents: number;
  taxesCents: number;
  spendingCents: number;
  growthCents: number;
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
  /** Contributions into investment accounts that year, from Invest / Savings. */
  actualInvestedCents: number | null;
  /** True while the year is still running — its actual is only part-way. */
  inProgress: boolean;
};

// A year is "on track" within this much of the plan. Net worth moves in
// five-figure steps, so a dollar-exact comparison would flag everything.
const TOLERANCE = 0.02;

// Below this many recorded months, a year's income and spending totals say
// more about when the register started than about the year itself, so they are
// left off rather than shown as a total nobody should trust. The year in
// progress is exempt — it is legitimately partial, and says so.
const MIN_MONTHS_FOR_ACTUALS = 6;

export function ProjectionSection({
  years,
  currency,
  thisYear,
}: {
  years: ProjectionYear[];
  currency: string;
  thisYear: number;
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-projection", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  const [editing, setEditing] = useState<ProjectionYear | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const current = years.find((y) => y.year === thisYear) ?? null;

  // The year in progress is neither plan nor history: it is what has actually
  // happened so far plus whatever the estimate says is still to come. Once it
  // closes, the actual stands on its own and this disappears.
  const forecastFor = (y: ProjectionYear): number | null => {
    if (y.year !== thisYear || y.actualCents == null) return null;
    const estSaved = y.incomeCents - y.taxesCents - y.spendingCents;
    const savedLeft = Math.max(0, estSaved - (y.actualSavedCents ?? 0));
    const gainsLeft = Math.max(0, y.growthCents - (y.actualGainsCents ?? 0));
    return y.actualCents + savedLeft + gainsLeft;
  };
  const forecast = current ? forecastFor(current) : null;
  const gap = current?.actualCents != null ? current.actualCents - current.eoyCents : null;
  const last = years.at(-1) ?? null;

  function refill() {
    if (
      !window.confirm(
        `Rebuild every year after ${thisYear} from the assumptions? Hand-entered figures for those years will be replaced.`,
      )
    ) {
      return;
    }
    start(async () => {
      const result = await fillProjectionForward(thisYear);
      if (result?.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
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
          <span className="text-sm font-bold">Projection vs actual</span>
        </button>

        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {current ? (
            <Figure
              label={`${thisYear} plan`}
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
              label={gap >= 0 ? "Ahead by" : "Behind by"}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-center font-semibold">Year</th>
                  <th className="px-3 py-2 text-center font-semibold">Age</th>
                  <th className="px-3 py-2 text-center font-semibold">Income</th>
                  <th className="px-3 py-2 text-center font-semibold">Spending</th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">Saved / invested</th>
                  <th className="px-3 py-2 text-center font-semibold">Planned EOY</th>
                  <th className="px-3 py-2 text-center font-semibold">Actual</th>
                  <th className="px-3 py-2 text-center font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => {
                  const diff = y.actualCents == null ? null : y.actualCents - y.eoyCents;
                  const within =
                    diff != null && Math.abs(diff) <= Math.abs(y.eoyCents) * TOLERANCE;
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
                      {/* The plan's saving for the year — income less taxes and
                          spending — with what actually reached savings and
                          investments underneath it. */}
                      <td className="px-3 py-2 text-center tabular-nums">
                        <span style={{ color: "var(--viz-savings)" }}>
                          {formatMoney(
                            y.incomeCents - y.taxesCents - y.spendingCents,
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
                        {/* Gains are the sheet's Growth row, measured. They come
                            from the year-end figures on Invest / Savings, so
                            they appear whether or not the register covered the
                            year. */}
                        {y.actualGainsCents ? (
                          <span className="block text-[10px] font-normal text-positive">
                            +{formatMoney(y.actualGainsCents, currency)} gains
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {formatMoney(y.eoyCents, currency)}
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
                        {y.actualCents == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            {formatMoney(y.actualCents, currency)}
                            {y.inProgress ? (
                              <span className="ml-1 text-[10px] text-muted">so far</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {diff == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={`font-semibold ${
                              within ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"
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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-6">
            <p className="text-[11px] text-muted">
              Actuals come from your recorded net worth history — nothing here edits them.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={refill}
              className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
            >
              {pending ? "Rebuilding…" : `Rebuild ${thisYear + 1} onward`}
            </button>
          </div>
          {error ? (
            <p className="px-4 pb-3 text-sm font-medium text-negative sm:px-6">{error}</p>
          ) : null}
        </>
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
  const measured = {
    income: row.actualMonths >= MIN_MONTHS_FOR_ACTUALS ? row.actualIncomeCents || null : null,
    spending: row.actualMonths >= MIN_MONTHS_FOR_ACTUALS ? row.actualSpendingCents || null : null,
    gains: row.actualGainsCents || null,
  };
  const hasMeasured = Object.values(measured).some((v) => v != null);

  // What pressing "use actuals" would change, so it can be read before it
  // happens rather than discovered afterwards.
  const [preview, setPreview] = useState(false);

  // The three fields are one equation — saved = income − taxes − spending — so
  // whichever one you type into, the others stay true. Victor thinks in
  // "I plan to put away $50k", so that has to be typeable directly, not only
  // reachable by working backwards through spending.
  const [income, setIncome] = useState(centsToDisplay(row.incomeCents));
  const [spending, setSpending] = useState(centsToDisplay(row.spendingCents));
  const [gains, setGains] = useState(centsToDisplay(row.growthCents));
  const incomeCents = displayToCents(income);
  const spendingCents = displayToCents(spending);
  const savedCents = incomeCents - row.taxesCents - spendingCents;
  const changes = [
    { name: "income", label: "Income", from: row.incomeCents, to: measured.income },
    { name: "spending", label: "Spending", from: row.spendingCents, to: measured.spending },
    { name: "growth", label: "Est. gains", from: row.growthCents, to: measured.gains },
  ].filter((c) => c.to != null && c.to !== c.from);

  // Fills the fields; still does not save. Closing a year takes two deliberate
  // presses: this one, then Save.
  function applyActuals() {
    if (measured.income != null) setIncome(centsToDisplay(measured.income));
    if (measured.spending != null) setSpending(centsToDisplay(measured.spending));
    if (measured.gains != null) setGains(centsToDisplay(measured.gains));
    setPreview(false);
  }

  return (
    <ModalShell title={`${row.year} projection`} onClose={onClose}>
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
        <input type="hidden" name="taxes" value={centsToDisplay(row.taxesCents)} />

        <Field label="Age">
          <input name="age" inputMode="numeric" defaultValue={row.age ?? ""} className={inputClass} />
        </Field>
        <Field label="Opening balance">
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
            onChange={(e) => setIncome(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Spending">
          <input
            name="spending"
            inputMode="decimal"
            value={spending}
            onChange={(e) => setSpending(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Saved / invested">
          <input
            inputMode="decimal"
            value={centsToDisplay(savedCents)}
            // Typing a target here moves spending, since income is the fixed
            // half of the pair most years.
            onChange={(e) => setSpending(centsToDisplay(incomeCents - row.taxesCents - displayToCents(e.target.value)))}
            className={inputClass}
          />
        </Field>
        <Field label="Est. gains">
          <input
            name="growth"
            inputMode="decimal"
            value={gains}
            onChange={(e) => setGains(e.target.value)}
            className={inputClass}
          />
        </Field>

        {/* What the rest of the app recorded for this year — the figures to
            copy in at year end, shown where they are needed rather than on
            another page. */}
        <div className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {row.year} {row.inProgress ? "so far" : "actual"} · from your other pages
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <Recorded label="Income" cents={measured.income} currency={currency} from="Transactions" />
            <Recorded label="Spending" cents={measured.spending} currency={currency} from="Transactions" />
            <Recorded
              label="Contributed"
              cents={row.actualInvestedCents}
              currency={currency}
              from="Invest / Savings"
            />
            <Recorded
              label="Gains"
              cents={row.actualGainsCents}
              currency={currency}
              from="Invest / Savings"
            />
          </div>
        </div>

        <div className="sm:col-span-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {row.actualCents != null ? (
            <p>
              <span className="text-muted">
                {row.inProgress ? "Actual net worth so far: " : "Actual net worth: "}
              </span>
              <span className="font-semibold text-foreground">
                {formatMoney(row.actualCents, currency)}
              </span>
            </p>
          ) : null}
          <p className={row.actualCents != null ? "sm:text-right" : ""}>
            <span className="text-muted">Predicted EOY net worth: </span>
            <span className="font-semibold text-foreground">
              {formatMoney(row.eoyCents, currency)}
            </span>
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
            <p className="mt-1 text-[11px] text-muted">
              Nothing is saved until you press Save year, and every later year is
              recomputed when you do.
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
