"use client";

import { useSessionCollapse } from "@/lib/use-session-collapse";

// Cash sitting in savings buckets — the money that is neither invested nor
// budgeted as a monthly line.
//
// Deliberately NOT driven by `savings_goals`. There is no savings budget item
// right now (see the Savings-vs-investing note): every bucket here has a
// balance and a history but no goal row, so a goal-driven section would render
// five "no goal set" rows and hide ~$170k. This reads `bucket_snapshots`
// instead, which is captured monthly for every bucket regardless.
//
// A balance going DOWN is normal here, not a warning. These funds exist to be
// spent — the Vehicle Purchase and Real Estate buckets are earmarked for a
// planned drawdown — so the delta is shown as a plain signed figure with no
// pace badge and no "behind" styling. When a savings budget item does appear,
// `goalCents` / `plannedMonthlyCents` start arriving non-null and the row grows
// a target line without the section being rewritten.

export type CashReserveRow = {
  id: string;
  name: string;
  accountName: string;
  balanceCents: number;
  /** Month-end balances, oldest first. */
  history: { month: string; balanceCents: number }[];
  isEmergencyFund: boolean;
  /** Non-null once a savings goal exists for this bucket. */
  goalCents: number | null;
  plannedMonthlyCents: number | null;
};

export type CashReservesData = {
  rows: CashReserveRow[];
  totalCents: number;
  /** Trailing monthly essential spend, for the emergency-fund runway. */
  monthlyEssentialCents: number | null;
  basisMonths: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCash(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function shortMonth(dateStr: string): string {
  const [, m] = dateStr.split("-").map(Number);
  return MONTHS[m - 1] ?? "";
}

/**
 * Balance history as a single line. Scaled to its own min/max so a bucket that
 * moved $500 is as readable as one that moved $50,000 — these are shapes, not
 * a shared axis, and they are never compared against each other.
 */
function Sparkline({ history }: { history: { month: string; balanceCents: number }[] }) {
  if (history.length < 2) return null;
  const values = history.map((h) => h.balanceCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A balance that never moved has no shape to draw, and a dead-flat rule
  // spanning the row reads as a divider rather than as data. Several of these
  // funds sit untouched for months at a time, so this is the common case.
  if (max === min) return null;
  const span = max - min;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      // 2px of padding top and bottom so a flat line at the extreme still draws.
      const y = 26 - ((v - min) / span) * 24;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="mt-1.5 h-7 w-full"
      role="img"
      aria-label={`Balance from ${shortMonth(history[0].month)} to ${shortMonth(history[history.length - 1].month)}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--viz-savings)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Months of essential spending the emergency fund covers. 3 is the usual
 * floor, 6 the usual target — the track marks both so the number reads as a
 * judgement rather than a bare figure.
 */
function RunwayTrack({
  balanceCents,
  monthlyEssentialCents,
  currency,
}: {
  balanceCents: number;
  monthlyEssentialCents: number;
  currency: string;
}) {
  const monthsCovered = balanceCents / monthlyEssentialCents;
  const tone =
    monthsCovered >= 6 ? "var(--positive)" : monthsCovered >= 3 ? "var(--viz-savings)" : "var(--negative)";
  const verdict = monthsCovered >= 6 ? "Fully funded" : monthsCovered >= 3 ? "Solid floor" : "Below 3 months";
  const fillPct = Math.min(100, (monthsCovered / 6) * 100);
  const gapToSix = Math.max(0, monthlyEssentialCents * 6 - balanceCents);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-lg font-bold tabular-nums" style={{ color: tone }}>
          {monthsCovered.toFixed(1)}
        </span>
        <span className="text-xs text-muted">months of essentials covered</span>
        <span className="ml-auto text-xs font-semibold" style={{ color: tone }}>
          {verdict}
        </span>
      </div>
      <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line/60">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${fillPct}%`, backgroundColor: tone }}
        />
        <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: "50%" }} aria-hidden />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>3 mo floor</span>
        <span>
          {gapToSix > 0 ? `${formatCash(gapToSix, currency)} to 6 mo` : "6 mo target met"}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted">
        Based on {formatCash(monthlyEssentialCents, currency)}/mo of bills and expenses.
      </p>
    </div>
  );
}

function ReserveRow({
  row,
  currency,
  monthlyEssentialCents,
}: {
  row: CashReserveRow;
  currency: string;
  monthlyEssentialCents: number | null;
}) {
  const first = row.history[0];
  const changeCents = first ? row.balanceCents - first.balanceCents : 0;
  const showChange = row.history.length >= 2 && changeCents !== 0;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 text-sm font-semibold">{row.name}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums">
          {formatCash(row.balanceCents, currency)}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 truncate text-[11px] text-muted">{row.accountName}</span>
        {showChange ? (
          <span
            className={`shrink-0 text-[11px] font-medium tabular-nums ${
              changeCents > 0 ? "text-positive" : "text-negative"
            }`}
          >
            {changeCents > 0 ? "+" : "−"}
            {formatCash(Math.abs(changeCents), currency)} since {shortMonth(first.month)}
          </span>
        ) : null}
      </div>

      <Sparkline history={row.history} />

      {row.goalCents != null && row.goalCents > 0 ? (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-muted">
          <span>
            Target {formatCash(row.goalCents, currency)}
            {row.plannedMonthlyCents ? ` · ${formatCash(row.plannedMonthlyCents, currency)}/mo planned` : ""}
          </span>
          <span className="tabular-nums">
            {Math.min(100, (row.balanceCents / row.goalCents) * 100).toFixed(0)}%
          </span>
        </div>
      ) : null}

      {row.isEmergencyFund && monthlyEssentialCents ? (
        <RunwayTrack
          balanceCents={row.balanceCents}
          monthlyEssentialCents={monthlyEssentialCents}
          currency={currency}
        />
      ) : null}
    </li>
  );
}

export function CashReserves({ data, currency }: { data: CashReservesData; currency: string }) {
  const [state, setState] = useSessionCollapse("invest-cash-reserves", () => ({ open: false }));
  const open = state.open === true;

  if (data.rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setState((s) => ({ ...s, open: !s.open }))}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line/70 px-4 py-3 text-left transition hover:bg-brand-soft/15"
      >
        <span className="flex items-baseline gap-2">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 self-center text-muted transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="text-base font-semibold">Cash reserves</span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>
            {formatCash(data.totalCents, currency)}
          </span>
          <span className="text-xs text-muted">
            {data.rows.length} fund{data.rows.length === 1 ? "" : "s"}
          </span>
        </span>
      </button>
      {open ? (
        <>
          <p className="border-b border-line/70 px-4 py-2 text-xs text-muted">
            Bank and savings buckets held outside the market. These don&rsquo;t need a budget
            item — the balances come straight from Accounts.
          </p>
          <ul className="divide-y divide-line/60">
            {data.rows.map((row) => (
              <ReserveRow
                key={row.id}
                row={row}
                currency={currency}
                monthlyEssentialCents={data.monthlyEssentialCents}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
