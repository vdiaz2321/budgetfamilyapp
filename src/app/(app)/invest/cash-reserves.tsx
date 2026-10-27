"use client";

import { useSessionCollapse } from "@/lib/use-session-collapse";

// Cash sitting in savings buckets — the money that is neither invested nor
// budgeted as a monthly line.
//
// Deliberately NOT driven by `savings_goals`. There is no savings budget item
// right now (see the Savings-vs-investing note): every bucket here has a
// balance but no goal row, so a goal-driven section would render
// five "no goal set" rows and hide ~$170k. This reads `bucket_snapshots`
// instead, which is captured monthly for every bucket regardless.
//
// A balance going DOWN is normal here, not a warning — these funds exist to be
// spent, and the Vehicle Purchase and Real Estate buckets are earmarked for a
// planned drawdown. When a savings budget item does appear,
// `goalCents` / `plannedMonthlyCents` start arriving non-null and the row grows
// a target line without the section being rewritten.

export type CashReserveRow = {
  id: string;
  name: string;
  /** The account this fund sits in — itself, for a bucketless account. */
  accountId: string;
  accountName: string;
  /** A bucket inside a bank account, vs. a whole account with no buckets. */
  isBucket: boolean;
  balanceCents: number;
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


function formatCash(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
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
        <span className="text-xs sm:text-sm text-muted">months of essentials covered</span>
        <span className="ml-auto text-xs sm:text-sm font-semibold" style={{ color: tone }}>
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
      <div className="mt-1 flex justify-between max-sm:text-[11px] sm:text-[15px] text-muted">
        <span>3 mo floor</span>
        <span>
          {gapToSix > 0 ? `${formatCash(gapToSix, currency)} to 6 mo` : "6 mo target met"}
        </span>
      </div>
      <p className="mt-1 max-sm:text-[11px] sm:text-[15px] text-muted">
        Based on {formatCash(monthlyEssentialCents, currency)}/mo of bills.
      </p>
    </div>
  );
}

// The target / months-of-cover lines under a fund, when it has one.
function ReserveTracks({
  row,
  currency,
  monthlyEssentialCents,
}: {
  row: CashReserveRow;
  currency: string;
  monthlyEssentialCents: number | null;
}) {
  return (
    <>
      {row.goalCents != null && row.goalCents > 0 ? (
        (() => {
          // Same track the emergency fund gets, measured against the goal
          // instead of against months of bills. A goal that's been reached
          // goes green; anything short stays on the savings blue, so "not
          // there yet" and "done" read apart at a glance.
          const pct = Math.min(100, (row.balanceCents / row.goalCents) * 100);
          const tone = pct >= 100 ? "var(--positive)" : "var(--viz-savings)";
          const remaining = Math.max(0, row.goalCents - row.balanceCents);
          return (
            <div className="mt-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 max-sm:text-[12px] sm:text-[15px] text-muted">
                <span>
                  Target {formatCash(row.goalCents, currency)}
                  {row.plannedMonthlyCents ? ` · ${formatCash(row.plannedMonthlyCents, currency)}/mo planned` : ""}
                </span>
                <span className="tabular-nums font-semibold" style={{ color: tone }}>
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-line/60">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, backgroundColor: tone }}
                />
              </div>
              <p className="mt-1 max-sm:text-[11px] sm:text-[15px] text-muted">
                {remaining > 0 ? `${formatCash(remaining, currency)} to go` : "Target reached"}
              </p>
            </div>
          );
        })()
      ) : null}

      {row.isEmergencyFund && monthlyEssentialCents ? (
        <RunwayTrack
          balanceCents={row.balanceCents}
          monthlyEssentialCents={monthlyEssentialCents}
          currency={currency}
        />
      ) : null}
    </>
  );
}

