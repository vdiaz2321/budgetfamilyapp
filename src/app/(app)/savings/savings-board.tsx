"use client";

import { useMemo, useState, useTransition } from "react";
import { TransactionModal } from "../budget/transaction-modal";
import type { AccountOption, SubOption } from "../budget/types";
import { centsToDisplay } from "@/lib/money";
import { updateSavingsGoalFields, saveContributionCaps } from "./actions";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { IRS_LIMITS_URL, contributionDeadline, monthsUntilDeadline } from "@/lib/contribution-limits";

export type SavingsTxData = {
  id: string;
  date: string;
  payee: string | null;
  accountName: string | null;
  amountCents: number;
  isWithdrawal: boolean;
};

export type SavingsCardData = {
  id: string;
  name: string;
  goalCents: number;
  startCents: number;
  savedCents: number;
  monthlyCents: number;
  plannedCents: number;
  monthDepositsCents: number;
  monthWithdrawalsCents: number;
  monthNetCents: number;
  leftToSaveCents: number;
  targetDate: string | null;
  pace: "none" | "reached" | "on_track" | "behind" | "overdue";
  requiredMonthlyCents: number | null;
  transactions: SavingsTxData[];
  isKids: boolean;
};

type Props = {
  cards: SavingsCardData[];
  currency: string;
  emergencyFund?: EmergencyFundData | null;
  contributionLimits?: ContributionLimitRow[];
  capYear?: number;
  capsPublished?: boolean;
  latestCapYear?: number;
  pendingCapYear?: number | null;
  seedCaps?: { electiveDeferralCents: number; iraCents: number } | null;
  incomeReceivedCents: number;
  currentMonthKey: string;
  currentMonthLabel: string;
  firstOfMonth: string;
  withdrawalSubOptions: SubOption[];
  withdrawalAccountOptions: AccountOption[];
  withdrawalPayeeOptions: { id: string; name: string }[];
};

type Scope = "family" | "kids" | "all";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Savings progress is easier to scan as whole currency units. Keep the
// underlying cents precise; round only what is displayed on this page.
function formatSavingsMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function statsFor(cards: SavingsCardData[]) {
  const totals = cards.reduce(
    (acc, card) => ({
      goal: acc.goal + card.goalCents,
      planned: acc.planned + card.plannedCents,
      saved: acc.saved + card.savedCents,
      deposits: acc.deposits + card.monthDepositsCents,
      withdrawals: acc.withdrawals + card.monthWithdrawalsCents,
      net: acc.net + card.monthNetCents,
    }),
    { goal: 0, planned: 0, saved: 0, deposits: 0, withdrawals: 0, net: 0 },
  );
  return {
    ...totals,
    left: Math.max(0, totals.goal - totals.saved),
    goalPct: totals.goal > 0 ? (totals.saved / totals.goal) * 100 : 0,
    planPct: totals.planned > 0 ? (totals.net / totals.planned) * 100 : 0,
  };
}

export type EmergencyFundData = {
  name: string;
  balanceCents: number;
  monthlyEssentialCents: number;
  monthsCovered: number;
  basisMonths: number;
};

