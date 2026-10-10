"use client";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MINUS, centsToGroupedDisplay, currencySymbol, formatMoney, formatMoneyWhole } from "@/lib/money";
import { useRegisterMobilePageActions } from "@/lib/mobile-page-actions";
import {
  TAX_COLOR,
  TAX_LABEL,
  TAX_MEANING,
  resolveTaxTreatment,
  type TaxTreatment,
} from "@/lib/tax-treatment";
import { setInvestmentYear, transferFromInvestment } from "./actions";
import { ImportInvestmentModal } from "./import-modal";
import { AddMonthForm, AddHoldingsForm } from "./manual-entry";
import { AllHoldingsTable } from "./holdings-rollup";
import { describeUpdate } from "@/lib/updated-ago";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { SavingsPanel, type SavingsPanelProps } from "./savings-panel";
import { useScrollLock } from "@/lib/use-scroll-lock";

export type YearCell = {
  year: number;
  startBalanceCents: number | null;
  endBalanceCents: number | null;
  /** The 31-December close. Null until the year actually ends. */
  closeBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
  /** Gains was typed by hand, so the automatic maths leaves it alone. */
  accruedManual?: boolean;
  stored: boolean;
  /** Contributed came from the transaction ledger, so it can't be typed over. */
  contribFromLedger?: boolean;
  /** January's deposits already inside `startBalanceCents` (the year opened on
   *  January's close), so growth must not subtract them again. */
  openingContribCents?: number;
};

export type BucketRow = {
  id: string;
  name: string;
  holder: string | null;
  balanceCents: number;
  /** Stored tax override; null = infer from the name. */
  taxTreatment: string | null;
  cells: Record<number, YearCell>;
};

export type InvestAccount = {
  id: string;
  name: string;
  holder: string | null;
  subtype: string | null;
  /** Stored tax override; null = infer from the subtype. */
  taxTreatment: string | null;
  balanceCents: number;
  isKids: boolean;
  sortOrder: number;
  cells: Record<number, YearCell>;
  buckets: BucketRow[];
};

export type InvestmentPositionImportRow = {
  id: string;
  asOfDate: string;
  symbol: string | null;
  securityName: string;
  quantity: number | null;
  priceCents: number | null;
  marketValueCents: number;
  costBasisCents: number | null;
  unrealizedGainCents: number | null;
  unrealizedGainPercent: number | null;
  url: string | null;
  /** When the row was last written (added, imported or edited) — drives the
   *  "Updated … days ago" line. Not the statement date; that's asOfDate. */
  updatedAt: string;
};

export type InvestmentPerformanceImportRow = {
  asOfDate: string;
  entrySource: "csv" | "manual";
  beginningBalanceCents: number | null;
  contributionsCents: number | null;
  withdrawalsCents: number | null;
  dividendsCents: number | null;
  feesCents: number | null;
  marketChangeCents: number | null;
  endingBalanceCents: number;
  /** When the month was last written. Saving a month replaces its row, so
   *  created_at is that time — no separate updated_at is needed here. */
  updatedAt: string;
};

/** A bucket already names its brokerage, so it stands alone; otherwise the account does. */
export const ledgerLabel = (accountName: string, bucketName: string | null) => bucketName ?? accountName;

export type InvestmentImportView = {
  id: string;
  accountId: string;
  bucketId: string | null;
  accountName: string;
  bucketName: string | null;
  provider: string;
  importKind: "positions" | "performance";
  asOfDate: string;
  sourceFilename: string | null;
  rowCount: number;
  createdAt: string;
  positions: InvestmentPositionImportRow[];
  performance: InvestmentPerformanceImportRow[];
};

// Roll up an account's cell + all its bucket cells for a given year. Historical
// CSV seed values live at the account level (bucket_id NULL); going-forward
// per-bucket edits and transactions add on top. Chart/summary/parent-row use
// this effective total; the underlying slots stay editable individually.
function effectiveCell(a: InvestAccount, year: number): YearCell {
  const parent = a.cells[year];
  let contributed = parent?.contributedCents ?? 0;
  let accrued = parent?.accruedCents ?? 0;
  let start = parent?.startBalanceCents ?? null;
  let end = parent?.endBalanceCents ?? null;
  let close = parent?.closeBalanceCents ?? null;
  let manual = !!parent?.accruedManual;
  let openingContrib = parent?.openingContribCents ?? 0;
  for (const b of a.buckets) {
    const c = b.cells[year];
    if (!c) continue;
    contributed += c.contributedCents;
    openingContrib += c.openingContribCents ?? 0;
    accrued += c.accruedCents;
    if (c.accruedManual) manual = true;
    if (c.startBalanceCents != null) start = (start ?? 0) + c.startBalanceCents;
    if (c.endBalanceCents != null) end = (end ?? 0) + c.endBalanceCents;
    if (c.closeBalanceCents != null) close = (close ?? 0) + c.closeBalanceCents;
  }
  // Gains for the whole account is worked out from the account's own opening,
  // close and contributions — not by adding up its parts. A split account can
  // open on the account slot and close on its buckets (TSP, split mid-2026),
  // and summing the parts there would report zero growth. Deposits already
  // inside a January opening are left out, the same as each part's own cell.
  if (!manual && start != null && end != null) accrued = end - start - (contributed - openingContrib);

  return {
    year,
    startBalanceCents: start,
    endBalanceCents: end,
    closeBalanceCents: close,
    contributedCents: contributed,
    accruedCents: accrued,
    accruedManual: manual,
    stored: !!(parent?.stored ?? false),
  };
}

/**
 * What an account holds right now. Buckets own the balance when they exist —
 * the account slot is then a container, and adding it would double-count.
 */
function liveBalanceCents(a: InvestAccount): number {
  if (a.buckets.length > 0) return a.buckets.reduce((sum, b) => sum + b.balanceCents, 0);
  return a.balanceCents;
}

export type DestAccount = { id: string; name: string; buckets: { id: string; name: string }[] };

export type BoardTab = "portfolio" | "savings";

type Props = {
  accounts: InvestAccount[];
  years: number[]; // newest first
  currency: string;
  destAccounts: DestAccount[];
  imports: InvestmentImportView[];
  /** Net contributions logged into investment accounts this calendar month. */
  contributedThisMonthCents: number;
  currentMonthLabel: string;
  /** Which tab the URL asked for, resolved on the server so there is no flash. */
  initialTab: BoardTab;
  savings: SavingsPanelProps;
};

// ---- Tax treatment ------------------------------------------------------
//
// The rules (labels, colours, meanings, inference, override precedence) live
// in @/lib/tax-treatment so /accounts can show the same answer next to its
// editor. Only the local convenience wrapper stays here.
//
// A holding's treatment now comes from a stored override first and its name
// second — bucket before account, because bucket is the more specific label.
// Fidelity is exactly why: its subtype is "Brokerage", but it holds a taxable
// bucket alongside two Roth buckets, so classifying by account alone would
// file all three as taxable.
function taxFor(
  accountSubtype: string | null,
  bucketName?: string | null,
  accountOverride?: string | null,
  bucketOverride?: string | null,
): TaxTreatment {
  return resolveTaxTreatment({ bucketOverride, bucketName, accountOverride, accountSubtype }).treatment;
}

/**
 * Rounds a list of cent amounts to whole dollars that still add up to the
 * rounded total (largest remainder), so a breakdown never sits a dollar off
 * the figure above it.
 */
function wholeDollarsSummingToTotal(cents: number[]): number[] {
  const floors = cents.map((c) => Math.floor(c / 100));
  let short = Math.round(cents.reduce((sum, c) => sum + c, 0) / 100) - floors.reduce((a, b) => a + b, 0);
  const byRemainder = cents.map((c, i) => ({ i, rem: c / 100 - floors[i] })).sort((x, y) => y.rem - x.rem);
  for (const { i } of byRemainder) {
    if (short <= 0) break;
    floors[i] += 1;
    short -= 1;
  }
  return floors.map((d) => d * 100);
}

const gainTone = (cents: number) =>
  cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "text-foreground";

// The year's return: gains ÷ the balance the year opened on, as a percent.
// Simple (ignores when in the year deposits landed), and null without an
// opening balance — years before 2026 have none recorded, so they stay blank
// rather than showing a made-up figure. Replaced "gain vs contrib" (gains −
// deposits), which put Fidelity in red at −$3,928 in a year it gained $8,174.
function returnPct(startCents: number | null, accruedCents: number): number | null {
  if (startCents == null || startCents <= 0) return null;
  return (accruedCents / startCents) * 100;
}