function FundLine({ name, cents, currency }: { name: string; cents: number; currency: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="min-w-0 text-sm font-semibold">{name}</span>
      <span className="shrink-0 text-sm font-bold tabular-nums">{formatCash(cents, currency)}</span>
    </div>
  );
}

// Same soft light-blue band as the totals in the cards at the top of the page.
const TOTAL_BAND = "-mx-2 rounded-md bg-sky-50 px-2 py-1 dark:bg-sky-950/40";

type AccountGroup = {
  accountId: string;
  accountName: string;
  totalCents: number;
  buckets: CashReserveRow[];
  /** The account's own row when it has no buckets. */
  self: CashReserveRow | null;
};

function groupByAccount(rows: CashReserveRow[]): AccountGroup[] {
  const byId = new Map<string, AccountGroup>();
  for (const row of rows) {
    let g = byId.get(row.accountId);
    if (!g) {
      g = { accountId: row.accountId, accountName: row.accountName, totalCents: 0, buckets: [], self: null };
      byId.set(row.accountId, g);
    }
    g.totalCents += row.balanceCents;
    if (row.isBucket) g.buckets.push(row);
    else g.self = row;
  }
  // Biggest first, at both levels — rows already arrive balance-sorted.
  return [...byId.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export function CashReserves({ data, currency }: { data: CashReservesData; currency: string }) {
  const [state, setState] = useSessionCollapse("invest-cash-reserves", () => ({ open: true }));
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
          <span className="text-base font-semibold">Cash On Hand</span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>
            {formatCash(data.totalCents, currency)}
          </span>
          <span className="text-xs sm:text-sm text-muted">
            {data.rows.length} fund{data.rows.length === 1 ? "" : "s"}
          </span>
        </span>
      </button>
      {open ? (
        <>
          <p className="border-b border-line/70 px-4 py-2 text-xs sm:text-sm text-muted">
            The balances come from Accounts.
          </p>
          {/* Grouped by the account the money sits in: an account with
              buckets gets a tinted heading with its total and its buckets
              indented under it; an account with no buckets is one plain row.
              Without this, Amex Savings' four buckets read as four separate
              accounts beside Wallet$ and Ally Bank (Victor, 2026-10-27). */}
          <ul className="divide-y divide-line/60">
            {groupByAccount(data.rows).map((g) =>
              g.buckets.length > 0 ? (
                <li key={g.accountId} className="px-4 py-3">
                  <div className={`${TOTAL_BAND} flex flex-wrap items-baseline justify-between gap-x-3`}>
                    <span className="min-w-0 text-sm font-bold">
                      {g.accountName}{" "}
                      <span className="font-semibold text-muted">· {g.buckets.length} buckets</span>
                    </span>
                    <span className="ml-auto shrink-0 text-sm font-bold tabular-nums">{formatCash(g.totalCents, currency)}</span>
                  </div>
                  <ul className="mt-1 divide-y divide-line/40 pl-3">
                    {g.buckets.map((row) => (
                      <li key={row.id} className="py-2.5">
                        <FundLine name={row.name} cents={row.balanceCents} currency={currency} />
                        <ReserveTracks row={row} currency={currency} monthlyEssentialCents={data.monthlyEssentialCents} />
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={g.accountId} className="px-4 py-3">
                  {g.self ? (
                    <>
                      <FundLine name={g.self.name} cents={g.self.balanceCents} currency={currency} />
                      <ReserveTracks row={g.self} currency={currency} monthlyEssentialCents={data.monthlyEssentialCents} />
                    </>
                  ) : null}
                </li>
              ),
            )}
            <li className="px-4 py-3">
              <div className={`${TOTAL_BAND} flex flex-wrap items-baseline justify-between gap-x-3`}>
                <span className="text-sm font-bold">Total Cash On Hand</span>
                <span className="text-sm font-bold tabular-nums">{formatCash(data.totalCents, currency)}</span>
              </div>
            </li>
          </ul>
        </>
      ) : null}
    </section>
  );
}