// Months of essential spending the emergency fund covers. 3 months is the
// usual floor, 6 the usual target — shown as a track with both marked so the
// number lands as a judgement, not just a figure.
function EmergencyFundCard({ data, currency }: { data: EmergencyFundData; currency: string }) {
  // Collapsed on a fresh login, then remembers the choice while navigating —
  // same pattern as the Budget hero and the Accounts sections.
  const [state, setState] = useSessionCollapse("savings-emergency-fund", () => ({ open: false }));
  const open = state.open === true;
  const { monthsCovered } = data;
  const tone = monthsCovered >= 6 ? "var(--positive)" : monthsCovered >= 3 ? "var(--viz-savings)" : "var(--negative)";
  const verdict =
    monthsCovered >= 6 ? "Fully funded" : monthsCovered >= 3 ? "Solid floor" : "Below 3 months";
  // Track runs to 6 months; anything beyond simply fills it.
  const fillPct = Math.min(100, (monthsCovered / 6) * 100);
  // What each milestone actually costs — a months figure is a diagnosis, but a
  // dollar figure is something you can set a goal against.
  const targetFor = (months: number) => data.monthlyEssentialCents * months;
  const gapFor = (months: number) => Math.max(0, targetFor(months) - data.balanceCents);

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
          <span className="text-base font-semibold">Emergency fund</span>
        </span>
        {/* Only while collapsed — expanded, the body states both again right
            underneath, and repeating them in the header just reads as noise. */}
        {!open ? (
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-bold tabular-nums" style={{ color: tone }}>
              {monthsCovered.toFixed(1)} mo
            </span>
            <span className="text-xs font-semibold" style={{ color: tone }}>{verdict}</span>
          </span>
        ) : null}
      </button>
      {open ? (
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold tabular-nums" style={{ color: tone }}>
            {monthsCovered.toFixed(1)}
          </span>
          <span className="text-sm text-muted">months of essentials covered</span>
          <span className="ml-auto text-xs font-semibold" style={{ color: tone }}>
            {verdict}
          </span>
        </div>

        <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-line/60">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${fillPct}%`, backgroundColor: tone }}
          />
          {/* 3-month floor marker */}
          <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: "50%" }} aria-hidden />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>0</span>
          <span>3 mo floor</span>
          <span>6 mo</span>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted">
          <span className="font-semibold text-foreground">{formatSavingsMoney(data.balanceCents, currency)}</span>{" "}
          set aside against{" "}
          <span className="font-semibold text-foreground">
            {formatSavingsMoney(data.monthlyEssentialCents, currency)}
          </span>{" "}
          of average monthly bills and expenses
          {data.basisMonths < 3 ? ` (${data.basisMonths}-month basis)` : ""}.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[3, 6].map((months) => {
            const target = targetFor(months);
            const gap = gapFor(months);
            const reached = gap <= 0;
            return (
              <div key={months} className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {months}-month {months === 3 ? "floor" : "target"}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">
                    {formatSavingsMoney(target, currency)}
                  </span>
                </div>
                {/* Target and shortfall only. A "months to get there" figure
                    would need a savings rate for this fund, which isn't
                    recorded anywhere — inventing one would read as advice. */}
                <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: reached ? "var(--positive)" : "var(--muted)" }}>
                  {reached ? (
                    "Reached"
                  ) : (
                    <>
                      <span className="font-semibold" style={{ color: "var(--viz-savings)" }}>
                        {formatSavingsMoney(gap, currency)}
                      </span>{" "}
                      to go
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      ) : null}
    </section>
  );
}

export type ContributionLimitRow = {
  subId: string;
  name: string;
  kind: string;
  /** Which deadline applies — payroll year-end, or the tax filing deadline. */
  capKind: "electiveDeferral" | "ira";
  limitCents: number;
  contributedCents: number;
};

/**
 * Enter the IRS caps for a tax year without a code change.
 *
 * The figures are federal and published each autumn; before this existed a new
 * year meant editing lib/contribution-limits.ts, so the card would go blank on
 * 1 January of any year nobody had compiled in. Prefilled with the current
 * year's caps because the change is usually a few hundred dollars — adjusting
 * a number beats typing one from scratch, and it makes a wrong entry obvious.
 */