const formatPct = (pct: number) => `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

export function InvestBoard({
  accounts,
  years,
  currency,
  destAccounts,
  imports,
  contributedThisMonthCents,
  currentMonthLabel,
  initialTab,
  savings,
}: Props) {
  const [tab, setTab] = useState<BoardTab>(initialTab);
  // The page is pinned to the current year. A picker used to scope the
  // Investments table, but the only column with history behind it is Contrib,
  // and the Performance-by-year chart already plots every year side by side —
  // paging the table one year at a time said nothing the chart didn't.
  const year = years[0] ?? new Date().getFullYear();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  // One switch for all three hero breakdowns: opening any opens them all, so
  // the cards stay side by side.
  const [showBreakdowns, setShowBreakdowns] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  // Tax bands picked in "How it's taxed". Empty = no filter. They narrow the
  // chart and the holdings list beside it.
  const [taxPick, setTaxPick] = useState<TaxTreatment[]>([]);

  const mine = accounts.filter((a) => !a.isKids);
  const selectedAccount = selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null;

  // The chart's accounts for the picked bands. An account whose holdings are
  // all in the picked bands goes in whole. A split account with only some
  // buckets in them keeps just those buckets — its pre-split years sit on the
  // account itself, mixed across bands, so they can't be shared out and are
  // left off.
  const taxChart = useMemo(() => {
    if (taxPick.length === 0) return mine;
    const picked = new Set(taxPick);
    const out: InvestAccount[] = [];
    for (const a of mine) {
      if (a.buckets.length === 0) {
        if (picked.has(taxFor(a.subtype, null, a.taxTreatment, null))) out.push(a);
        continue;
      }
      const inBand = a.buckets.filter((b) => picked.has(taxFor(a.subtype, b.name, a.taxTreatment, b.taxTreatment)));
      if (inBand.length === a.buckets.length) out.push(a);
      else if (inBand.length > 0) out.push({ ...a, cells: {}, buckets: inBand });
    }
    return out;
  }, [mine, taxPick]);
  const chartAccounts = selectedAccount ? [selectedAccount] : taxChart;

  // The tab lives in the URL so /savings can deep-link straight to it and a
  // reload keeps the view. `history.replaceState` rather than a router
  // navigation: this is a pure view toggle, and routing would re-run the
  // server component and refetch the whole page for nothing.
  const selectTab = (next: BoardTab) => {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "portfolio") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  // Summary totals for the selected year (used in hero + stats bar).
  const summary = useMemo(() => {
    let contributed = 0;
    let gains = 0;
    let current = 0;
    for (const a of mine) {
      const c = effectiveCell(a, year);
      contributed += c.contributedCents;
      gains += c.accruedCents;
      // A year with no stored ending balance falls back to today's balance
      // rather than contributing nothing — 2025 has no end_cents on file for
      // any account, which made this tile read $0.00 for the whole year.
      current += c.endBalanceCents ?? liveBalanceCents(a);
    }
    const accountCount = mine.reduce((sum, a) => sum + (a.buckets.length > 0 ? a.buckets.length : 1), 0);
    return { contributed, gains, current, accountCount };
  }, [mine, year]);

  // This year's contributions, holding by holding, sorted into retirement
  // accounts (tax-free or tax-deferred) and taxable ones. Read per slot — a
  // bucket's own treatment, else the account's — so Fidelity's taxable bucket
  // and its Roths land on opposite sides. Whole dollars by largest remainder,
  // so the lines add up to the card's rounded total instead of a dollar off.
  const investedSplit = useMemo(() => {
    // A bucket that names its account ("Fidelity Roth Vic", "TSP Roth") keeps
    // its own line; one that doesn't ("Kraken", "River") is shown as its
    // account ("Crypto"), and lines that end up with the same name and side
    // are added together.
    const exact: { label: string; cents: number; retirement: boolean }[] = [];
    const add = (label: string, t: TaxTreatment, cents: number) => {
      if (cents === 0) return;
      const retirement = t !== "taxable";
      const same = exact.find((r) => r.label === label && r.retirement === retirement);
      if (same) same.cents += cents;
      else exact.push({ label, cents, retirement });
    };
    for (const a of mine) {
      add(a.name, taxFor(a.subtype, null, a.taxTreatment, null), a.cells[year]?.contributedCents ?? 0);
      for (const b of a.buckets) {
        const label = b.name.toLowerCase().includes(a.name.toLowerCase()) ? ledgerLabel(a.name, b.name) : a.name;
        add(label, taxFor(a.subtype, b.name, a.taxTreatment, b.taxTreatment), b.cells[year]?.contributedCents ?? 0);
      }
    }
    exact.splice(0, exact.length, ...exact.filter((r) => r.cents !== 0));
    const whole = wholeDollarsSummingToTotal(exact.map((r) => r.cents));
    const rows = exact
      .map((r, i) => ({ label: r.label, retirement: r.retirement, cents: whole[i] }))
      .sort((x, y) => y.cents - x.cents);
    const retirement = rows.filter((r) => r.retirement);
    const taxable = rows.filter((r) => !r.retirement);
    const sum = (list: typeof rows) => list.reduce((t, r) => t + r.cents, 0);
    return {
      groups: [
        { name: "Retirement", cents: sum(retirement), rows: retirement },
        { name: "Taxable", cents: sum(taxable), rows: taxable },
      ].filter((g) => g.rows.length > 0),
    };
  }, [mine, year]);

  // This year's gain account by account — whole accounts, since a split
  // account's gain is measured on the account (TSP's buckets carry none of
  // their own) — biggest first, rounded to add up to the card's total.
  const gainsByAccount = useMemo(() => {
    const exact = mine
      .map((a) => ({ name: a.name, cents: effectiveCell(a, year).accruedCents }))
      .filter((r) => r.cents !== 0);
    const whole = wholeDollarsSummingToTotal(exact.map((r) => r.cents));
    return exact.map((r, i) => ({ name: r.name, cents: whole[i] })).sort((x, y) => y.cents - x.cents);
  }, [mine, year]);

  // Current balances grouped by tax treatment. Uses live balances (not the
  // year grid) because "what do I hold, and how is it taxed" is a question
  // about today, not about a historical contribution year.
  const taxSplit = useMemo(() => {
    const totals = new Map<TaxTreatment, number>();
    // Which holdings landed in each band. The treatment is inferred from a
    // name, so the inference has to be inspectable — otherwise a
    // misclassified account is invisible until it costs real tax money.
    const holdings = new Map<TaxTreatment, { name: string; cents: number }[]>();
    let total = 0;
    const add = (t: TaxTreatment, name: string, cents: number) => {
      totals.set(t, (totals.get(t) ?? 0) + cents);
      holdings.set(t, [...(holdings.get(t) ?? []), { name, cents }]);
      total += cents;
    };
    for (const a of mine) {
      if (a.buckets.length > 0) {
        for (const b of a.buckets) {
          add(
            taxFor(a.subtype, b.name, a.taxTreatment, b.taxTreatment),
            `${a.name} · ${b.name}`,
            b.balanceCents,
          );
        }
      } else {
        add(taxFor(a.subtype, null, a.taxTreatment, null), a.name, a.balanceCents);
      }
    }
    const rows = (["taxable", "deferred", "free", "education"] as TaxTreatment[])
      .map((t) => ({
        treatment: t,
        cents: totals.get(t) ?? 0,
        holdings: (holdings.get(t) ?? []).sort((x, y) => y.cents - x.cents),
      }))
      .filter((r) => r.cents > 0)
      .sort((a, b) => b.cents - a.cents);
    return { rows, total };
  }, [mine]);

  // Where the money actually sits, by holding. Built from account and bucket
  // balances — which are complete — rather than from imported positions, which
  // currently cover only part of the portfolio; a symbol-level chart drawn from
  // partial imports would misrepresent the whole as whichever slice happens to
  // have been imported.
  const allocation = useMemo(() => {
    const rows: { label: string; cents: number; accountId: string; treatment: TaxTreatment }[] = [];
    for (const a of mine) {
      if (a.buckets.length > 0) {
        for (const b of a.buckets) {
          // A bucket name already carries its brokerage ("Fidelity (Taxable)
          // Vic"), so prefixing the account repeats it. Same rule as ledgerLabel.
          if (b.balanceCents > 0) rows.push({ label: ledgerLabel(a.name, b.name), cents: b.balanceCents, accountId: a.id, treatment: taxFor(a.subtype, b.name, a.taxTreatment, b.taxTreatment) });
        }
      } else if (a.balanceCents > 0) {
        rows.push({ label: a.name, cents: a.balanceCents, accountId: a.id, treatment: taxFor(a.subtype, null, a.taxTreatment, null) });
      }
    }
    const total = rows.reduce((s, r) => s + r.cents, 0);
    rows.sort((a, b) => b.cents - a.cents);
    return { rows, total, top: rows[0] ?? null };
  }, [mine]);
  const showAllocation = allocation.rows.length > 1 && allocation.total > 0;
  // The holdings list follows the picked tax bands; its total is theirs.
  const shownAllocation = useMemo(() => {
    if (taxPick.length === 0) return allocation;
    const rows = allocation.rows.filter((r) => taxPick.includes(r.treatment));
    return { ...allocation, rows, total: rows.reduce((s, r) => s + r.cents, 0) };
  }, [allocation, taxPick]);
  const toggleTax = (t: TaxTreatment) => {
    // A holding picked in the list would hide the band filter on the chart,
    // so picking a band clears it.
    setSelectedId(null);
    setTaxPick((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  // What's still owed to this year's investment goals (Savings tab), fund by
  // fund: a fund past its goal doesn't make up for one behind. Kids' funds
  // are out, as they are from the contributed figure above it; cash goals
  // like Real Estate live in savings buckets and are out too.
  const investGoals = (savings.cards ?? []).filter((c) => c.isInvestment && !c.isKids && c.goalCents > 0);
  const leftToGoalCents = investGoals.reduce((sum, c) => sum + Math.max(0, c.leftToSaveCents), 0);
  // Pace, from the same per-goal check the Savings tab runs: behind if any
  // fund is behind or past its date, with what those funds need each month.
  const behindGoals = investGoals.filter((c) => c.pace === "behind" || c.pace === "overdue");
  const behindMonthlyCents = behindGoals.reduce((sum, c) => sum + (c.requiredMonthlyCents ?? 0), 0);

  // Retirement contribution room, read straight off the rows the Savings tab
  // renders so the two figures can never disagree.
  const capYear = savings.capYear ?? new Date().getFullYear();
  const limitRows = savings.contributionLimits ?? [];
  const contributionRoomRows = limitRows.length;
  const contributionLimitCents = limitRows.reduce((sum, r) => sum + r.limitCents, 0);
  const contributionRoomCents = limitRows.reduce(
    (sum, r) => sum + Math.max(0, r.limitCents - r.contributedCents),
    0,
  );

  useRegisterMobilePageActions([
    { label: "Transfer/Withdraw", onSelect: () => setShowTransfer(true) },
    { label: "How investment tracking works", onSelect: () => setShowGuide((open) => !open) },
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-6 px-4 py-7">
      {/* Header: title + one Transfer/Withdraw entry + hero stats + tabs */}
      <header className="space-y-4">
        {/* Title and its one action share a row. Below md the action lives in
            the ⋯ menu instead (registered above) — title and button don't fit
            one line on a phone, and a button row of its own pushed the numbers
            down. */}
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Invest / Savings</h1>
          <button
            type="button"
            onClick={() => setShowTransfer(true)}
            className="hidden items-center md:flex gap-1.5 rounded-lg bg-brand-soft px-3 py-2 text-sm font-bold text-brand ring-1 ring-brand/20 transition hover:bg-brand-soft/80"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17l10-10M17 7v10M17 7H7" />
            </svg>
            Transfer/Withdraw
          </button>
          {/* The guide sits beside the page's action rather than taking a
              full-width bar of its own above the tax card. */}
          <button
            type="button"
            onClick={() => setShowGuide((open) => !open)}
            aria-expanded={showGuide}
            className={`hidden items-center md:flex gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-brand ring-1 transition ${
              showGuide ? "bg-brand-soft ring-brand/50" : "bg-brand-soft ring-brand/20 hover:bg-brand-soft/80"
            }`}
          >
            How investment tracking works
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showGuide ? "rotate-90" : ""}`} aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        {showGuide ? (
          <div className="max-w-3xl rounded-xl bg-brand-soft/50 px-4 pb-4 pt-3 text-sm text-foreground ring-1 ring-brand/20">
            <p className="mb-3 text-xs sm:text-sm text-muted">Review each investment account against its year-end statement.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                <p className="mb-1 max-sm:text-[11px] sm:text-sm font-semibold uppercase tracking-wide text-brand">Contributions</p>
                <p className="text-xs sm:text-sm leading-relaxed">Log a deposit transaction to any investment account — it auto-adds to <span className="font-semibold text-foreground">Contrib</span> here.</p>
              </div>
              <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                <p className="mb-1 max-sm:text-[11px] sm:text-sm font-semibold uppercase tracking-wide text-brand">Gains / Losses</p>
                <p className="text-xs sm:text-sm leading-relaxed">At year-end, type the market gain or loss from your brokerage statement into <span className="font-semibold text-foreground">Gains</span>.</p>
              </div>
              <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                <p className="mb-1 max-sm:text-[11px] sm:text-sm font-semibold uppercase tracking-wide text-brand">Current balance</p>
                <p className="text-xs sm:text-sm leading-relaxed">Update the account balance on <span className="font-semibold text-foreground">Accounts</span> to match your brokerage&apos;s ending balance.</p>
              </div>
            </div>
          </div>
        ) : null}
        {/* Hero, same layout as Net Worth on Accounts: the portfolio total
            leads at hero size, and the two contribution figures sit beside it
            (beneath on a phone). This month's contribution is a line under the
            hero rather than a tile — it read "$0.00" for most of the month.
            Whole dollars: cents on six figures add noise; the table below
            keeps them. */}
        {/* Three peers on one grid: same padding, label → figure → note in
            each, all centered, so labels and figures line up across. On a
            phone the portfolio total takes the full top row. */}
        <div className="grid grid-cols-2 rounded-2xl bg-surface text-center shadow-sm ring-1 ring-black/5 sm:grid-cols-3 dark:ring-white/10">
          <div className="col-span-2 min-w-0 border-b border-line px-4 py-4 sm:col-span-1 sm:border-b-0">
            {/* What the investment accounts are worth today (savings-bucket cash
                is on the Savings tab, not here). Each label says what its
                figure answers: worth now / put in this year / still allowed. */}
            <p className="max-sm:text-[12px] sm:text-sm font-medium uppercase tracking-wide text-muted">Current Investments</p>
            <p className="mt-0.5 truncate text-3xl font-bold tabular-nums sm:text-4xl">
              {formatMoneyWhole(summary.current, currency)}
            </p>
            {summary.gains !== 0 ? (
              <p className="mt-0.5 text-xs sm:text-[15px]">
                <span className="text-muted">Total Gains in {year}:</span>{" "}
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: summary.gains > 0 ? "var(--viz-bills)" : "var(--color-negative)" }}
                >
                  {summary.gains > 0 ? "+" : "-"}
                  {formatMoneyWhole(Math.abs(summary.gains), currency)}
                </span>
              </p>
            ) : null}
            {contributedThisMonthCents > 0 ? (
              <p className="mt-0.5 text-xs sm:text-[15px]">
                <span className="text-muted">Contributed in {currentMonthLabel.split(" ")[0]}:</span>{" "}
                <span className="font-semibold tabular-nums text-positive">
                  +{formatMoneyWhole(contributedThisMonthCents, currency)}
                </span>
              </p>
            ) : null}
            {gainsByAccount.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowBreakdowns((open) => !open)}
                  aria-expanded={showBreakdowns}
                  className="mx-auto mt-1.5 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs sm:text-sm font-semibold text-brand hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  {showBreakdowns ? "Hide breakdown" : "Show breakdown"}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showBreakdowns ? "rotate-180" : ""}`} aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {showBreakdowns ? (
                  // Where the year's gains came from, account by account.
                  <ul className="mx-auto mt-1.5 max-w-xs space-y-0.5 border-t border-line/60 pt-2 text-left text-xs sm:max-w-none sm:text-sm">
                    {gainsByAccount.map((r) => (
                      // Name left, amount right, so the figures line up in
                      // one column.
                      <li key={r.name} className="flex items-baseline justify-between gap-3">
                        <span className="text-muted">{r.name}:</span>
                        <span
                          className="font-semibold tabular-nums"
                          style={{ color: r.cents > 0 ? "var(--viz-bills)" : r.cents < 0 ? "var(--color-negative)" : undefined }}
                        >
                          {r.cents > 0 ? "+" : r.cents < 0 ? "-" : ""}
                          {formatMoneyWhole(Math.abs(r.cents), currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
          <SummaryStat
            label={<><span className="hidden sm:inline">Total </span>invested in {year}</>}
            value={formatMoneyWhole(summary.contributed, currency)}
            extra={
              <>
                {investGoals.length > 0 && leftToGoalCents > 0 ? (
                  <p
                    className="mt-0.5 truncate text-xs sm:text-[15px] font-semibold"
                    style={{ color: behindGoals.length > 0 ? "var(--color-negative)" : "var(--color-positive)" }}
                  >
                    {behindGoals.length > 0
                      ? `Behind: ${formatMoneyWhole(behindMonthlyCents, currency)}/mo needed`
                      : "On track"}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowBreakdowns((open) => !open)}
                  aria-expanded={showBreakdowns}
                  className="mx-auto mt-1.5 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs sm:text-sm font-semibold text-brand hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  <span className="sm:hidden">Breakdown</span>
                  <span className="hidden sm:inline">{showBreakdowns ? "Hide breakdown" : "Show breakdown"}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showBreakdowns ? "rotate-180" : ""}`} aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {showBreakdowns ? (
                  <div className="mt-1.5 space-y-1.5 border-t border-line/60 pt-2 text-left text-xs sm:text-sm">
                    {investedSplit.groups.map((g) => (
                      <div key={g.name}>
                        <p className="sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                          <span className="font-semibold">{g.name}:</span>{" "}
                          <span className="font-bold tabular-nums">{formatMoneyWhole(g.cents, currency)}</span>
                        </p>
                        {/* Which holdings it went into. Two lines each on a
                            phone — a name like "Fidelity (Taxable) Vic" plus
                            its amount doesn't fit the half-width card. */}
                        <ul className="mt-0.5 space-y-0.5 pl-3">
                          {g.rows.map((r) => (
                            <li key={r.label} className="max-sm:pb-0.5 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                              <span className="block text-muted sm:inline">{r.label}:</span>{" "}
                              <span className="tabular-nums">{formatMoneyWhole(r.cents, currency)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            }
            note={
              investGoals.length === 0
                ? "so far"
                : leftToGoalCents > 0
                  ? `Left to Goal: ${formatMoneyWhole(leftToGoalCents, currency)}`
                  : "goals reached"
            }
            className="border-r border-line sm:border-l"
          />
          {/* Mirrors the Savings tab's limits card: each person's TSP/401(k)
              and IRA yearly limit minus what's gone in. Scoped to the CAP
              year, not the selected portfolio year. Was "Room left", which
              didn't say room for what. */}
          <SummaryStat
            label={`Left to invest in ${capYear}`}
            value={
              contributionRoomRows === 0
                ? "—"
                : contributionRoomCents > 0
                  ? formatMoneyWhole(contributionRoomCents, currency)
                  : "All maxed"
            }
            note={
              contributionRoomRows === 0
                ? undefined
                : (
                    <>
                      of {formatMoneyWhole(contributionLimitCents, currency)}
                      <span className="hidden sm:inline"> yearly retirement</span> max
                    </>
                  )
            }
            tone={
              contributionRoomRows === 0
                ? undefined
                : contributionRoomCents > 0
                  ? "text-[color:var(--viz-savings)]"
                  : "text-positive"
            }
            extra={
              limitRows.length > 0 ? (
                // Folded by default so the three cards keep one height; opens
                // to one line per person per account type — what's gone in,
                // then the max it's measured against.
                <>
                <button
                  type="button"
                  onClick={() => setShowBreakdowns((open) => !open)}
                  aria-expanded={showBreakdowns}
                  className="mx-auto mt-1.5 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs sm:text-sm font-semibold text-brand hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  <span className="sm:hidden">Breakdown</span>
                  <span className="hidden sm:inline">{showBreakdowns ? "Hide breakdown" : "Show breakdown"}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showBreakdowns ? "rotate-180" : ""}`} aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {showBreakdowns ? (
                <ul className="mt-1.5 space-y-0.5 border-t border-line/60 pt-2 text-left text-xs sm:text-sm">
                  {limitRows.map((r) => {
                    const type =
                      r.capKind === "ira"
                        ? "IRA"
                        : (r.sourceNames ?? []).some((n) => /tsp/i.test(n))
                          ? "TSP"
                          : "401(k)";
                    return (
                      // Two lines on a phone (name, then amounts): one line
                      // doesn't fit the half-width card there.
                      <li key={r.subId} className="max-sm:pb-1 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                        <span className="block text-muted sm:inline">{r.name}&rsquo;s {type}:</span>{" "}
                        <span className="tabular-nums">
                          <span className="font-semibold">{formatMoneyWhole(r.contributedCents, currency)}</span>
                          <span className="text-muted"> of {formatMoneyWhole(r.limitCents, currency)}</span>
                        </span>
                      </li>
                    );
                  })}
                  {/* The three added up. Two lines everywhere: the label is
                      too long to share a line in a third-width card. */}
                  <li className="mt-1.5 border-t border-line/60 pt-1.5">
                    <span className="block font-semibold">Total Invested in Retirement:</span>
                    {/* Right-aligned from sm up, under the column above. */}
                    <span className="block tabular-nums sm:text-right">
                      <span className="font-bold">
                        {formatMoneyWhole(limitRows.reduce((sum, r) => sum + r.contributedCents, 0), currency)}
                      </span>
                      <span className="text-muted"> of {formatMoneyWhole(contributionLimitCents, currency)}</span>
                    </span>
                  </li>
                </ul>
                ) : null}
                </>
              ) : undefined
            }
          />
        </div>

        <div role="tablist" aria-label="Invest and savings views" className="flex gap-1 border-b border-line/70">
          <TabButton active={tab === "portfolio"} onClick={() => selectTab("portfolio")}>
            Portfolio
          </TabButton>
          <TabButton active={tab === "savings"} onClick={() => selectTab("savings")}>
            Savings &amp; Contributions
          </TabButton>
        </div>
      </header>

      {tab === "savings" ? (
        <SavingsPanel {...savings} />
      ) : accounts.length === 0 ? (
        <div className="rounded-2xl bg-surface px-6 py-12 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm text-muted">
            No investment accounts yet. Add one on the Accounts page (kind:
            Investment) to track its performance here.
          </p>
        </div>
      ) : (
        <>
          {taxSplit.rows.length > 1 ? (
            <section className="rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <h2 className="text-sm font-bold">How it&rsquo;s taxed</h2>
              </div>
              <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-line/60">
                {taxSplit.rows.map((r) => (
                  <span
                    key={r.treatment}
                    style={{
                      width: `${(r.cents / taxSplit.total) * 100}%`,
                      backgroundColor: TAX_COLOR[r.treatment],
                      opacity: taxPick.length > 0 && !taxPick.includes(r.treatment) ? 0.3 : 1,
                    }}
                  />
                ))}
              </div>
              <ul className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {taxSplit.rows.map((r) => {
                  const open = taxPick.includes(r.treatment);
                  return (
                    <li key={r.treatment}>
                      <button
                        type="button"
                        aria-pressed={open}
                        onClick={() => toggleTax(r.treatment)}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs sm:text-sm transition hover:brightness-95 dark:hover:brightness-125"
                        style={{
                          // Tinted in the band's own colour so each chip ties
                          // back to its stretch of the bar; open = stronger.
                          backgroundColor: `color-mix(in srgb, ${TAX_COLOR[r.treatment]} ${open ? 30 : 16}%, transparent)`,
                          boxShadow: open
                            ? `inset 0 0 0 1.5px ${TAX_COLOR[r.treatment]}`
                            : `inset 0 0 0 1px color-mix(in srgb, ${TAX_COLOR[r.treatment]} 35%, transparent)`,
                        }}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: TAX_COLOR[r.treatment] }}
                          aria-hidden
                        />
                        <span className="font-bold text-muted">{TAX_LABEL[r.treatment]}:</span>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(r.cents, currency)}
                        </span>
                        <span className="tabular-nums text-muted">
                          {((r.cents / taxSplit.total) * 100).toFixed(0)}%
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {taxSplit.rows
                .filter((r) => taxPick.includes(r.treatment))
                .map((r) => (
                  <div key={r.treatment} className="mt-2.5 rounded-xl bg-canvas/60 px-3 py-2.5">
                    <p className="text-xs sm:text-sm text-muted">{TAX_MEANING[r.treatment]}</p>
                    {/* Columns, not one tall list: a band can hold eight
                        holdings, and a single column strands every amount at
                        the far right edge of a wide card, miles from its own
                        label. Narrower columns keep the two together. */}
                    <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                      {r.holdings.map((h) => (
                        <li
                          key={h.name}
                          className="flex items-baseline justify-between gap-2 border-b border-line/40 py-0.5 text-xs sm:text-sm last:border-0"
                        >
                          <span className="min-w-0 truncate">{h.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {formatMoney(h.cents, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 max-sm:text-[12px] sm:text-sm text-muted">
                      Set each holding&rsquo;s tax treatment on Accounts. Anything left on Auto
                      is read from its name.
                    </p>
                  </div>
                ))}
            </section>
          ) : null}

          {/* The holdings sit beside the chart inside one card: the chart is
              a fixed-ratio SVG that left white space on both sides of a
              full-width card, and the list fills it. They stack on a phone. */}
          <PerformanceChart
            accounts={chartAccounts}
            years={years}
            currency={currency}
            selectedName={
              selectedAccount?.name ??
              (taxPick.length > 0 ? taxSplit.rows.filter((r) => taxPick.includes(r.treatment)).map((r) => TAX_LABEL[r.treatment]).join(" + ") : null)
            }
            onClear={() => { setSelectedId(null); setTaxPick([]); }}
            aside={
              showAllocation ? (
                <div>
                  {/* A header strip like the card's own ("Performance by
                      year"), edge to edge across the column: the negative
                      margins cancel the column's padding. */}
                  <div className="-mx-2 -mt-3 mb-2 flex items-baseline justify-between gap-2 bg-brand-soft/35 px-4 py-2.5 lg:-mt-1">
                    <h3 className="text-xs sm:text-sm font-bold">Total Investment Holdings</h3>
                    <span className="text-xs sm:text-sm font-bold tabular-nums">{formatMoneyWhole(shownAllocation.total, currency)}</span>
                  </div>
                  {/* Picking a holding filters the chart, the same as picking a
                      row in Investments. It filters to the holding's whole
                      account: a bucket's history only starts at its split (the
                      older years live on the account), so a bucket-only chart
                      would show those years empty. Its sibling buckets light
                      up with it to say so. */}
                  <ul className="space-y-0.5">
                    {shownAllocation.rows.slice(0, 8).map((r) => {
                      const pct = (r.cents / shownAllocation.total) * 100;
                      const active = selectedId === r.accountId;
                      return (
                        <li key={r.label} className="min-w-0">
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => setSelectedId((prev) => (prev === r.accountId ? null : r.accountId))}
                            className={`w-full cursor-pointer rounded-md px-2 py-1 text-left ring-inset transition ${
                              active
                                ? "bg-sky-100 ring-1 ring-sky-400 dark:bg-sky-900/40 dark:ring-sky-500"
                                : `hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${selectedId ? "opacity-50" : ""}`
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-xs sm:text-sm">{r.label}</span>
                              <span className="shrink-0 text-xs sm:text-sm font-semibold tabular-nums">
                                {formatMoneyWhole(r.cents, currency)}{" "}
                                <span className="font-normal text-muted">({pct.toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: "var(--viz-savings)" }}
                              />
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null
            }
          />

          {showTransfer && (
            <TransferModal
              accounts={accounts}
              destAccounts={destAccounts}
              currency={currency}
              onClose={() => setShowTransfer(false)}
            />
          )}
          {showImport && (
            <ImportInvestmentModal
              accounts={accounts}
              onClose={() => setShowImport(false)}
              onImported={(summary) => { setShowImport(false); setImportNote(summary); }}
            />
          )}
          <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <PerfTable title="Investments" accounts={mine} year={year} currency={currency} selectedId={selectedId} onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} noCard />
            <div className="border-t border-foreground/10" />
            <YearByYear accounts={accounts} years={years} currency={currency} />
          </div>
          <ImportedSnapshots imports={imports} accounts={accounts} currency={currency} onImport={() => { setImportNote(null); setShowImport(true); }} importNote={importNote} onDismissNote={() => setImportNote(null)} />
        </>
      )}
    </div>
  );
}

type View = "holdings" | "performance";

/**
 * Everything recorded per investment account: what each brokerage holds, and
 * how each balance moved month to month.
 *
 * Holdings are one flat editable list across every brokerage — adding a
 * brokerage adds rows, not another panel. Monthly history stays its own view
 * because it is a different shape of data (one row per month, not per fund),
 * picked with the account dropdown beside the toggle.
 */
function ImportedSnapshots({ imports, accounts, currency, onImport, importNote, onDismissNote }: { imports: InvestmentImportView[]; accounts: InvestAccount[]; currency: string; onImport: () => void; importNote: string | null; onDismissNote: () => void }) {
  const [view, setView] = useState<View>("holdings");
  const [addingHoldings, setAddingHoldings] = useState(false);
  const [addingMonth, setAddingMonth] = useState(false);
  // Starts folded: it holds only the positions imported or typed in (a slice
  // of the portfolio), so open by default it read like the whole picture.
  // An import or Add holdings opens it so the result is in view.
  const [expanded, setExpanded] = useState(false);
  const open = expanded || addingHoldings || !!importNote;

  // Only accounts/buckets with something on file (holdings or months, imported
  // or typed) are listed. A brand-new one is started from Add month, whose own
  // Account/Bucket pickers still offer every investment account.
  const performanceLedgers = imports.filter((item) => item.importKind === "performance");
  const onFile = new Set(imports.map((item) => `${item.accountId}:${item.bucketId ?? ""}`));
  const allDestinations = accounts.flatMap((account) =>
    account.buckets.length > 0
      ? account.buckets.map((bucket) => ({ key: `${account.id}:${bucket.id}`, accountId: account.id, bucketId: bucket.id, label: bucket.name, group: account.isKids ? `${account.name} · Kids Funding` : account.name }))
      : [{ key: `${account.id}:`, accountId: account.id, bucketId: null as string | null, label: account.name, group: account.isKids ? "Kids Funding" : "Accounts" }],
  );
  const destinations = allDestinations.filter((d) => onFile.has(d.key));
  const destinationGroups = [...new Set(destinations.map((d) => d.group))];
  const [destKey, setDestKey] = useState(() => {
    const first = performanceLedgers[0];
    return first ? `${first.accountId}:${first.bucketId ?? ""}` : destinations[0]?.key ?? "";
  });
  const destination = destinations.find((d) => d.key === destKey) ?? destinations[0] ?? null;
  const ledger = destination
    ? performanceLedgers.find((item) => item.accountId === destination.accountId && (item.bucketId ?? null) === destination.bucketId) ?? null
    : null;

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex flex-col items-start gap-3 border-b border-line bg-brand-soft/35 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
          <h2 className="text-sm lg:text-base font-semibold">Holdings &amp; history</h2>
          <span className="max-sm:text-xs sm:text-sm text-muted">Imported positions only</span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setAddingHoldings((current) => !current); setAddingMonth(false); }}
            className="rounded-lg bg-brand px-3 py-2 text-xs sm:text-sm lg:text-sm font-semibold text-white transition hover:bg-brand/90"
          >
            {addingHoldings ? "Close" : "Add holdings"}
          </button>
          <button type="button" onClick={onImport} className="rounded-lg bg-sky-100 px-3 py-2 text-xs sm:text-sm lg:text-sm font-semibold text-foreground transition hover:bg-sky-200 dark:bg-sky-900/50 dark:hover:bg-sky-900">Import CSV</button>
        </div>
      </div>

      {open ? <>
      {importNote ? (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-positive/10 px-4 py-2">
          <p className="text-sm lg:text-base font-medium text-positive">{importNote}</p>
          <button type="button" onClick={onDismissNote} aria-label="Dismiss" className="rounded px-1.5 text-lg leading-none text-positive/70 hover:bg-positive/15 hover:text-positive">×</button>
        </div>
      ) : null}

      {addingHoldings ? (
        <div className="border-b border-line bg-background/40 px-4 py-3">
          <AddHoldingsForm accounts={accounts} currency={currency} onDone={() => setAddingHoldings(false)} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {(["holdings", "performance"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition ${
                view === option
                  ? "bg-sky-100 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-900/50 dark:text-sky-100 dark:ring-sky-700"
                  : "text-muted hover:bg-sky-50 hover:text-sky-900 dark:hover:bg-sky-900/30 dark:hover:text-sky-100"
              }`}
            >
              {option === "holdings" ? "Holdings" : "Monthly performance"}
            </button>
          ))}
        </div>

        {view === "performance" ? (
          <div className="flex flex-wrap items-center gap-2">
            {destinations.length > 0 ? (
              <select
                value={destination?.key ?? ""}
                onChange={(event) => { setDestKey(event.target.value); setAddingMonth(false); }}
                className="rounded-md bg-sky-50 dark:bg-background px-2 py-1.5 text-xs sm:text-sm lg:text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {destinationGroups.map((group) => (
                  <optgroup key={group} label={group}>
                    {destinations.filter((d) => d.group === group).map((d) => (
                      <option key={d.key} value={d.key}>{d.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => setAddingMonth((current) => !current)}
              className="rounded-md bg-brand px-3 py-1.5 text-xs sm:text-sm lg:text-sm font-semibold text-white transition hover:bg-brand/90"
            >
              {addingMonth ? "Close" : "Add month"}
            </button>
          </div>
        ) : null}
      </div>

      {view === "holdings" ? (
        <AllHoldingsTable imports={imports} accounts={accounts} currency={currency} />
      ) : (
        <>
          {addingMonth ? (
            <div className="border-b border-line bg-background/40 px-4 py-3">
              <AddMonthForm
                accounts={accounts}
                imports={imports}
                currency={currency}
                key={destination?.key}
                defaultAccountId={destination?.accountId}
                defaultBucketId={destination?.bucketId ?? ""}
                onDone={() => setAddingMonth(false)}
              />
            </div>
          ) : null}
          {ledger ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5">
                <span className="text-xs sm:text-sm lg:text-sm text-muted">
                  {ledgerLabel(ledger.accountName, ledger.bucketName)} · {ledger.performance.length} month{ledger.performance.length === 1 ? "" : "s"}
                </span>
                <PerformanceFreshness rows={ledger.performance} />
              </div>
              <ImportedPerformanceTable rows={ledger.performance} currency={currency} />
            </>
          ) : (
            <p className="px-4 py-5 text-sm lg:text-base text-muted">
              No monthly history for {destination?.label ?? "this account"} yet. Use <span className="font-medium text-foreground">Add month</span>{" "}to record an account&apos;s month-end balance.
            </p>
          )}
        </>
      )}
      </> : null}
    </section>
  );
}

/** Same "updated … days ago" line as Holdings, for one account's months. */
function PerformanceFreshness({ rows }: { rows: InvestmentPerformanceImportRow[] }) {
  const latest = rows.reduce<string | null>((max, row) => (max && max > row.updatedAt ? max : row.updatedAt), null);
  if (!latest) return null;
  const { label, stale } = describeUpdate(latest);
  return (
    <span className={`text-xs sm:text-[15px] ${stale ? "font-semibold text-negative" : "text-muted"}`}>
      updated {label}
    </span>
  );
}

function ImportedPerformanceTable({ rows, currency }: { rows: InvestmentPerformanceImportRow[]; currency: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-line">
      <table className="min-w-full text-xs sm:text-sm lg:text-sm">
        <thead className="sticky top-0 bg-surface text-left max-sm:text-[11px] sm:text-sm lg:text-sm uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2 text-center">Month</th><th className="px-3 py-2 text-center">Beginning balance</th><th className="px-3 py-2 text-center">Market change</th><th className="px-3 py-2 text-center">Dividends</th><th className="px-3 py-2 text-center">Withdrawal</th><th className="px-3 py-2 text-center">Ending balance</th><th className="px-3 py-2 text-center">% Growth</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => <tr key={row.asOfDate}>
            <td className="whitespace-nowrap px-3 py-2 text-center">{row.asOfDate}{row.entrySource === "manual" ? <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 max-sm:text-[11px] sm:text-sm lg:text-sm font-medium text-muted dark:bg-sky-900/50">Manual</span> : null}</td>
            <td className="px-3 py-2 text-center tabular-nums">{row.beginningBalanceCents == null ? "—" : formatMoney(row.beginningBalanceCents, currency)}</td>
            <td className={`px-3 py-2 text-center tabular-nums ${gainTone(row.marketChangeCents ?? 0)}`}>{row.marketChangeCents == null ? "—" : formatMoney(row.marketChangeCents, currency)}</td>
            <td className={`px-3 py-2 text-center tabular-nums ${gainTone(row.dividendsCents ?? 0)}`}>{row.dividendsCents == null ? "—" : formatMoney(row.dividendsCents, currency)}</td>
            <td className={`px-3 py-2 text-center tabular-nums ${gainTone(-(row.withdrawalsCents ?? 0))}`}>{row.withdrawalsCents == null ? "—" : formatMoney(row.withdrawalsCents, currency)}</td>
            <td className="px-3 py-2 text-center font-medium tabular-nums">{formatMoney(row.endingBalanceCents, currency)}</td>
            {(() => {
              // Straight beginning → ending change, so withdrawals and deposits
              // move it too, not just the market.
              const begin = row.beginningBalanceCents;
              if (begin == null || begin === 0) return <td className="px-3 py-2 text-center tabular-nums text-muted">—</td>;
              const pct = ((row.endingBalanceCents - begin) / Math.abs(begin)) * 100;
              return (
                <td className={`px-3 py-2 text-center tabular-nums ${gainTone(pct)}`}>
                  {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                </td>
              );
            })()}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Underline-style tab. Brand indigo is app chrome, which this is. */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-brand text-brand"
          : "border-transparent text-muted hover:border-line hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// A secondary figure beside the hero, built like it (label → figure → note)
// so the three line up across the card.
function SummaryStat({
  label,
  value,
  note,
  tone,
  className,
  extra,
}: {
  label: React.ReactNode;
  value: string;
  note?: React.ReactNode;
  tone?: string;
  className?: string;
  /** Detail under the note, e.g. a breakdown of the figure. */
  extra?: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 px-3 py-4 sm:px-4 ${className ?? ""}`}>
      <p className="truncate max-sm:text-[11px] font-medium uppercase text-muted sm:text-sm sm:tracking-wide">{label}</p>
      <p className={`mt-0.5 truncate text-2xl font-bold tabular-nums sm:text-4xl ${tone ?? ""}`}>{value}</p>
      {note ? <p className="mt-0.5 truncate text-xs sm:text-[15px] text-muted">{note}</p> : null}
      {extra}
    </div>
  );
}

// ─── Performance chart ───────────────────────────────────────────────────────

// The "Gain" view (gain as a % of the year's deposits) was dropped: it
// competed with the Investments table's Return column and read as a return.
type ChartMode = "stacked" | "grouped";

function PerformanceChart({
  accounts,
  years,
  currency,
  selectedName,
  onClear,
  aside,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
  selectedName: string | null;
  onClear: () => void;
  /** Shown beside the chart from lg up (under it on a phone) — the
   *  holdings list, which fills the width the fixed-ratio chart leaves. */
  aside?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [mode, setMode] = useState<ChartMode>("stacked");
  const [chartCollapseState, setChartCollapseState] = useSessionCollapse("invest-chart-open", () => ({ open: true }));
  const chartOpen = chartCollapseState.open;
  const setChartOpen = (v: boolean) => setChartCollapseState((s) => ({ ...s, open: v }));
  const desc = useMemo(() => [...years].sort((a, b) => b - a), [years]);

  const bars = useMemo(
    () =>
      desc.map((y) => {
        let contrib = 0;
        let gain = 0;
        let endBal = 0;
        let endAny = false;
        for (const a of accounts) {
          const c = effectiveCell(a, y);
          contrib += c.contributedCents;
          gain += c.accruedCents;
          if (c.endBalanceCents != null) { endBal += c.endBalanceCents; endAny = true; }
        }
        return { year: y, contrib, gain, endBal: endAny ? endBal : null };
      }),
    [desc, accounts],
  );

  // Beside the holdings list (lg up), the chart fills its column's height
  // instead of keeping the 600×220 shape, which left a gap under the bars.
  // The viewBox stays 600 wide so labels keep their size; only H grows to
  // the box's measured shape.
  const plotRef = useRef<HTMLDivElement>(null);
  const [fillRatio, setFillRatio] = useState<number | null>(null);
  useEffect(() => {
    const el = plotRef.current;
    if (!aside || !el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setFillRatio(wide.matches && width > 0 ? height / width : null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    wide.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [aside, chartOpen]);

  const W = 600;
  const H = fillRatio ? Math.max(220, Math.round(W * fillRatio)) : 220;
  const PAD = { top: 32, right: 16, bottom: 32, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Max depends on mode: stacked sums, grouped is max of either.
  const maxBar = useMemo(() => {
    if (mode === "grouped") {
      return Math.max(...bars.map((b) => Math.max(b.contrib, Math.max(b.gain, 0))), 1);
    }
    return Math.max(...bars.map((b) => b.contrib + Math.max(b.gain, 0)), 1);
  }, [bars, mode]);

  const niceCeil = Math.ceil(maxBar / 10000) * 10000;
  const scale = (v: number) => (v / niceCeil) * chartH;

  const slotW = chartW / bars.length;
  const barW = mode === "grouped"
    ? Math.min(20, (chartW / bars.length) * 0.28)
    : Math.min(40, (chartW / bars.length) * 0.55);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceCeil * f));

  // Compact money formatter: input is CENTS, output uses $k for anything >= $1,000.
  const compactMoney = (cents: number) => {
    const dollars = Math.abs(cents) / 100;
    const sign = cents < 0 ? MINUS : "";
    if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
    return `${sign}$${dollars.toFixed(0)}`;
  };

  const fmtTick = (t: number) => compactMoney(t);

  const fmtBarTotal = (b: typeof bars[number]) => {
    const total = mode === "stacked" ? b.contrib + Math.max(b.gain, 0) : Math.max(b.contrib, b.gain);
    return compactMoney(total);
  };

  return (
    <section className="min-w-0 overflow-visible rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Wraps on a phone: the mode buttons drop under the title instead of
          pushing the card past the screen edge. */}
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-t-2xl bg-brand-soft/35 px-4 py-3 ring-1 ring-brand/10">
        <button
          type="button"
          onClick={() => setChartOpen(!chartOpen)}
          aria-expanded={chartOpen}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${chartOpen ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <div>
            <h2 className="text-sm font-bold">
              Performance by year
              {selectedName ? <span className="ml-1.5 font-medium text-brand">· {selectedName}</span> : null}
            </h2>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex overflow-hidden rounded-lg ring-1 ring-line max-sm:text-[12px] sm:text-sm">
            {(["stacked", "grouped"] as ChartMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 font-medium capitalize transition ${mode === m ? "bg-brand-soft text-brand" : "text-muted hover:bg-brand-soft/40 hover:text-foreground"}`}
              >
                {m}
              </button>
            ))}
          </div>
          {selectedName ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 max-sm:text-[12px] sm:text-sm font-medium text-muted ring-1 ring-line hover:bg-brand-soft hover:text-foreground"
            >
              ✕ Clear filter
            </button>
          ) : null}
        </div>
      </div>

      {chartOpen ? <div className={aside ? "lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}>
      <div className="flex min-w-0 flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-2 text-xs sm:text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-savings)" }} />
          Contributed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-bills)" }} />
          Unrealized gains
        </span>
      </div>

      {/* SVG chart */}
      <div className={`relative px-2 pb-4 ${aside ? "lg:min-h-[220px] lg:flex-1" : ""}`}>
        {/* The measured box: the padding-free area the SVG fills from lg up. */}
        <div ref={plotRef} className={aside ? "lg:absolute lg:inset-x-2 lg:bottom-4 lg:top-0" : ""} aria-hidden />
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`w-full ${fillRatio ? "absolute inset-x-2 bottom-4 top-0 !w-[calc(100%-1rem)]" : ""}`}
          style={fillRatio ? { height: "calc(100% - 1rem)" } : { height: "clamp(160px, 24vw, 220px)" }}
          aria-label="Investment performance chart"
        >
          {/* Y-axis grid + labels */}
          {ticks.map((t) => {
            const y = PAD.top + chartH - scale(t);
            return (
              <g key={t}>
                <line
                  x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                  stroke="currentColor" strokeWidth="0.5" opacity="0.12"
                />
                <text
                  x={PAD.left - 6} y={y + 4}
                  textAnchor="end" fontSize="14" className="sm:text-[16px]" fill="currentColor"
                >
                  {fmtTick(t)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {bars.map((b, i) => {
            const cx = PAD.left + slotW * i + slotW / 2;
            const isHovered = hovered === i;

            // Compute per-mode bar rects.
            const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
            let totalTopY = PAD.top + chartH; // default: baseline (no bar)

            if (mode === "stacked") {
              const contribH = scale(b.contrib);
              const gainH = scale(Math.max(b.gain, 0));
              const bx = cx - barW / 2;
              if (contribH > 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH, w: barW, h: contribH, fill: "var(--viz-savings)" });
              }
              if (gainH > 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH - gainH, w: barW, h: gainH, fill: "var(--viz-bills)" });
              }
              if (b.gain < 0) {
                rects.push({ x: bx, y: PAD.top + chartH - contribH, w: barW, h: scale(Math.abs(b.gain)), fill: "var(--negative)" });
              }
              totalTopY = PAD.top + chartH - contribH - gainH;
            } else {
              const contribH = scale(b.contrib);
              const gainH = scale(Math.max(b.gain, 0));
              const gap = 2;
              const bxL = cx - barW - gap / 2;
              const bxR = cx + gap / 2;
              if (contribH > 0) {
                rects.push({ x: bxL, y: PAD.top + chartH - contribH, w: barW, h: contribH, fill: "var(--viz-savings)" });
              }
              if (gainH > 0) {
                rects.push({ x: bxR, y: PAD.top + chartH - gainH, w: barW, h: gainH, fill: "var(--viz-bills)" });
              }
              if (b.gain < 0) {
                rects.push({ x: bxR, y: PAD.top + chartH, w: barW, h: scale(Math.abs(b.gain)), fill: "var(--negative)" });
              }
              totalTopY = PAD.top + chartH - Math.max(contribH, gainH);
            }

            return (
              <g key={b.year}>
                {/* Hover hit area */}
                <rect
                  x={PAD.left + slotW * i}
                  y={PAD.top}
                  width={slotW}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
                {isHovered && (
                  <rect
                    x={PAD.left + slotW * i}
                    y={PAD.top}
                    width={slotW}
                    height={chartH}
                    fill="currentColor"
                    opacity="0.04"
                    rx="2"
                    pointerEvents="none"
                  />
                )}
                {rects.map((r, ri) => (
                  <rect
                    key={ri}
                    x={r.x} y={r.y} width={r.w} height={r.h}
                    rx="3" ry="3"
                    fill={r.fill}
                    opacity={isHovered ? 1 : 0.85}
                    pointerEvents="none"
                  />
                ))}
                {/* Bar total label above */}
                {rects.length > 0 ? (
                  <text
                    x={cx} y={totalTopY - 4}
                    textAnchor="middle" fontSize="14" className="sm:text-[16px]" fontWeight="600"
                    fill="currentColor" opacity="0.7" pointerEvents="none"
                  >
                    {fmtBarTotal(b)}
                  </text>
                ) : null}
                {/* X-axis label */}
                <text
                  x={cx} y={PAD.top + chartH + 20}
                  textAnchor="middle" fontSize="15" className="sm:text-[17px]" fill="currentColor"
                >
                  {b.year}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered !== null && bars[hovered] ? (
          <ChartTooltip b={bars[hovered]} hovered={hovered} total={bars.length} currency={currency} />
        ) : null}
      </div>
      </div>
      {aside ? (
        <div className="min-w-0 border-t border-line px-2 py-3 lg:border-l lg:border-t-0 lg:py-1 lg:pb-3">{aside}</div>
      ) : null}
      </div> : null}
    </section>
  );
}

function ChartTooltip({
  b,
  hovered,
  total,
  currency,
}: {
  b: { year: number; contrib: number; gain: number; endBal: number | null };
  hovered: number;
  total: number;
  currency: string;
}) {
  const slotPct = ((hovered + 0.5) / total) * 100;
  return (
    <div
      className="pointer-events-none absolute top-2 rounded-xl bg-surface px-3 py-2 text-xs sm:text-sm shadow-lg ring-1 ring-black/10 dark:ring-white/15"
      style={{
        left: `${slotPct}%`,
        transform: slotPct > 60 ? "translateX(-100%)" : "translateX(0)",
        zIndex: 10,
      }}
    >
      <div className="mb-1.5 text-center font-semibold">{b.year}</div>
      <div className="space-y-0.5 text-muted">
        <div>Contributed: <span className="font-medium text-foreground">{formatMoney(b.contrib, currency)}</span></div>
        <div>
          Unrealized gains:{" "}
          <span className="font-medium" style={{ color: b.gain >= 0 ? "var(--viz-bills)" : "var(--color-negative)" }}>
            {formatMoney(b.gain, currency)}
          </span>
        </div>
        {b.endBal != null && b.year < new Date().getFullYear() && (
          <div>End balance: <span className="font-medium text-foreground">{formatMoney(b.endBal, currency)}</span></div>
        )}
      </div>
      <div className="mt-1.5 border-t border-line/60 pt-1.5 font-semibold text-foreground">
        Total: {formatMoney(b.contrib + b.gain, currency)}
      </div>
    </div>
  );
}

function PerfTable({
  title,
  accounts,
  year,
  currency,
  selectedId,
  onSelect,
  noCard,
}: {
  title: string;
  accounts: InvestAccount[];
  year: number;
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  noCard?: boolean;
}) {
  const key = `invest-table-${title.toLowerCase().replace(/\s+/g, "-")}`;
  // Investment tables start open on login. Session storage remembers each
  // table's last state while the user navigates around the app.
  const defaultCollapsed = false;
  const [collapseState, setCollapseState] = useSessionCollapse(key, () => ({ v: defaultCollapsed }));
  const collapsed = collapseState.v;
  const toggle = () => setCollapseState((s) => ({ ...s, v: !s.v }));

  // Bucket-open state — one flag per account_id. Only accounts with buckets
  // actually render a chevron, but the map is keyed uniformly.
  const [bucketsOpen, setBucketsOpen] = useSessionCollapse("invest-buckets-open", () => ({}));
  const toggleBuckets = (id: string) => setBucketsOpen((s) => ({ ...s, [id]: !s[id] }));

  // Rows sort by the clicked column instead of being dragged into order:
  // first click sorts high to low (A–Z for Account), the next flips it.
  // Opens on Current, biggest first.
  type SortKey = "name" | "start" | "contrib" | "current" | "gains" | "eoy" | "ret";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "current", dir: "desc" });
  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  // Group totals for the selected year, using per-account EFFECTIVE cells
  // (account slot + all bucket slots). Effective start uses prior-year end as fallback.
  let startSum = 0;
  let startAny = false;
  let effStartSum = 0;
  let effStartAny = false;
  let endSum = 0;
  let endAny = false;
  let closeSum = 0;
  let closeAny = false;
  let contribSum = 0;
  let accruedSum = 0;
  for (const a of accounts) {
    const c = effectiveCell(a, year);
    if (c.startBalanceCents != null) { startSum += c.startBalanceCents; startAny = true; }
    const eff = c.startBalanceCents ?? effectiveCell(a, year - 1).endBalanceCents ?? null;
    if (eff != null) { effStartSum += eff; effStartAny = true; }
    if (c.endBalanceCents != null) { endSum += c.endBalanceCents; endAny = true; }
    if (c.closeBalanceCents != null) { closeSum += c.closeBalanceCents; closeAny = true; }
    contribSum += c.contributedCents;
    accruedSum += c.accruedCents;
  }
  const totalReturn = returnPct(effStartAny ? effStartSum : null, accruedSum);

  const sortValue = (a: InvestAccount): number | string | null => {
    const eff = effectiveCell(a, year);
    const priorEff = effectiveCell(a, year - 1);
    switch (sort.key) {
      case "name": return a.name.toLowerCase();
      case "start": return eff.startBalanceCents ?? priorEff.endBalanceCents ?? null;
      case "contrib": return eff.contributedCents;
      case "current": return eff.endBalanceCents;
      case "gains": return eff.accruedCents;
      case "eoy": return eff.closeBalanceCents;
      case "ret": return returnPct(eff.startBalanceCents ?? priorEff.endBalanceCents ?? null, eff.accruedCents);
    }
  };
  // Blanks always sink to the bottom, whichever way the column is sorted.
  const sortedAccounts = [...accounts].sort((x, y) => {
    const a = sortValue(x);
    const b = sortValue(y);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const cmp = typeof a === "string" ? a.localeCompare(b as string) : a - (b as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  // Hide "Start" column when every account has a null/zero start for the year — reduces noise.
  const showStart = startAny && startSum > 0;
  // EOY is the 31 Dec balance, so for the year in progress every row is empty.
  // Show the column only once some account actually has one — it was a column
  // of dashes that pushed Gains and Return off the side of the card.
  const showClose = closeAny;
  const zeroCls = "text-muted/50";

  if (accounts.length === 0) return null;

  return (
    <section className={noCard ? "" : "overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10"}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 border-b border-line bg-brand-soft/30 px-4 py-2.5 text-left transition hover:bg-brand-soft/50"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <h2 className="flex flex-1 items-center gap-2 text-sm lg:text-base font-bold">
          {title}
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs sm:text-sm lg:text-sm font-semibold text-muted dark:bg-sky-900/50">{year}</span>
          {/* Rows are accounts; split accounts hold several holdings, so both
              counts are given — "13 accounts" over 7 rows read as a mistake. */}
          <span className="max-sm:text-xs font-bold text-muted">
            {accounts.length} account{accounts.length === 1 ? "" : "s"}
            {(() => {
              const holdings = accounts.reduce((n, a) => n + (a.buckets.length > 0 ? a.buckets.length : 1), 0);
              // Desktop only: on a phone it wrapped mid-phrase beside the title.
              return holdings !== accounts.length ? <span className="hidden sm:inline"> · {holdings} holdings</span> : null;
            })()}
          </span>
        </h2>
        {collapsed && (
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs sm:text-sm lg:text-sm tabular-nums text-muted">
            <span>Contrib <span className={`font-semibold ${contribSum === 0 ? zeroCls : "text-foreground"}`}>{formatMoney(contribSum, currency)}</span></span>
            <span>Gains <span className={`font-semibold ${accruedSum === 0 ? zeroCls : ""}`} style={accruedSum > 0 ? { color: "var(--viz-bills)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}>{formatMoney(accruedSum, currency)}</span></span>
            {endAny && <span>Current <span className="font-semibold text-foreground">{formatMoney(endSum, currency)}</span></span>}
          </div>
        )}
      </button>
      {collapsed ? null : <>
      <div className="overflow-x-auto">
        <table className="w-full font-semibold text-[13px] sm:text-sm">
          <thead>
            <tr className="max-sm:text-[12px] sm:text-sm lg:text-sm font-semibold text-muted">
              {(
                [
                  ["name", "Account", true],
                  ["start", "Start", showStart],
                  ["contrib", "Contrib", true],
                  ["current", "Current", true],
                  ["gains", "Gains", true],
                  ["eoy", "EOY", showClose],
                  ["ret", "Return", true],
                ] as [SortKey, string, boolean][]
              ).filter(([, , shown]) => shown).map(([key, label]) => {
                const active = sort.key === key;
                const isName = key === "name";
                return (
                  <th
                    key={key}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={isName ? "sticky left-0 z-10 bg-surface py-1 pl-1 pr-2 text-left" : "px-1 py-1 text-center"}
                  >
                    {/* Same header button as the Holdings table: the arrow
                        shows the active column and which way it runs. */}
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 font-semibold transition hover:bg-sky-50 hover:text-sky-900 dark:hover:bg-sky-900/30 dark:hover:text-sky-100 ${active ? "text-foreground" : ""}`}
                    >
                      {label}
                      <span aria-hidden className={active ? "" : "opacity-30"}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.map((a) => {
              const hasBuckets = a.buckets.length > 0;
              const open = !!bucketsOpen[a.id];
              // Parent row shows EFFECTIVE totals (account slot + all buckets).
              // When no buckets, that equals the account cell exactly.
              const eff = effectiveCell(a, year);
              const priorEff = effectiveCell(a, year - 1);
              const ret = returnPct(eff.startBalanceCents ?? priorEff.endBalanceCents ?? null, eff.accruedCents);
              const isSelected = selectedId === a.id;
              // Account-level slot (bucket_id NULL) — where CSV seed lives. When
              // buckets exist, this slot is still editable so the seed row can be
              // adjusted, but bucket rows render below.
              const parentCell = a.cells[year];
              return (
                <Fragment key={a.id}>
                  {/* An account with buckets opens and closes from anywhere on
                      its row except the name, which filters the chart (as a
                      holding picked in the list does). Same tint as the
                      Yearly Breakdown rows. */}
                  <tr
                    onClick={hasBuckets ? () => toggleBuckets(a.id) : undefined}
                    className={`group border-t border-line/70 transition ${
                      isSelected
                        ? "bg-brand-soft/40"
                        : hasBuckets
                          ? "cursor-pointer hover:bg-sky-50 dark:hover:bg-sky-950/40"
                          : "hover:bg-brand-soft/10"
                    }`}
                  >
                    {/* Pinned: on a phone the money columns scroll sideways and the
                        account name has to stay put to say whose row it is. Its
                        background stays solid so scrolled figures can't show
                        through; the hover tint is painted over it as an inset
                        shadow so it matches the rest of the row. */}
                    <td
                      className={`sticky left-0 z-10 bg-surface py-2 pl-3 pr-2 ${
                        hasBuckets && !isSelected
                          ? "group-hover:shadow-[inset_0_0_0_999px_var(--color-sky-50)] dark:group-hover:shadow-[inset_0_0_0_999px_color-mix(in_oklab,var(--color-sky-950)_40%,transparent)]"
                          : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {hasBuckets ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBuckets(a.id);
                            }}
                            aria-expanded={open}
                            aria-label={open ? "Collapse buckets" : "Expand buckets"}
                            className="rounded p-0.5 text-muted transition hover:bg-brand-soft hover:text-foreground"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden>
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        ) : (
                          <span className="inline-block w-[18px]" aria-hidden />
                        )}
                        {/* Name and the buckets tag wrap together, so on a phone
                            the tag drops under the name instead of squeezing it. */}
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(a.id);
                            }}
                            // Wraps: type, holder and bucket chips drop under the
                            // name when the column is narrow instead of holding
                            // the Account column at the width of all of them.
                            className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-left"

                          >
                            <span className={`font-semibold ${isSelected ? "text-brand" : "hover:underline"}`}>{a.name}</span>
                            {a.subtype ? (
                              <span className="max-sm:text-[12px] sm:text-sm lg:text-sm text-muted">{a.subtype}</span>
                            ) : null}
                            {a.holder ? (
                              <span className="rounded bg-background px-1 max-sm:text-[11px] sm:text-sm lg:text-sm font-semibold text-muted ring-1 ring-line">
                                {a.holder}
                              </span>
                            ) : null}
                          </button>
                          {/* Outside the name button: clicking it opens the
                              buckets (the row's click), not the chart filter. */}
                          {hasBuckets ? (
                            <span className="shrink-0 rounded bg-brand-soft/70 px-1 max-sm:text-[11px] sm:text-sm lg:text-sm font-semibold text-brand ring-1 ring-brand/20">
                              {a.buckets.length} bucket{a.buckets.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    {showStart ? (
                      <td className="px-1 py-1">
                        {hasBuckets ? (
                          <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                            {eff.startBalanceCents ? formatMoney(eff.startBalanceCents, currency) : null}
                          </span>
                        ) : (
                          <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                            {parentCell?.startBalanceCents ? formatMoney(parentCell.startBalanceCents, currency) : null}
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className="block text-center text-[13px] sm:text-sm tabular-nums font-semibold">
                          {eff.contributedCents ? formatMoney(eff.contributedCents, currency) : null}
                        </span>
                      ) : (
                        <LedgerCell compact cents={parentCell?.contributedCents ?? 0} currency={currency} tone={(parentCell?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-center text-[13px] sm:text-sm tabular-nums font-semibold ${(eff.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                          {eff.endBalanceCents ? formatMoney(eff.endBalanceCents, currency) : null}
                        </span>
                      ) : (
                        <span className={`block text-center text-[13px] sm:text-sm tabular-nums font-semibold ${(parentCell?.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                          {parentCell?.endBalanceCents ? formatMoney(parentCell.endBalanceCents, currency) : null}
                        </span>
                      )}
                    </td>
                    <td className="relative px-1 py-1">
                      {eff.accruedManual ? <PinnedMark /> : null}
                      {hasBuckets ? (
                        <span className={`block text-center text-[13px] sm:text-sm tabular-nums font-semibold ${eff.accruedCents === 0 ? zeroCls : ""}`} style={eff.accruedCents > 0 ? { color: "var(--viz-bills)" } : eff.accruedCents < 0 ? { color: "var(--color-negative)" } : undefined}>
                          {formatMoney(eff.accruedCents, currency)}
                        </span>
                      ) : (
                        <EditCell compact accountId={a.id} year={year} field="accrued" cents={parentCell?.accruedCents ?? 0} currency={currency} tone={(parentCell?.accruedCents ?? 0) === 0 ? zeroCls : (parentCell?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                      )}
                    </td>
                    {showClose ? (
                      <td className="px-1 py-1">
                        <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                          {eff.closeBalanceCents == null ? null : formatMoney(eff.closeBalanceCents, currency)}
                        </span>
                      </td>
                    ) : null}
                    <td className={`px-2 py-2 text-center tabular-nums ${ret == null ? "" : ret > 0 ? "text-positive" : ret < 0 ? "text-negative" : ""}`}>
                      {ret == null || ret === 0 ? null : formatPct(ret)}
                    </td>
                  </tr>
                  {hasBuckets && open ? (
                    <>
                      {/* Account-level seed row (only when the CSV/manual seed at
                          account level has any non-zero value — otherwise buckets
                          alone are enough and the row would be pure noise). */}
                      {(parentCell?.contributedCents || parentCell?.accruedCents || parentCell?.startBalanceCents || parentCell?.endBalanceCents) ? (
                        <tr className="border-t border-line/40 bg-background/30 text-xs sm:text-sm lg:text-sm">
                          <td className="sticky left-0 z-10 bg-surface py-1 pl-10 pr-2 text-muted italic">Account (unallocated / seed)</td>
                          {showStart ? (
                            <td className="px-1 py-1">
                              <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                                {parentCell?.startBalanceCents ? formatMoney(parentCell.startBalanceCents, currency) : null}
                              </span>
                            </td>
                          ) : null}
                          <td className="px-1 py-1">
                            <LedgerCell compact cents={parentCell?.contributedCents ?? 0} currency={currency} tone={(parentCell?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                          </td>
                          <td className="px-1 py-1">
                            <span className={`block text-center text-[13px] sm:text-sm tabular-nums ${(parentCell?.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                              {parentCell?.endBalanceCents ? formatMoney(parentCell.endBalanceCents, currency) : null}
                            </span>
                          </td>
                          <td className="px-1 py-1">
                            <EditCell compact accountId={a.id} year={year} field="accrued" cents={parentCell?.accruedCents ?? 0} currency={currency} tone={(parentCell?.accruedCents ?? 0) === 0 ? zeroCls : (parentCell?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                          </td>
                          {showClose ? (
                            <td className="px-1 py-1">
                              <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                                {parentCell?.closeBalanceCents == null ? null : formatMoney(parentCell.closeBalanceCents, currency)}
                              </span>
                            </td>
                          ) : null}
                          <td className="px-2 py-1" />
                        </tr>
                      ) : null}
                      {a.buckets.map((b) => {
                        const bc = b.cells[year];
                        return (
                          <tr key={b.id} className="border-t border-line/40 bg-background/20 text-[13px] sm:text-sm">
                            <td className="sticky left-0 z-10 bg-surface py-1 pl-10 pr-2 text-foreground">
                              <span className="text-brand-strong">↳</span> <span className="ml-1">{b.name}</span>
                            </td>
                            {showStart ? (
                              <td className="px-1 py-1">
                                <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                                  {bc?.startBalanceCents ? formatMoney(bc.startBalanceCents, currency) : null}
                                </span>
                              </td>
                            ) : null}
                            <td className="px-1 py-1">
                              <LedgerCell compact cents={bc?.contributedCents ?? 0} currency={currency} tone={(bc?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                            </td>
                            <td className="px-1 py-1">
                              <span className={`block text-center text-[13px] sm:text-sm tabular-nums ${(bc?.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                                {bc?.endBalanceCents ? formatMoney(bc.endBalanceCents, currency) : null}
                              </span>
                            </td>
                            <td className="relative px-1 py-1">
                              {bc?.accruedManual ? <PinnedMark /> : null}
                              <EditCell compact accountId={a.id} bucketId={b.id} year={year} field="accrued" cents={bc?.accruedCents ?? 0} currency={currency} tone={(bc?.accruedCents ?? 0) === 0 ? zeroCls : (bc?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                            </td>
                            {showClose ? (
                              <td className="px-1 py-1">
                                <span className="block text-center text-[13px] sm:text-sm tabular-nums text-muted">
                                  {bc?.closeBalanceCents == null ? null : formatMoney(bc.closeBalanceCents, currency)}
                                </span>
                              </td>
                            ) : null}
                            <td className="px-2 py-1" />
                          </tr>
                        );
                      })}
                    </>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td className="sticky left-0 z-10 bg-surface py-2 pl-3 pr-2">Total</td>
              {showStart ? (
                <td className="px-2 py-2 text-center tabular-nums text-muted">
                  {formatMoney(startSum, currency)}
                </td>
              ) : null}
              <td className="px-2 py-2 text-center tabular-nums">{contribSum ? formatMoney(contribSum, currency) : null}</td>
              <td className="px-2 py-2 text-center tabular-nums font-semibold">
                {endAny ? formatMoney(endSum, currency) : null}
              </td>
              <td
                className={`px-2 py-2 text-center tabular-nums ${accruedSum === 0 ? zeroCls : ""}`}
                style={accruedSum > 0 ? { color: "var(--viz-bills)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}
              >
                {formatMoney(accruedSum, currency)}
              </td>
              {showClose ? (
                <td className="px-2 py-2 text-center tabular-nums text-muted">
                  {formatMoney(closeSum, currency)}
                </td>
              ) : null}
              <td className={`px-2 py-2 text-center tabular-nums ${totalReturn == null ? "" : totalReturn > 0 ? "text-positive" : totalReturn < 0 ? "text-negative" : ""}`}>
                {totalReturn == null || totalReturn === 0 ? null : formatPct(totalReturn)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      </>}
    </section>
  );
}

/**
 * A read-only Contrib figure.
 *
 * The whole Contrib column is read-only at Victor's request: contributions are
 * entered as transactions, and the table reports them. That also removes the
 * trap this cell was built for — for the year in progress
 * `resolveContributedCents` returns the ledger sum and ignores whatever
 * investment_years holds, so an input here would accept a value, save it, and
 * show the old number back, reading as a dropped edit.
 */
function LedgerCell({
  cents,
  currency,
  tone,
  compact,
}: {
  cents: number;
  currency: string;
  tone?: string;
  // 13px instead of 14px — the Investments table uses it to fit its card.
  compact?: boolean;
}) {
  // A zero contribution prints nothing: "$0.00" on most rows buried the few
  // accounts that actually received money this year.
  return (
    <span className={`flex items-center justify-center gap-1 px-1 text-center tabular-nums ${compact ? "text-[13px] sm:text-sm" : "text-sm lg:text-base"} ${tone ?? ""}`}>
      {cents ? formatMoney(cents, currency) : null}
    </span>
  );
}

// Editable contributed / gain cell — reads like text, saves on blur. Editing a
// cell writes an investment_years row, which "locks in" that account+year
// (stored value then wins over live derivation).
/**
 * Marks a Gains cell the user typed over, so the automatic figure and the
 * hand-set one can be told apart at a glance. Not a tooltip — the note under
 * the table says what it means.
 */
function PinnedMark() {
  return (
    <span aria-label="typed by hand" className="pointer-events-none absolute right-1 top-0 max-sm:text-[11px] sm:text-sm lg:text-sm leading-none text-muted">
      ✎
    </span>
  );
}

function EditCell({
  accountId,
  bucketId,
  year,
  field,
  cents,
  placeholder: showDash,
  currency,
  tone,
  compact,
}: {
  accountId: string;
  bucketId?: string;
  year: number;
  field: "contributed" | "accrued" | "start" | "end";
  cents: number;
  placeholder?: boolean;
  currency: string;
  tone: string;
  // 13px instead of 14px, matching the Investments table it sits in.
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = showDash ? "" : centsToGroupedDisplay(cents);
  // Negatives read "-$1,800.00", like the read-only money beside them, not
  // "$-1,800.00": at rest the minus sits outside, ahead of the "$", and the box
  // holds the digits. While editing the box holds the signed value so the sign
  // can be typed or removed. Keyed to `initial` so a saved change ends the
  // editing state once the new value arrives from the server.
  const negative = initial.startsWith("-");
  const shown = negative ? initial.slice(1) : initial;
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const editing = editingFor === initial;

  // The "$" sits directly against the digits and the pair is centered as one
  // unit. Pinning the symbol to the cell's left edge (accounting style) left it
  // stranded beside short values, while the read-only cells — which use
  // formatMoney — kept theirs attached, so one column read two different ways.
  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setInvestmentYear(fd))}
      className="flex w-full items-center justify-center gap-px"
    >
      {negative && !editing ? (
        <span className={`pointer-events-none select-none tabular-nums ${compact ? "text-[13px] font-semibold sm:text-sm" : "max-sm:text-[12px] sm:text-sm lg:text-base"} ${tone}`}>{MINUS}</span>
      ) : null}
      {/* The "$" takes the figure's colour, so a red or green amount reads as
          one piece instead of a black symbol stuck to a coloured number. */}
      <span className={`pointer-events-none select-none ${compact ? "text-[13px] font-semibold sm:text-sm" : "max-sm:text-[12px] sm:text-sm lg:text-base"} ${tone || "text-foreground"}`}>{currencySymbol(currency)}</span>
      <input type="hidden" name="accountId" value={accountId} />
      {bucketId ? <input type="hidden" name="bucketId" value={bucketId} /> : null}
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="field" value={field} />
      <input
        key={initial}
        name="value"
        type="text"
        inputMode="decimal"
        defaultValue={shown}
        placeholder="0.00"
        // Sized from the digits (tabular-nums makes 1ch one digit) rather than
        // the `size` attribute, whose per-character estimate runs wide and left
        // a gap between the "$" and the number.
        // The 0.6ch tail is breathing room: without it the calc lands a
        // fraction short and the browser clips the final digit.
        style={{
          width: `calc(${(initial || "0.00").replace(/[^0-9]/g, "").length}ch + ${
            (initial || "0.00").length - (initial || "0.00").replace(/[^0-9]/g, "").length
          } * 0.42ch + 0.6ch)`,
        }}
        onFocus={(e) => {
          setEditingFor(initial);
          e.currentTarget.value = initial;
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) {
            formRef.current?.requestSubmit();
          } else {
            e.currentTarget.value = shown;
            setEditingFor(null);
          }
        }}
        // Left-aligned inside its own box so the digits sit against the "$".
        // The form centres the pair, so the cell still reads centred; centring
        // the text as well pushed the number away from the symbol.
        className={`min-w-0 rounded-md bg-transparent px-0 py-0.5 text-left tabular-nums ${compact ? "text-[13px] font-semibold sm:text-sm" : "max-sm:text-[12px] sm:text-sm lg:text-base"} transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${tone} ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Secondary view: each account's contributed vs. gain across every year, so the
// "keep investing here?" trend is visible at a glance.
/**
 * The group's 31-December close for a year — null when not one account in the
 * group has closed that year yet, so the row reads "—" rather than $0.00.
 */
/**
 * Whether a year's gain was actually measured for an account: a gain on
 * file, a hand-typed one, or both an opening and a closing balance. Without
 * any of those the $0.00 isn't a result, it's a blank — shown as "—".
 */
function gainTracked(a: InvestAccount, year: number): boolean {
  const c = effectiveCell(a, year);
  return !!c.accruedManual || c.accruedCents !== 0 || (c.startBalanceCents != null && c.endBalanceCents != null);
}

function sumClose(accounts: InvestAccount[], year: number): number | null {
  let total = 0;
  let any = false;
  for (const a of accounts) {
    const c = effectiveCell(a, year).closeBalanceCents;
    if (c != null) { total += c; any = true; }
  }
  return any ? total : null;
}

function YearByYear({
  accounts,
  years,
  currency,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
}) {
  const [collapseState, setCollapseState] = useSessionCollapse("invest-yby", () => ({ open: true, mine: true, kids: true }));
  const [yByBucketsOpen, setYByBucketsOpen] = useSessionCollapse("invest-yby-buckets-open", () => ({}));
  const open = collapseState.open;
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, open: typeof v === "function" ? v(s.open) : v }));
  const mineCollapsed = collapseState.mine;
  const setMineCollapsed = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, mine: typeof v === "function" ? v(s.mine) : v }));
  const kidsCollapsed = collapseState.kids;
  const setKidsCollapsed = (v: boolean | ((p: boolean) => boolean)) => setCollapseState((s) => ({ ...s, kids: typeof v === "function" ? v(s.kids) : v }));
  const desc = useMemo(() => [...years].sort((a, b) => b - a), [years]);
  const mine = accounts.filter((a) => !a.isKids);
  const kids = accounts.filter((a) => a.isKids);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-t-2xl bg-brand-soft/30 px-4 py-2.5 text-left transition hover:bg-brand-soft/50"
        aria-expanded={open}
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <h2 className="text-sm lg:text-base font-bold">Yearly Breakdown Overview</h2>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full max-sm:text-[12px] sm:text-sm lg:text-base">
            <thead>
              <tr className="max-sm:text-[12px] sm:text-sm lg:text-sm uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-semibold">Account</th>
                <th className="px-3 py-2 text-left font-semibold">Metric</th>
                {desc.map((y) => (
                  <th key={y} className="px-3 py-2 text-center font-semibold">{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="cursor-pointer hover:bg-brand-soft/20" onClick={() => setMineCollapsed((c) => !c)}>
                <td className="bg-background/60 px-4 py-1.5">
                  <span className="flex items-center gap-1.5 whitespace-nowrap max-sm:text-[12px] sm:text-sm lg:text-sm font-semibold uppercase tracking-wide text-muted">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${mineCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                    Investments
                  </span>
                </td>
                {/* One label per line, lined up with the figures beside it: contributed
                    on top, gain under it, EOY only once a year has closed. */}
                <td className="bg-background/60 px-3 py-1.5 max-sm:text-[12px] sm:text-sm lg:text-sm text-muted">
                  <span className="block">Contributed</span>
                  <span className="block">Gain</span>
                  {desc.some((y) => sumClose(mine, y) != null) ? <span className="block">EOY</span> : null}
                </td>
                {desc.map((y) => {
                  const contrib = mine.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                  const gain = mine.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                  const eoy = sumClose(mine, y);
                  return (
                    <td key={y} className="bg-background/60 px-3 py-1.5 whitespace-nowrap text-center max-sm:text-[12px] sm:text-sm lg:text-sm tabular-nums font-bold text-muted">
                      <span className="block text-foreground">{formatMoney(contrib, currency)}</span><span className={`block ${gainTone(gain)}`}>{mine.some((a) => gainTracked(a, y)) ? formatMoney(gain, currency) : "—"}</span>{eoy == null ? null : <span className="block">{formatMoney(eoy, currency)}</span>}
                    </td>
                  );
                })}
              </tr>
              {!mineCollapsed && mine.map((a) => (
                <YByAccountRows
                  key={a.id}
                  account={a}
                  desc={desc}
                  currency={currency}
                  open={!!yByBucketsOpen[a.id]}
                  onToggle={() => setYByBucketsOpen((s) => ({ ...s, [a.id]: !s[a.id] }))}
                />
              ))}
              {kids.length > 0 && (
                <tr className="cursor-pointer hover:bg-brand-soft/20" onClick={() => setKidsCollapsed((c) => !c)}>
                  <td className="border-t-2 border-line bg-background/60 px-4 py-1.5">
                    <span className="flex items-center gap-1.5 whitespace-nowrap max-sm:text-[12px] sm:text-sm lg:text-sm font-semibold uppercase tracking-wide text-muted">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${kidsCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                      Kids Funding
                    </span>
                  </td>
                  {/* One label per line, lined up with the figures beside it: contributed
                    on top, gain under it, EOY only once a year has closed. */}
                <td className="border-t-2 border-line bg-background/60 px-3 py-1.5 max-sm:text-[12px] sm:text-sm lg:text-sm text-muted">
                  <span className="block">Contributed</span>
                  <span className="block">Gain</span>
                  {desc.some((y) => sumClose(kids, y) != null) ? <span className="block">EOY</span> : null}
                </td>
                  {desc.map((y) => {
                    const contrib = kids.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                    const gain = kids.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                    const eoy = sumClose(kids, y);
                    return (
                      <td key={y} className="border-t-2 border-line bg-background/60 px-3 py-1.5 whitespace-nowrap text-center max-sm:text-[12px] sm:text-sm lg:text-sm tabular-nums font-bold text-muted">
                        <span className="block text-foreground">{formatMoney(contrib, currency)}</span><span className={`block ${gainTone(gain)}`}>{kids.some((a) => gainTracked(a, y)) ? formatMoney(gain, currency) : "—"}</span>{eoy == null ? null : <span className="block">{formatMoney(eoy, currency)}</span>}
                      </td>
                    );
                  })}
                </tr>
              )}
              {!kidsCollapsed && kids.map((a) => (
                <YByAccountRows
                  key={a.id}
                  account={a}
                  desc={desc}
                  currency={currency}
                  // Kids accounts always have buckets (one per kid) and the
                  // editable Gain cells live at the bucket level. Default the
                  // per-account expander to open (unless the user has
                  // explicitly collapsed it this session) so the editable
                  // cells are visible without an extra click.
                  open={yByBucketsOpen[a.id] !== false}
                  onToggle={() => setYByBucketsOpen((s) => ({ ...s, [a.id]: s[a.id] === false ? true : false }))}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function YByAccountRows({
  account,
  desc,
  currency,
  open,
  onToggle,
}: {
  account: InvestAccount;
  desc: number[];
  currency: string;
  open: boolean;
  onToggle: () => void;
}) {
  const hasBuckets = account.buckets.length > 0;
  // EOY (the 31 December close) only once some year has one — until then it
  // was a line of dashes under every account and bucket.
  const showEoy = desc.some((y) => effectiveCell(account, y).closeBalanceCents != null);
  // An account with buckets opens and closes from anywhere on its three rows
  // (name, Contributed, Gain, EOY) — nothing in them is editable, since its
  // gains are typed on the bucket rows.
  // Hover tints all three rows as one block: tinting only the row under the
  // pointer flickered strip by strip as it moved down the account.
  const [hovered, setHovered] = useState(false);
  const rowToggle = hasBuckets
    ? {
        onClick: onToggle,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        className: `cursor-pointer ${hovered ? "bg-sky-50 dark:bg-sky-950/40" : ""}`,
      }
    : { onClick: undefined, onMouseEnter: undefined, onMouseLeave: undefined, className: "" };
  return (
    <>
      <tr onClick={rowToggle.onClick} onMouseEnter={rowToggle.onMouseEnter} onMouseLeave={rowToggle.onMouseLeave} className={`border-t border-line/70 ${rowToggle.className}`}>
        <td rowSpan={showEoy ? 3 : 2} className="px-4 py-2 align-top font-bold">
          <span className="flex items-center gap-1.5">
            {hasBuckets ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                aria-expanded={open}
                aria-label={open ? "Collapse buckets" : "Expand buckets"}
                className="rounded p-0.5 text-muted hover:bg-brand-soft/40 hover:text-foreground"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}
            {account.name}
            {hasBuckets ? (
              <span className="rounded bg-brand-soft/40 px-1.5 py-0.5 max-sm:text-[11px] sm:text-sm lg:text-sm font-normal text-muted">
                {account.buckets.length} bucket{account.buckets.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </td>
        <td className="px-3 py-1.5 text-muted">Contributed</td>
        {desc.map((y) => (
          <td key={y} className="px-3 py-1.5 text-center tabular-nums font-bold">
            {hasBuckets ? (
              formatMoney(effectiveCell(account, y).contributedCents, currency)
            ) : (
              formatMoney(account.cells[y]?.contributedCents ?? 0, currency)
            )}
          </td>
        ))}
      </tr>
      <tr onClick={rowToggle.onClick} onMouseEnter={rowToggle.onMouseEnter} onMouseLeave={rowToggle.onMouseLeave} className={rowToggle.className}>
        <td className="px-3 py-1.5 text-muted">Gain</td>
        {desc.map((y) => {
          const g = effectiveCell(account, y).accruedCents;
          const rawG = account.cells[y]?.accruedCents ?? 0;
          return (
            <td key={y} className={`px-3 py-1.5 text-center tabular-nums font-bold ${gainTone(g)}`}>
              {hasBuckets ? (
                gainTracked(account, y) ? formatMoney(g, currency) : "—"
              ) : (
                <EditCell accountId={account.id} year={y} field="accrued" cents={rawG} currency={currency} tone={gainTone(rawG)} />
              )}
            </td>
          );
        })}
      </tr>
      {showEoy ? (
        <tr onClick={rowToggle.onClick} onMouseEnter={rowToggle.onMouseEnter} onMouseLeave={rowToggle.onMouseLeave} className={rowToggle.className}>
          <td className="px-3 py-1.5 text-muted">EOY</td>
          {desc.map((y) => {
            const close = effectiveCell(account, y).closeBalanceCents;
            return (
              <td key={y} className="px-3 py-1.5 text-center tabular-nums font-bold text-muted">
                {close == null ? "—" : formatMoney(close, currency)}
              </td>
            );
          })}
        </tr>
      ) : null}
      {hasBuckets && open
        ? account.buckets.map((b) => (
            <Fragment key={b.id}>
              <tr className="border-t border-line/40 bg-background/30">
                <td rowSpan={desc.some((y) => b.cells[y]?.closeBalanceCents != null) ? 3 : 2} className="px-4 py-1.5 pl-10 align-top max-sm:text-[12px] sm:text-sm lg:text-base text-muted">↳ {b.name}</td>
                <td className="px-3 py-1 max-sm:text-[12px] sm:text-sm lg:text-base text-muted">Contributed</td>
                {desc.map((y) => (
                  <td key={y} className="px-3 py-1 text-center max-sm:text-[12px] sm:text-sm lg:text-base tabular-nums text-muted">
                    {formatMoney(b.cells[y]?.contributedCents ?? 0, currency)}
                  </td>
                ))}
              </tr>
              <tr className="bg-background/30">
                <td className="px-3 py-1 max-sm:text-[12px] sm:text-sm lg:text-base text-muted">Gain</td>
                {desc.map((y) => {
                  const g = b.cells[y]?.accruedCents ?? 0;
                  return (
                    <td key={y} className={`px-3 py-1 text-center max-sm:text-[12px] sm:text-sm lg:text-base tabular-nums ${gainTone(g)}`}>
                      <EditCell accountId={account.id} bucketId={b.id} year={y} field="accrued" cents={g} currency={currency} tone={gainTone(g)} />
                    </td>
                  );
                })}
              </tr>
              {desc.some((y) => b.cells[y]?.closeBalanceCents != null) ? (
                <tr className="bg-background/30">
                  <td className="px-3 py-1 max-sm:text-[12px] sm:text-sm lg:text-base text-muted">EOY</td>
                  {desc.map((y) => {
                    const close = b.cells[y]?.closeBalanceCents ?? null;
                    return (
                      <td key={y} className="px-3 py-1 text-center max-sm:text-[12px] sm:text-sm lg:text-base tabular-nums text-muted">
                        {close == null ? "—" : formatMoney(close, currency)}
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </Fragment>
          ))
        : null}
    </>
  );
}

// ─── Transfer modal ────────────────────────────────────────────────────────

function TransferModal({
  accounts,
  destAccounts,
  currency,
  onClose,
}: {
  accounts: InvestAccount[];
  destAccounts: DestAccount[];
  currency: string;
  onClose: () => void;
}) {
  useScrollLock();
  const [pending, start] = useTransition();
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [sourceBucketId, setSourceBucketId] = useState("");
  const [destAccountId, setDestAccountId] = useState("");
  const [destBucketId, setDestBucketId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");

  const srcAccount = accounts.find((a) => a.id === sourceAccountId);
  const hasBuckets = (srcAccount?.buckets.length ?? 0) > 0;
  const destBuckets = destAccounts.find((a) => a.id === destAccountId)?.buckets ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("sourceAccountId", sourceAccountId);
    if (sourceBucketId) fd.set("sourceBucketId", sourceBucketId);
    fd.set("destAccountId", destAccountId);
    if (destBucketId) fd.set("destBucketId", destBucketId);
    fd.set("amount", amount);
    fd.set("date", date);
    if (memo) fd.set("memo", memo);
    start(async () => {
      setErrorMsg(null);
      const r = await transferFromInvestment(fd);
      if (r.error) setErrorMsg(r.error);
      else onClose();
    });
  };

  return (
    // Scrollable and viewport-capped: with six fields plus the iOS keyboard the
    // submit button used to end up below the fold with no way to reach it.
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface shadow-xl ring-1 ring-black/10 sm:rounded-2xl dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">Transfer / Withdraw</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted transition hover:bg-brand-soft hover:text-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {/* Source account */}
          <label className="block">
            <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">From (investment account)</span>
            <select
              required
              value={sourceAccountId}
              onChange={(e) => { setSourceAccountId(e.target.value); setSourceBucketId(""); }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Select investment account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.holder ? ` (${a.holder})` : ""}</option>
              ))}
            </select>
          </label>

          {/* Source bucket (when account has buckets) */}
          {hasBuckets && (
            <label className="block">
              <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">Bucket</span>
              <select
                required
                value={sourceBucketId}
                onChange={(e) => setSourceBucketId(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {srcAccount!.buckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} — {formatMoney(b.balanceCents, currency)}</option>
                ))}
              </select>
            </label>
          )}

          {/* Destination account */}
          <label className="block">
            <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">To (banking account)</span>
            <select
              required
              value={destAccountId}
              onChange={(e) => { setDestAccountId(e.target.value); setDestBucketId(""); }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Select destination account</option>
              {destAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          {/* Destination bucket (when the banking account has buckets) */}
          {destBuckets.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">Into bucket</span>
              <select
                required
                value={destBucketId}
                onChange={(e) => setDestBucketId(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {destBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* Amount */}
          <label className="block">
            <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">Amount</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{currencySymbol(currency)}</span>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface py-2 pl-7 pr-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </label>

          {/* Date */}
          <label className="block">
            <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">Date</span>
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>

          {/* Memo */}
          <label className="block">
            <span className="mb-1 block text-xs sm:text-sm font-medium text-foreground">Note</span>
            <input
              type="text"
              placeholder="Transfer note (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>

          {errorMsg ? <p className="text-sm font-medium text-negative">{errorMsg}</p> : null}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-brand-soft hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !sourceAccountId || !destAccountId || !amount || !date}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-40"
            >
              {pending ? "Transferring…" : "Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