function CapsEditor({
  taxYear,
  seed,
  currency,
  onClose,
}: {
  taxYear: number;
  seed: { electiveDeferralCents: number; iraCents: number } | null;
  currency: string;
  onClose: () => void;
}) {
  const [electiveDeferral, setElectiveDeferral] = useState(
    seed ? centsToDisplay(seed.electiveDeferralCents) : "",
  );
  const [ira, setIra] = useState(seed ? centsToDisplay(seed.iraCents) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("taxYear", String(taxYear));
    fd.set("electiveDeferral", electiveDeferral);
    fd.set("ira", ira);
    start(async () => {
      const res = await saveContributionCaps(fd);
      if (res?.error) setError(res.error);
      else onClose();
    });
  };

  return (
    <ModalShell title={`${taxYear} contribution caps`} onClose={onClose} mobileAlign="top">
      <div className="space-y-3 px-5 py-4">
        <p className="text-xs leading-relaxed text-muted">
          Copy the two figures from the IRS page for tax year {taxYear}. They take effect
          immediately and carry over on 1 January.{" "}
          <a
            href={IRS_LIMITS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
            style={{ color: "var(--viz-savings)" }}
          >
            Open the IRS limits ↗
          </a>
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">
            Elective deferral — TSP / 401(k) ({currency})
          </span>
          <input
            value={electiveDeferral}
            onChange={(e) => setElectiveDeferral(e.target.value)}
            inputMode="decimal"
            placeholder="24,500"
            className="w-full rounded-lg bg-background px-3 py-2 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">
            IRA, per person ({currency})
          </span>
          <input
            value={ira}
            onChange={(e) => setIra(e.target.value)}
            inputMode="decimal"
            placeholder="7,500"
            className="w-full rounded-lg bg-background px-3 py-2 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        {error ? <p className="text-xs font-semibold text-negative">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-muted transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            style={{ backgroundColor: "var(--viz-savings)" }}
          >
            {pending ? "Saving…" : `Save ${taxYear} caps`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Annual caps on tax-advantaged accounts. Unused room doesn't roll over, so
// the useful framing is what's left and how long is left to use it.
function ContributionLimits({ rows, currency, year, published, latestYear, pendingYear, seedCaps }: { rows: ContributionLimitRow[]; currency: string; year: number; published: boolean; latestYear: number; pendingYear: number | null; seedCaps: { electiveDeferralCents: number; iraCents: number } | null }) {
  const [state, setState] = useSessionCollapse("savings-contribution-limits", () => ({ open: false }));
  const open = state.open === true;
  // Which tax year the caps editor is open for, or null when it's closed.
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const anyMaxed = rows.some((r) => r.contributedCents >= r.limitCents);
  // The rows are paced to 31 December. An IRA's real cutoff runs months past
  // that, which matters only if the year goes badly — so it's said once, here,
  // instead of on every row where it would soften the target.
  const anyIra = rows.some((r) => r.capKind === "ira");
  const iraGrace = contributionDeadline("ira", year);
  const totalRoom = rows.reduce((s, r) => s + Math.max(0, r.limitCents - r.contributedCents), 0);
  const fmtDeadline = (d: Date) =>
    `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== year ? `, ${d.getFullYear()}` : ""}`;

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
          <span className="text-base font-semibold">Retirement contributions</span>
          {/* The card is collapsed by default, so a reminder that lived only in
              the body could go a whole autumn unseen. This chip is the part
              that has to be visible while collapsed. */}
          {pendingYear ? (
            <span
              className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:bg-white/10"
              style={{ color: "var(--viz-savings)" }}
            >
              {pendingYear} caps due
            </span>
          ) : null}
        </span>
        {/* Deadlines differ per account type, so the header states the room
            only — each row carries its own cutoff date. */}
        <span className="flex items-baseline gap-2 text-xs">
          <span className="font-bold tabular-nums" style={{ color: totalRoom > 0 ? "var(--viz-savings)" : "var(--positive)" }}>
            {totalRoom > 0 ? formatSavingsMoney(totalRoom, currency) : "All maxed"}
          </span>
          {totalRoom > 0 ? <span className="text-muted">still allowed for {year}</span> : null}
        </span>
      </button>

      {open ? (
        <div className="space-y-2.5 px-4 py-3">
          {/* Caps are published per tax year. If this year hasn't been added
              yet, say so and link out rather than measuring against a stale
              figure — a wrong cap is worse than no cap. */}
          {!published ? (
            <div className="rounded-lg bg-background px-3 py-2.5 ring-1 ring-line">
              <p className="text-xs leading-relaxed text-muted">
                Contribution caps for <span className="font-semibold text-foreground">{year}</span>{" "}
                haven&rsquo;t been added yet — the most recent on file are for {latestYear}. Rather
                than measure against last year&rsquo;s figures, this card stays empty until they
                are.{" "}
                <a
                  href={IRS_LIMITS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "var(--viz-savings)" }}
                >
                  Check the current IRS limits ↗
                </a>
              </p>
              <button
                type="button"
                onClick={() => setEditingYear(year)}
                className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                style={{ backgroundColor: "var(--viz-savings)" }}
              >
                Enter {year} caps
              </button>
            </div>
          ) : null}
          {/* From November, next year's figures are published but not yet on
              file here. Asking now means the card never empties itself in
              January; it disappears once the year is added. */}
          {pendingYear ? (
            <div className="rounded-lg bg-background px-3 py-2.5 ring-1 ring-line">
              <p className="text-xs leading-relaxed text-muted">
                The IRS usually publishes {pendingYear}{" "}limits around now. Once they&rsquo;re added,
                this card carries over on 1 January — until then it will show {pendingYear} as
                unpublished rather than measure against {year} figures.{" "}
                <a
                  href={IRS_LIMITS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "var(--viz-savings)" }}
                >
                  Check the {pendingYear} IRS limits ↗
                </a>
              </p>
              <button
                type="button"
                onClick={() => setEditingYear(pendingYear)}
                className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                style={{ backgroundColor: "var(--viz-savings)" }}
              >
                Enter {pendingYear} caps
              </button>
            </div>
          ) : null}
          {rows.map((r) => {
            const pct = r.limitCents > 0 ? Math.min(100, (r.contributedCents / r.limitCents) * 100) : 0;
            const room = Math.max(0, r.limitCents - r.contributedCents);
            const maxed = room <= 0;
            // Every row is paced to 31 December, so the goal finishes inside
            // the tax year it belongs to. An IRA can legally be funded until
            // about 15 April, but treating that as the target stretches a
            // 12-month goal to 16 and quietly lowers the monthly figure — it's
            // a fallback for a bad year, so it's stated once in the footnote
            // rather than built into the pace.
            const monthsLeft = monthsUntilDeadline("electiveDeferral", year);
            const deadline = contributionDeadline("electiveDeferral", year);
            const perMonth = monthsLeft > 0 ? Math.ceil(room / monthsLeft) : room;
            return (
              <div key={r.subId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <span className="text-xs tabular-nums text-muted">
                    <span className="font-semibold text-foreground">
                      {formatSavingsMoney(r.contributedCents, currency)}
                    </span>{" "}
                    of {formatSavingsMoney(r.limitCents, currency)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: maxed ? "var(--positive)" : "var(--viz-savings)",
                    }}
                  />
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  <span className="uppercase tracking-wide">{r.kind}</span>
                  {" · "}
                  {maxed ? (
                    <span style={{ color: "var(--positive)" }}>Maxed for {year}</span>
                  ) : (
                    <>
                      Can still add{" "}
                      <span className="font-semibold tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {formatSavingsMoney(room, currency)}
                      </span>{" "}
                      {/* The date is the useful part. "5 mo" alone doesn't say
                          five months until what — and the two account types
                          don't even share a cutoff. */}
                      by {fmtDeadline(deadline)}
                      {monthsLeft > 0 ? (
                        <>
                          {" — "}
                          <span className="tabular-nums">
                            {formatSavingsMoney(perMonth, currency)}/mo
                          </span>{" "}
                          over the {monthsLeft} month{monthsLeft === 1 ? "" : "s"} left
                        </>
                      ) : null}
                    </>
                  )}
                </p>
              </div>
            );
          })}
          {published ? (
            <p className="border-t border-line/60 pt-2 text-[11px] leading-relaxed text-muted">
              {anyIra ? (
                <>
                  Targets run to Dec 31 — IRA money still counts toward {year} until about{" "}
                  <span className="font-semibold text-foreground">{fmtDeadline(iraGrace)}</span>,
                  TSP doesn&rsquo;t.{" "}
                </>
              ) : null}
              Caps are per person across all IRAs, before catch-up.
              {anyMaxed ? " Over-contributing is correctable but taxable." : ""}{" "}
              <a
                href={IRS_LIMITS_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                {year} IRS limits ↗
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {editingYear !== null ? (
        <CapsEditor
          taxYear={editingYear}
          seed={seedCaps}
          currency={currency}
          onClose={() => setEditingYear(null)}
        />
      ) : null}
    </section>
  );
}

export function SavingsBoard({
  cards,
  currency,
  contributionLimits = [],
  capYear = new Date().getFullYear(),
  capsPublished = true,
  latestCapYear: latestCapYearProp = capYear,
  pendingCapYear = null,
  seedCaps = null,
  emergencyFund,
  incomeReceivedCents,
  currentMonthKey,
  currentMonthLabel,
  firstOfMonth,
  withdrawalSubOptions,
  withdrawalAccountOptions,
  withdrawalPayeeOptions,
}: Props) {
  const familyCards = cards.filter((card) => !card.isKids);
  const kidsCards = cards.filter((card) => card.isKids);
  const [scope, setScope] = useState<Scope>(familyCards.length > 0 ? "family" : "all");
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const scopedCards = scope === "family" ? familyCards : scope === "kids" ? kidsCards : cards;
  const stats = statsFor(scopedCards);
  const savingsRate = incomeReceivedCents > 0 ? (stats.net / incomeReceivedCents) * 100 : null;

  const recentActivity = useMemo(
    () => scopedCards
      .flatMap((card) => card.transactions
        .filter((transaction) => transaction.date.startsWith(currentMonthKey))
        .map((transaction) => ({ ...transaction, goalName: card.name })))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 6),
    [currentMonthKey, scopedCards],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="pr-8 md:pr-0">
        <h1 className="text-2xl font-bold tracking-tight">Savings goals</h1>
        <p className="mt-1 text-sm text-muted">See what you saved from income, where it went, and what needs attention next.</p>
      </header>

      {cards.length === 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="px-4 py-8 text-center text-sm text-muted">
            No Savings items yet — add one in the Savings group on the Budget tab, then set its Goal there to see it here.
          </p>
        </section>
      ) : (
        <>
          {/* Two independent readouts of the same question — are the long-term
              pots on track — so they sit side by side on desktop and stack on
              mobile. `items-start` keeps each card at its own height rather
              than stretching the collapsed one to match the expanded one. */}
          {emergencyFund || contributionLimits.length > 0 || !capsPublished ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {emergencyFund ? <EmergencyFundCard data={emergencyFund} currency={currency} /> : null}
              {contributionLimits.length > 0 || !capsPublished ? (
                <ContributionLimits
                  rows={contributionLimits}
                  currency={currency}
                  year={capYear}
                  published={capsPublished}
                  latestYear={latestCapYearProp}
                  pendingYear={pendingCapYear}
                  seedCaps={seedCaps}
                />
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
            <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-brand-soft/35 px-4 py-3 dark:bg-brand-soft/15">
                <div>
                  <h2 className="text-base font-semibold">{currentMonthLabel}</h2>
                  <p className="text-xs text-muted">Savings activity from received income</p>
                </div>
                {kidsCards.length > 0 && familyCards.length > 0 ? (
                  <div className="flex items-center text-xs">
                    <div className="inline-flex rounded-lg bg-surface p-1 ring-1 ring-black/5 dark:ring-white/10">
                      <ScopeButton active={scope === "family"} onClick={() => setScope("family")}>Family</ScopeButton>
                      <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>With kids</ScopeButton>
                    </div>
                    <div className="ml-2 border-l border-line/70 pl-2">
                      <ScopeButton active={scope === "kids"} onClick={() => setScope("kids")} className={scope === "kids" ? "border border-brand bg-brand text-white shadow-sm" : "border border-brand/35 bg-surface text-brand shadow-sm hover:bg-brand-soft hover:text-brand"}>Kids only</ScopeButton>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 divide-y divide-line/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Metric label="Of income" value={savingsRate == null ? "—" : `${savingsRate.toFixed(1)}%`} detail={`${formatSavingsMoney(incomeReceivedCents, currency)} received`} tone={savingsRate != null && savingsRate > 0 ? "text-positive" : undefined} />
                <Metric label="This month’s savings" value={stats.planned > 0 ? `${Math.max(0, stats.planPct).toFixed(0)}% of plan` : "No plan"} detail={<><span className={stats.net >= 0 ? "text-positive" : "text-negative"}>{formatSavingsMoney(stats.net, currency)} saved</span> of {formatSavingsMoney(stats.planned, currency)} planned</>} />
                <Metric label="Withdrawn" value={formatSavingsMoney(stats.withdrawals, currency)} detail={stats.withdrawals > 0 ? "moved out of goals" : "no withdrawals"} tone={stats.withdrawals > 0 ? "text-negative" : undefined} action={<button type="button" onClick={() => setWithdrawalOpen(true)} className="mt-2 rounded-md border border-brand/35 px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-brand">Withdraw funds</button>} />
              </div>

              <div className="space-y-2 border-t border-line/70 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">Overall goal progress</span>
                  <span className="tabular-nums text-muted"><span className="text-positive">{formatSavingsMoney(stats.saved, currency)}</span> of {formatSavingsMoney(stats.goal, currency)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line/60">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, stats.goalPct))}%`, backgroundColor: "var(--viz-savings)" }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
                  <span>{Math.min(100, Math.max(0, stats.goalPct)).toFixed(1)}% complete</span>
                  <span className="text-negative">{formatSavingsMoney(stats.left, currency)} left</span>
                </div>
              </div>

            </section>

            <ActivityPanel activity={recentActivity} currency={currency} monthLabel={currentMonthLabel} />
          </div>

          <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-brand-soft/35 px-4 py-3 dark:bg-brand-soft/15">
              <div>
                <h2 className="text-base font-semibold">Savings and investment goals</h2>
                <p className="text-xs text-muted">Select a goal to see its details and transactions.</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{cards.length} goal{cards.length === 1 ? "" : "s"}</span>
            </div>
            <div className="space-y-3 px-3 py-3">
              {familyCards.length > 0 ? <GoalGroup title="Family goals" cards={familyCards} currency={currency} incomeReceivedCents={incomeReceivedCents} /> : null}
              {kidsCards.length > 0 ? <GoalGroup title="Kids funding" cards={kidsCards} currency={currency} incomeReceivedCents={incomeReceivedCents} /> : null}
            </div>
          </section>

          {withdrawalOpen ? (
            <div className="fixed inset-0 z-[70] flex min-h-0 items-stretch justify-center overflow-hidden overscroll-none bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
              <div className="w-full sm:max-w-[520px]">
                <TransactionModal
                  editTx={null}
                  monthKey={currentMonthKey}
                  firstOfMonth={firstOfMonth}
                  subOptions={withdrawalSubOptions}
                  accountOptions={withdrawalAccountOptions}
                  payeeOptions={withdrawalPayeeOptions}
                  initialKind="savings"
                  initialIsWithdrawal
                  restrictToInitialKind
                  onClose={() => setWithdrawalOpen(false)}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ScopeButton({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-md px-2.5 py-1 font-medium transition ${className ?? (active ? "bg-brand text-white shadow-sm" : "text-muted hover:text-foreground")}`}>{children}</button>;
}

function Metric({ label, value, detail, tone, action }: { label: string; value: string; detail?: React.ReactNode; tone?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-3 py-3.5 text-center sm:px-4">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-xs leading-tight text-foreground sm:text-sm">{detail}</p> : null}
      {action}
    </div>
  );
}

type Activity = SavingsTxData & { goalName: string };

function ActivityPanel({ activity, currency, monthLabel: label }: { activity: Activity[]; currency: string; monthLabel: string }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="border-b border-line/70 px-4 py-3"><h2 className="text-sm font-semibold">Recent activity</h2><p className="text-xs text-muted">Deposits and withdrawals in {label}</p></div>
      {activity.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center px-5 py-5 text-center"><div><div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>↗</div><p className="text-sm font-medium">No savings activity yet</p><p className="mt-1 text-xs text-muted">Savings transactions will appear here automatically.</p></div></div>
      ) : (
        <ul className="divide-y divide-line/60">
          {activity.map((transaction) => (
            <li key={transaction.id} className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${transaction.isWithdrawal ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive"}`} aria-hidden>{transaction.isWithdrawal ? "↓" : "↑"}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{transaction.goalName}</span><span className="block truncate text-[10px] text-muted">{shortDate(transaction.date)} · {transaction.payee ?? transaction.accountName ?? "Savings activity"}</span></span>
              <span className={`shrink-0 font-semibold tabular-nums ${transaction.isWithdrawal ? "text-negative" : "text-positive"}`}>{transaction.isWithdrawal ? "−" : ""}{formatSavingsMoney(transaction.amountCents, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GoalGroup({ title, cards, currency, incomeReceivedCents }: { title: string; cards: SavingsCardData[]; currency: string; incomeReceivedCents: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line/80">
      <div className="border-b border-line/70 bg-brand-soft/25 px-4 py-2 text-xs font-semibold text-muted dark:bg-brand-soft/10">{title}</div>
      <div className="divide-y divide-line/60">{cards.map((card) => <SavingsGoalRow key={card.id} card={card} currency={currency} incomeReceivedCents={incomeReceivedCents} />)}</div>
    </div>
  );
}

function SavingsGoalRow({ card, currency, incomeReceivedCents }: { card: SavingsCardData; currency: string; incomeReceivedCents: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasGoal = card.goalCents > 0;
  const progress = hasGoal ? Math.min(100, Math.max(0, (card.savedCents / card.goalCents) * 100)) : 0;
  const incomeRate = incomeReceivedCents > 0 ? (card.monthNetCents / incomeReceivedCents) * 100 : null;

  return (
    <div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="grid w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-brand-soft/20 md:grid-cols-[minmax(210px,1.2fr)_130px_minmax(220px,1fr)_100px_18px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="block min-w-0 flex-1 truncate text-sm font-semibold">{card.name}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted transition-transform md:hidden ${expanded ? "rotate-90" : ""}`} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          </span>
          <StatusBadge pace={card.pace} hasGoal={hasGoal} />
        </span>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[10px] text-muted">This month</span>
          <span className={`text-sm font-semibold tabular-nums ${card.monthNetCents >= 0 ? "text-positive" : "text-negative"}`}>{card.monthNetCents < 0 ? "−" : ""}{formatSavingsMoney(Math.abs(card.monthNetCents), currency)}</span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[10px] text-muted"><span>{hasGoal ? `${progress.toFixed(0)}% complete` : "No goal set"}</span><span className="truncate tabular-nums">{hasGoal ? <><span className="text-positive">{formatSavingsMoney(card.savedCents, currency)}</span> / {formatSavingsMoney(card.goalCents, currency)}</> : <span className="text-positive">{formatSavingsMoney(card.savedCents, currency)}</span>}</span></span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line/60"><span className={`block h-full rounded-full ${card.pace === "reached" ? "bg-positive" : ""}`} style={{ width: `${progress}%`, ...(card.pace === "reached" ? {} : { backgroundColor: "var(--viz-savings)" }) }} /></span>
        </span>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap"><span className="text-[10px] text-muted">Of income</span><span className="text-sm font-semibold tabular-nums">{incomeRate == null ? "—" : `${incomeRate.toFixed(1)}%`}</span></span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`hidden text-muted transition-transform md:block ${expanded ? "rotate-90" : ""}`} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
      </button>

      {expanded ? (
        <div className="border-t border-line/60 bg-canvas/35 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Detail label="Start" value={formatSavingsMoney(card.startCents, currency)} />
            <Detail label="Planned this month" value={formatSavingsMoney(card.plannedCents, currency)} />
            <Detail label="Left to save" value={hasGoal ? formatSavingsMoney(Math.max(0, card.leftToSaveCents), currency) : "—"} />
            <Detail label="Target / pace" value={card.targetDate ? monthLabel(card.targetDate) : "No target date"} sub={card.requiredMonthlyCents != null && card.pace !== "reached" ? `${formatSavingsMoney(card.requiredMonthlyCents, currency)}/mo needed` : undefined} />
          </div>

          <GoalEditor card={card} currency={currency} />
          <div className="mt-3 overflow-hidden rounded-xl bg-surface ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-line/60 px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent transactions</p><span className="text-[10px] text-muted">Up to 12</span></div>
            {card.transactions.length === 0 ? <p className="px-3 py-4 text-center text-xs text-muted">No transactions yet</p> : (
              <ul className="divide-y divide-line/50">
                {card.transactions.map((transaction) => (
                  <li key={transaction.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs">
                    <span className="tabular-nums text-muted">{shortDate(transaction.date)}</span>
                    <span className="min-w-0"><span className="block truncate">{transaction.payee ?? "Savings activity"}</span>{transaction.accountName ? <span className="block truncate text-[10px] text-muted">{transaction.accountName}</span> : null}</span>
                    <span className={`font-semibold tabular-nums ${transaction.isWithdrawal ? "text-negative" : "text-positive"}`}>{transaction.isWithdrawal ? "−" : ""}{formatSavingsMoney(transaction.amountCents, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Goal amount, monthly contribution and target date, editable here rather than
// via a round trip to Budget. Writes through a narrow action that preserves
// the opening balance this form doesn't manage.
function GoalEditor({ card, currency }: { card: SavingsCardData; currency: string }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(centsToDisplay(card.goalCents));
  const [monthly, setMonthly] = useState(centsToDisplay(card.monthlyCents));
  const [targetDate, setTargetDate] = useState(card.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setGoal(centsToDisplay(card.goalCents));
          setMonthly(centsToDisplay(card.monthlyCents));
          setTargetDate(card.targetDate ?? "");
          setSaved(false);
          setError(null);
          setOpen(true);
        }}
        className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
        style={{ backgroundColor: "var(--viz-savings)" }}
      >
        {card.goalCents > 0 ? "Edit goal" : "Set a goal"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-surface p-3 ring-1 ring-black/5 dark:ring-white/10">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {card.name} goal
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Goal amount</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg bg-background px-2.5 py-2 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Monthly contribution</span>
          <input
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg bg-background px-2.5 py-2 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Target date</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full rounded-lg bg-background px-2.5 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <p className="mr-auto text-xs text-negative">{error}</p>
        ) : saved ? (
          <p className="mr-auto text-xs font-semibold" style={{ color: "var(--positive)" }}>
            Saved.
          </p>
        ) : (
          <p className="mr-auto text-[11px] text-muted">
            Opening balance of {formatSavingsMoney(card.startCents, currency)} is left unchanged.
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set("subcategoryId", card.id);
            fd.set("goal", goal);
            fd.set("monthly", monthly);
            fd.set("targetDate", targetDate);
            start(async () => {
              const res = await updateSavingsGoalFields(fd);
              if (res?.error) setError(res.error);
              else {
                setSaved(true);
                setOpen(false);
              }
            });
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--viz-savings)" }}
        >
          {pending ? "Saving…" : "Save goal"}
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg bg-surface px-3 py-2 ring-1 ring-black/5 dark:ring-white/10"><p className="text-[10px] text-muted">{label}</p><p className="mt-0.5 truncate text-xs font-semibold tabular-nums">{value}</p>{sub ? <p className="mt-0.5 truncate text-[10px] text-muted">{sub}</p> : null}</div>;
}

function StatusBadge({ pace, hasGoal }: { pace: SavingsCardData["pace"]; hasGoal: boolean }) {
  if (!hasGoal) return <span className="text-[10px] font-medium text-muted">No goal</span>;
  const badges: Record<SavingsCardData["pace"], { label: string; className: string } | null> = {
    none: null,
    reached: { label: "✓ Reached", className: "text-positive" },
    on_track: { label: "✓ On track", className: "text-positive" },
    behind: { label: "Behind pace", className: "text-negative" },
    overdue: { label: "Overdue", className: "text-negative" },
  };
  const badge = badges[pace];
  return badge ? <span className={`text-[10px] font-medium ${badge.className}`}>{badge.label}</span> : <span />;
}
