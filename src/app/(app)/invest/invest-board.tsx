"use client";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import {
  TAX_COLOR,
  TAX_LABEL,
  TAX_MEANING,
  resolveTaxTreatment,
  type TaxTreatment,
} from "@/lib/tax-treatment";
import { setInvestmentYear, transferFromInvestment } from "./actions";
import { ImportInvestmentModal } from "./import-modal";
import { moveInvestmentImport } from "./import-actions";
import { reorderAccounts } from "../accounts/actions";
import { useSessionCollapse } from "@/lib/use-session-collapse";

export type YearCell = {
  year: number;
  startBalanceCents: number | null;
  endBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
  stored: boolean;
};

export type BucketRow = {
  id: string;
  name: string;
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
  symbol: string | null;
  securityName: string;
  quantity: number | null;
  priceCents: number | null;
  marketValueCents: number;
  costBasisCents: number | null;
  unrealizedGainCents: number | null;
  unrealizedGainPercent: number | null;
};

export type InvestmentPerformanceImportRow = {
  asOfDate: string;
  beginningBalanceCents: number | null;
  contributionsCents: number | null;
  withdrawalsCents: number | null;
  dividendsCents: number | null;
  feesCents: number | null;
  marketChangeCents: number | null;
  endingBalanceCents: number;
};

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
  for (const b of a.buckets) {
    const c = b.cells[year];
    if (!c) continue;
    contributed += c.contributedCents;
    accrued += c.accruedCents;
    if (c.startBalanceCents != null) start = (start ?? 0) + c.startBalanceCents;
    if (c.endBalanceCents != null) end = (end ?? 0) + c.endBalanceCents;
  }
  return {
    year,
    startBalanceCents: start,
    endBalanceCents: end,
    contributedCents: contributed,
    accruedCents: accrued,
    stored: !!(parent?.stored ?? false),
  };
}

export type DestAccount = { id: string; name: string };

type Props = {
  accounts: InvestAccount[];
  years: number[]; // newest first
  currency: string;
  destAccounts: DestAccount[];
  imports: InvestmentImportView[];
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

const gainTone = (cents: number) =>
  cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "text-foreground";

// Gain measured against the year's deposits, in DOLLARS (cents): gains −
// contributions. Positive when investments made more than was paid in that
// year. Null when neither contributed nor gained (nothing to compare).
//
// Deliberately NOT a rate of return: a true return needs the beginning
// balance, and `investment_years.start_cents` is empty for every historical
// year. Account snapshots only begin Jan 2026, so a real return is computable
// for 2026 onward at the earliest — until then this stays a dollar figure and
// is labelled as one.
function gainVsContributed(cell: {
  startBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
}): number | null {
  if (cell.contributedCents === 0 && cell.accruedCents === 0) return null;
  return cell.accruedCents - cell.contributedCents;
}

export function InvestBoard({ accounts, years, currency, destAccounts, imports }: Props) {
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openTax, setOpenTax] = useState<TaxTreatment | null>(null);

  const mine = accounts.filter((a) => !a.isKids);
  const selectedAccount = selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null;
  const chartAccounts = selectedAccount ? [selectedAccount] : mine;

  const yearIdx = years.indexOf(year);
  const goPrev = () => yearIdx < years.length - 1 && setYear(years[yearIdx + 1]);
  const goNext = () => yearIdx > 0 && setYear(years[yearIdx - 1]);

  // Summary totals for the selected year (used in hero + stats bar).
  const summary = useMemo(() => {
    let contributed = 0;
    let gains = 0;
    let current = 0;
    for (const a of mine) {
      const c = effectiveCell(a, year);
      contributed += c.contributedCents;
      gains += c.accruedCents;
      if (c.endBalanceCents != null) current += c.endBalanceCents;
    }
    const accountCount = mine.reduce((sum, a) => sum + (a.buckets.length > 0 ? a.buckets.length : 1), 0);
    return { contributed, gains, current, accountCount };
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
    const rows: { label: string; cents: number }[] = [];
    for (const a of mine) {
      if (a.buckets.length > 0) {
        for (const b of a.buckets) {
          if (b.balanceCents > 0) rows.push({ label: `${a.name} · ${b.name}`, cents: b.balanceCents });
        }
      } else if (a.balanceCents > 0) {
        rows.push({ label: a.name, cents: a.balanceCents });
      }
    }
    const total = rows.reduce((s, r) => s + r.cents, 0);
    rows.sort((a, b) => b.cents - a.cents);
    return { rows, total, top: rows[0] ?? null };
  }, [mine]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-7">
      {/* Header: title + hero total return + year nav */}
      <header className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Investments</h1>
            <p className="mt-1 text-sm text-muted">
            Contributions vs. unrealized gains, per account, per year.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:flex-nowrap lg:justify-end">
            <button
              type="button"
              onClick={() => setShowTransfer(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-brand ring-1 ring-brand/20 transition hover:bg-brand-soft/80"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 17l10-10M17 7v10M17 7H7" />
              </svg>
              Transfer/Withdraw
            </button>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Total gains ({year})
              </p>
              <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${summary.gains >= 0 ? "text-positive" : "text-negative"}`}>
                {summary.gains >= 0 ? "+" : ""}{formatMoney(summary.gains, currency)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrev}
                disabled={yearIdx >= years.length - 1}
                aria-label="Previous year"
                className="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <select
                aria-label="Year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="cursor-pointer rounded-lg bg-background px-3 py-2 text-sm font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={goNext}
                disabled={yearIdx <= 0}
                aria-label="Next year"
                className="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="max-w-3xl rounded-xl bg-brand-soft/50 ring-1 ring-brand/20">
          <button
            type="button"
            onClick={() => setShowGuide((open) => !open)}
            aria-expanded={showGuide}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-foreground"
          >
            <span>How investment tracking works</span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-brand">
              <span>{showGuide ? "Hide details" : "Show details"}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showGuide ? "rotate-90" : ""}`} aria-hidden>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </button>
          {showGuide ? (
            <div className="border-t border-brand/15 px-4 pb-4 pt-3 text-sm text-foreground/80">
              <p className="mb-3 text-xs text-muted">Use the selected year to review each investment account against its year-end statement.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand">Contributions</p>
                  <p className="text-xs leading-relaxed">Log a deposit transaction to any investment account — it auto-adds to <span className="font-semibold text-foreground">Contrib</span> here.</p>
                </div>
                <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand">Gains / Losses</p>
                  <p className="text-xs leading-relaxed">At year-end, type the market gain or loss from your brokerage statement into <span className="font-semibold text-foreground">Gains</span>.</p>
                </div>
                <div className="rounded-lg bg-surface/60 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand">Current balance</p>
                  <p className="text-xs leading-relaxed">Update the account balance on <span className="font-semibold text-foreground">Accounts</span> to match your brokerage&apos;s ending balance.</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-2xl bg-surface px-6 py-12 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm text-muted">
            No investment accounts yet. Add one on the Accounts page (kind:
            Investment) to track its performance here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary stats bar */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-black/5 dark:ring-white/10 sm:grid-cols-4">
            <SummaryStat label="Total contributed" value={formatMoney(summary.contributed, currency)} />
            <SummaryStat
              label="Unrealized gains"
              value={formatMoney(summary.gains, currency)}
              tone={summary.gains >= 0 ? "text-[color:var(--viz-bills)]" : "text-negative"}
            />
            <SummaryStat label="Current value" value={formatMoney(summary.current, currency)} />
            <SummaryStat label="Accounts" value={String(summary.accountCount)} />
          </div>

          {taxSplit.rows.length > 1 ? (
            <section className="rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <h2 className="text-sm font-bold">How it&rsquo;s taxed</h2>
                <span className="text-sm font-semibold tabular-nums text-muted">
                  {formatMoney(taxSplit.total, currency)} total
                </span>
                <p className="w-full text-xs text-muted">
                  Select a band to see what&rsquo;s in it and what it means.
                </p>
              </div>
              <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-line/60">
                {taxSplit.rows.map((r) => (
                  <span
                    key={r.treatment}
                    style={{
                      width: `${(r.cents / taxSplit.total) * 100}%`,
                      backgroundColor: TAX_COLOR[r.treatment],
                    }}
                  />
                ))}
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {taxSplit.rows.map((r) => {
                  const open = openTax === r.treatment;
                  return (
                    <li key={r.treatment}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenTax(open ? null : r.treatment)}
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                          open
                            ? "bg-black/10 ring-1 ring-black/15 dark:bg-white/15 dark:ring-white/20"
                            : "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: TAX_COLOR[r.treatment] }}
                          aria-hidden
                        />
                        <span className="text-muted">{TAX_LABEL[r.treatment]}</span>
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
                .filter((r) => r.treatment === openTax)
                .map((r) => (
                  <div key={r.treatment} className="mt-2.5 rounded-xl bg-canvas/60 px-3 py-2.5">
                    <p className="text-xs text-muted">{TAX_MEANING[r.treatment]}</p>
                    {/* Columns, not one tall list: a band can hold eight
                        holdings, and a single column strands every amount at
                        the far right edge of a wide card, miles from its own
                        label. Narrower columns keep the two together. */}
                    <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                      {r.holdings.map((h) => (
                        <li
                          key={h.name}
                          className="flex items-baseline justify-between gap-2 border-b border-line/40 py-0.5 text-xs last:border-0"
                        >
                          <span className="min-w-0 truncate">{h.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {formatMoney(h.cents, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-muted">
                      Set each holding&rsquo;s tax treatment on Accounts. Anything left on Auto
                      is read from its name.
                    </p>
                  </div>
                ))}
            </section>
          ) : null}

          {allocation.rows.length > 1 && allocation.total > 0 ? (
            <section className="rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-bold">Where it sits</h2>
                {allocation.top ? (
                  <span className="text-[11px] text-muted">
                    largest holding{" "}
                    <span
                      className="font-semibold tabular-nums"
                      style={{
                        color:
                          (allocation.top.cents / allocation.total) > 0.4
                            ? "var(--negative)"
                            : "var(--viz-savings)",
                      }}
                    >
                      {((allocation.top.cents / allocation.total) * 100).toFixed(0)}%
                    </span>
                  </span>
                ) : null}
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {allocation.rows.slice(0, 8).map((r) => {
                  const pct = (r.cents / allocation.total) * 100;
                  return (
                    <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs">{r.label}</span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums">
                            {formatMoney(r.cents, currency)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: "var(--viz-savings)" }}
                          />
                        </div>
                      </div>
                      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted">
                        {pct.toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {showTransfer && (
            <TransferModal
              accounts={accounts}
              destAccounts={destAccounts}
              currency={currency}
              onClose={() => setShowTransfer(false)}
            />
          )}
          {showImport && (
            <ImportInvestmentModal accounts={accounts} onClose={() => setShowImport(false)} />
          )}
          <PerformanceChart accounts={chartAccounts} years={years} currency={currency} selectedName={selectedAccount?.name ?? null} onClear={() => setSelectedId(null)} />
          <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <PerfTable title="Investments" accounts={mine} year={year} currency={currency} selectedId={selectedId} onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} noCard />
            <div className="border-t border-foreground/10" />
            <YearByYear accounts={accounts} years={years} currency={currency} />
          </div>
          <ImportedSnapshots imports={imports} accounts={accounts} currency={currency} onImport={() => setShowImport(true)} />
        </>
      )}
    </div>
  );
}

function ImportedSnapshots({ imports, accounts, currency, onImport }: { imports: InvestmentImportView[]; accounts: InvestAccount[]; currency: string; onImport: () => void }) {
  const groups = new Map<string, InvestmentImportView[]>();
  for (const item of imports) {
    const key = `${item.accountId}:${item.bucketId ?? "_"}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const [groupOpen, setGroupOpen] = useSessionCollapse("invest-import-groups", () => ({}));

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-soft/35 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Imported investment data</h2>
          <p className="mt-0.5 text-xs text-muted">Saved CSV snapshots remain separate from your live account balance and can be reviewed here.</p>
        </div>
        <button type="button" onClick={onImport} className="shrink-0 rounded-lg bg-brand-soft px-3 py-2 text-xs font-semibold text-brand ring-1 ring-brand/20 transition hover:bg-brand-soft/80">Import CSV</button>
      </div>
      <div className="divide-y divide-line">
        {groups.size === 0 ? <p className="px-4 py-5 text-sm text-muted">No imported investment data yet.</p> : [...groups.entries()].map(([groupKey, items]) => {
          const first = items[0];
          const latestPositions = items.filter((item) => item.importKind === "positions").sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
          const latestPerformance = items.filter((item) => item.importKind === "performance").sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
          const currentValue = latestPositions
            ? latestPositions.positions.reduce((sum, row) => sum + row.marketValueCents, 0)
            : latestPerformance?.performance[0]?.endingBalanceCents ?? 0;
          const kinds = [...new Set(items.map((item) => item.importKind === "positions" ? "Portfolio positions" : "Monthly performance"))].join(" · ");
          return (
            <details key={groupKey} open={!!groupOpen[groupKey]} className="group">
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  setGroupOpen((state) => ({ ...state, [groupKey]: !state[groupKey] }));
                }}
                className="flex cursor-pointer list-none items-center gap-3 bg-brand-soft/25 px-4 py-3 marker:hidden transition hover:bg-brand-soft/45"
              >
                <span className="text-muted transition-transform group-open:rotate-90">›</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{first.provider !== "Other" ? `${first.provider} · ` : ""}{first.accountName}{first.bucketName ? ` · ${first.bucketName}` : ""}</span>
                  <span className="block text-xs text-muted">{kinds} · {items.length} import{items.length === 1 ? "" : "s"}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(currentValue, currency)}</span>
              </summary>
              <div className="divide-y divide-line border-t border-line bg-background/30">
                {items.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate)).map((item) => (
                  <details key={item.id} className="group/item">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 pl-9 marker:hidden transition hover:bg-brand-soft/25">
                      <span className="text-muted transition-transform group-open/item:rotate-90">›</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{item.importKind === "positions" ? "Portfolio positions" : "Monthly performance"}</span>
                        <span className="block text-[11px] text-muted">{item.sourceFilename ?? "Imported CSV"} · as of {item.asOfDate} · {item.rowCount} rows</span>
                      </span>
                    </summary>
                    <div className="border-t border-line bg-background/40 px-4 py-3">
                      <MoveImportForm item={item} accounts={accounts} />
                      {item.importKind === "positions" ? <ImportedPositionsTable rows={item.positions} currency={currency} /> : <ImportedPerformanceTable rows={item.performance} currency={currency} />}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function MoveImportForm({ item, accounts }: { item: InvestmentImportView; accounts: InvestAccount[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [accountId, setAccountId] = useState(item.accountId);
  const [bucketId, setBucketId] = useState(item.bucketId ?? "");
  const selected = accounts.find((account) => account.id === accountId);

  if (!editing) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
        <span className="min-w-0 truncate text-[11px] text-muted">Imported to {selected?.name ?? item.accountName}{bucketId ? ` · ${selected?.buckets.find((bucket) => bucket.id === bucketId)?.name ?? item.bucketName ?? "Bucket"}` : " · Account total"}</span>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft/80">Edit destination</button>
      </div>
    );
  }

  return (
    <form action={(formData) => start(async () => {
      const result = await moveInvestmentImport(formData);
      if (result?.error) setMessage(result.error);
      else setEditing(false);
    })} className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
      <input type="hidden" name="batchId" value={item.id} />
      <label className="block min-w-48 flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Imported to
        <select name="accountId" value={accountId} onChange={(event) => { setAccountId(event.target.value); setBucketId(""); }} className="mt-1 w-full rounded-md bg-background px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isKids ? " · Kids Funding" : ""}</option>)}
        </select>
      </label>
      <label className="block min-w-40 flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Bucket
        <select name="bucketId" value={bucketId} onChange={(event) => setBucketId(event.target.value)} className="mt-1 w-full rounded-md bg-background px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">Account total</option>
          {(selected?.buckets ?? []).map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending || (accountId === item.accountId && bucketId === (item.bucketId ?? ""))} className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft/80 disabled:opacity-50">{pending ? "Updating…" : "Update destination"}</button>
      <button type="button" onClick={() => { setEditing(false); setMessage(null); }} className="rounded-md px-2 py-1.5 text-xs font-medium text-muted hover:bg-background">Cancel</button>
      {message ? <span className={`w-full text-[11px] ${message === "Destination updated." ? "text-positive" : "text-negative"}`}>{message}</span> : null}
    </form>
  );
}

function ImportedPositionsTable({ rows, currency }: { rows: InvestmentPositionImportRow[]; currency: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-line">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Current value</th><th className="px-3 py-2 text-right">Cost basis</th><th className="px-3 py-2 text-right">Gain/loss</th><th className="px-3 py-2 text-right">Gain/loss %</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => <tr key={`${row.symbol ?? row.securityName}-${index}`}>
            <td className="px-3 py-2 font-medium">{row.symbol ?? row.securityName}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.quantity ?? "—"}</td>
            <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.marketValueCents, currency)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.costBasisCents == null ? "—" : formatMoney(row.costBasisCents, currency)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${gainTone(row.unrealizedGainCents ?? 0)}`}>{row.unrealizedGainCents == null ? "—" : formatMoney(row.unrealizedGainCents, currency)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${gainTone(row.unrealizedGainPercent ?? 0)}`}>{row.unrealizedGainPercent == null ? "—" : `${row.unrealizedGainPercent.toFixed(2)}%`}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ImportedPerformanceTable({ rows, currency }: { rows: InvestmentPerformanceImportRow[]; currency: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-line">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Beginning balance</th><th className="px-3 py-2 text-right">Market change</th><th className="px-3 py-2 text-right">Dividends</th><th className="px-3 py-2 text-right">Withdrawal</th><th className="px-3 py-2 text-right">Ending balance</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => <tr key={row.asOfDate}>
            <td className="px-3 py-2">{row.asOfDate}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.beginningBalanceCents == null ? "—" : formatMoney(row.beginningBalanceCents, currency)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${gainTone(row.marketChangeCents ?? 0)}`}>{row.marketChangeCents == null ? "—" : formatMoney(row.marketChangeCents, currency)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${gainTone(row.dividendsCents ?? 0)}`}>{row.dividendsCents == null ? "—" : formatMoney(row.dividendsCents, currency)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${gainTone(-(row.withdrawalsCents ?? 0))}`}>{row.withdrawalsCents == null ? "—" : formatMoney(row.withdrawalsCents, currency)}</td>
            <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(row.endingBalanceCents, currency)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 bg-surface px-4 py-4 text-center sm:px-5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

// ─── Performance chart ───────────────────────────────────────────────────────

type ChartMode = "stacked" | "grouped" | "return";

function PerformanceChart({
  accounts,
  years,
  currency,
  selectedName,
  onClear,
}: {
  accounts: InvestAccount[];
  years: number[];
  currency: string;
  selectedName: string | null;
  onClear: () => void;
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
        // Simple return: gains ÷ contributions × 100.
        // Gain as a percentage of the year's contributions. NOT a rate of return
        // (that needs a beginning balance, which is not recorded before 2026).
        const returnPctVal = contrib > 0 ? (gain / contrib) * 100 : 0;
        return { year: y, contrib, gain, endBal: endAny ? endBal : null, returnPct: returnPctVal };
      }),
    [desc, accounts],
  );

  const W = 600;
  const H = 220;
  const PAD = { top: 32, right: 16, bottom: 32, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Max depends on mode: stacked sums, grouped is max of either, return is %.
  const maxBar = useMemo(() => {
    if (mode === "return") {
      const m = Math.max(...bars.map((b) => Math.abs(b.returnPct)), 1);
      return Math.ceil(m / 5) * 5;
    }
    if (mode === "grouped") {
      return Math.max(...bars.map((b) => Math.max(b.contrib, Math.max(b.gain, 0))), 1);
    }
    return Math.max(...bars.map((b) => b.contrib + Math.max(b.gain, 0)), 1);
  }, [bars, mode]);

  const niceCeil = mode === "return" ? maxBar : Math.ceil(maxBar / 10000) * 10000;
  const scale = (v: number) => (v / niceCeil) * chartH;

  const slotW = chartW / bars.length;
  const barW = mode === "grouped"
    ? Math.min(20, (chartW / bars.length) * 0.28)
    : Math.min(40, (chartW / bars.length) * 0.55);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => (mode === "return" ? +(niceCeil * f).toFixed(1) : Math.round(niceCeil * f)));

  // Compact money formatter: input is CENTS, output uses $k for anything >= $1,000.
  const compactMoney = (cents: number) => {
    const dollars = Math.abs(cents) / 100;
    const sign = cents < 0 ? "-" : "";
    if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
    return `${sign}$${dollars.toFixed(0)}`;
  };

  const fmtTick = (t: number) => (mode === "return" ? `${t}%` : compactMoney(t));

  const fmtBarTotal = (b: typeof bars[number]) => {
    if (mode === "return") return `${b.returnPct >= 0 ? "+" : ""}${b.returnPct.toFixed(1)}%`;
    const total = mode === "stacked" ? b.contrib + Math.max(b.gain, 0) : Math.max(b.contrib, b.gain);
    return `Total: ${compactMoney(total)}`;
  };

  return (
    <section className="overflow-visible rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-2 rounded-t-2xl bg-brand-soft/35 px-4 py-3 ring-1 ring-brand/10">
        <button
          type="button"
          onClick={() => setChartOpen(!chartOpen)}
          aria-expanded={chartOpen}
          className="flex items-center gap-2 text-left"
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
            <p className="text-xs text-muted">
              {mode === "stacked" ? "Stacked: contributions + gains" : mode === "grouped" ? "Grouped: side-by-side comparison" : "Gain vs contributions each year — not a rate of return"}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex overflow-hidden rounded-lg ring-1 ring-line text-[11px]">
            {(["stacked", "grouped", "return"] as ChartMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 font-medium capitalize transition ${mode === m ? "bg-brand-soft text-brand" : "text-muted hover:bg-brand-soft/40 hover:text-foreground"}`}
              >
                {m === "return" ? "Gain" : m}
              </button>
            ))}
          </div>
          {selectedName ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-muted ring-1 ring-line hover:bg-brand-soft hover:text-foreground"
            >
              ✕ Clear filter
            </button>
          ) : null}
        </div>
      </div>

      {chartOpen ? <>
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pb-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-savings)" }} />
          Contributed
        </span>
        {mode !== "return" ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-bills)" }} />
            Unrealized gains
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-bills)" }} />
            Annual return %
          </span>
        )}
      </div>

      {/* SVG chart */}
      <div className="relative px-2 pb-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "clamp(160px, 24vw, 220px)" }}
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
                  textAnchor="end" fontSize="9" fill="currentColor" opacity="0.4"
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
            } else if (mode === "grouped") {
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
            } else {
              // return: single bar for return pct
              const h = scale(Math.abs(b.returnPct));
              const bx = cx - barW / 2;
              const fill = b.returnPct >= 0 ? "var(--viz-bills)" : "var(--negative)";
              rects.push({ x: bx, y: PAD.top + chartH - h, w: barW, h, fill });
              totalTopY = PAD.top + chartH - h;
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
                    textAnchor="middle" fontSize="9.5" fontWeight="600"
                    fill="currentColor" opacity="0.7" pointerEvents="none"
                  >
                    {fmtBarTotal(b)}
                  </text>
                ) : null}
                {/* X-axis label */}
                <text
                  x={cx} y={PAD.top + chartH + 14}
                  textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.45"
                >
                  {b.year}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered !== null && bars[hovered] ? (
          <ChartTooltip b={bars[hovered]} hovered={hovered} total={bars.length} currency={currency} mode={mode} />
        ) : null}
      </div>
      </> : null}
    </section>
  );
}

function ChartTooltip({
  b,
  hovered,
  total,
  currency,
  mode,
}: {
  b: { year: number; contrib: number; gain: number; endBal: number | null; returnPct: number };
  hovered: number;
  total: number;
  currency: string;
  mode: ChartMode;
}) {
  const slotPct = ((hovered + 0.5) / total) * 100;
  return (
    <div
      className="pointer-events-none absolute top-2 rounded-xl bg-surface px-3 py-2 text-xs shadow-lg ring-1 ring-black/10 dark:ring-white/15"
      style={{
        left: `${slotPct}%`,
        transform: slotPct > 60 ? "translateX(-100%)" : "translateX(0)",
        zIndex: 10,
      }}
    >
      <div className="mb-1.5 font-semibold">{b.year}</div>
      <div className="space-y-0.5 text-muted">
        <div>Contributed <span className="font-medium text-foreground">{formatMoney(b.contrib, currency)}</span></div>
        <div>
          Unrealized gains{" "}
          <span className="font-medium" style={{ color: b.gain >= 0 ? "var(--viz-bills)" : "var(--color-negative)" }}>
            {formatMoney(b.gain, currency)}
          </span>
        </div>
        {mode === "return" ? (
          <div>Gain vs contrib <span className={`font-medium ${b.returnPct >= 0 ? "text-positive" : "text-negative"}`}>{b.returnPct >= 0 ? "+" : ""}{b.returnPct.toFixed(1)}%</span></div>
        ) : null}
        {b.endBal != null && b.year < new Date().getFullYear() && (
          <div>End balance <span className="font-medium text-foreground">{formatMoney(b.endBal, currency)}</span></div>
        )}
      </div>
      <div className="mt-1.5 border-t border-line/60 pt-1.5 font-semibold text-foreground">
        Total {formatMoney(b.contrib + b.gain, currency)}
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

  // Local optimistic ordering — mirrors the accounts page pattern so drag-drop
  // updates the UI immediately, then persists via reorderAccounts. Server props
  // reset this on refresh.
  const [localAccounts, setLocalAccounts] = useState(accounts);
  // This is an intentional synchronization of server-provided ordering into
  // the optimistic drag-and-drop copy after a revalidation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLocalAccounts(accounts), [accounts]);
  const [, startReorder] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);
  const reorder = (fromId: string, toId: string) => {
    const fromIdx = localAccounts.findIndex((a) => a.id === fromId);
    const toIdx = localAccounts.findIndex((a) => a.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...localAccounts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId, startDrag } = usePointerReorder("invest-account", reorder);

  // Group totals for the selected year, using per-account EFFECTIVE cells
  // (account slot + all bucket slots). Effective start uses prior-year end as fallback.
  let startSum = 0;
  let startAny = false;
  let effStartSum = 0;
  let effStartAny = false;
  let endSum = 0;
  let endAny = false;
  let contribSum = 0;
  let accruedSum = 0;
  for (const a of accounts) {
    const c = effectiveCell(a, year);
    if (c.startBalanceCents != null) { startSum += c.startBalanceCents; startAny = true; }
    const eff = c.startBalanceCents ?? effectiveCell(a, year - 1).endBalanceCents ?? null;
    if (eff != null) { effStartSum += eff; effStartAny = true; }
    if (c.endBalanceCents != null) { endSum += c.endBalanceCents; endAny = true; }
    contribSum += c.contributedCents;
    accruedSum += c.accruedCents;
  }
  const totalReturn = gainVsContributed(
    { startBalanceCents: effStartAny ? effStartSum : null, contributedCents: contribSum, accruedCents: accruedSum },
  );

  // Render in user-defined order (server sends accounts sorted by sort_order).
  // Local state above overrides during optimistic reorder.
  const sortedAccounts = localAccounts;

  // Hide "Start" column when every account has a null/zero start for the year — reduces noise.
  const showStart = startAny && startSum > 0;
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
        <h2 className="flex flex-1 items-center gap-2 text-sm font-bold">
          {title}
          <span className="text-xs font-normal text-muted">{accounts.reduce((s, a) => s + (a.buckets.length > 0 ? a.buckets.length : 1), 0)} account{accounts.reduce((s, a) => s + (a.buckets.length > 0 ? a.buckets.length : 1), 0) === 1 ? "" : "s"}</span>
        </h2>
        {collapsed && (
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs tabular-nums text-muted">
            <span>Contrib <span className={`font-semibold ${contribSum === 0 ? zeroCls : "text-foreground"}`}>{formatMoney(contribSum, currency)}</span></span>
            <span>Gains <span className={`font-semibold ${accruedSum === 0 ? zeroCls : ""}`} style={accruedSum > 0 ? { color: "var(--viz-bills)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}>{formatMoney(accruedSum, currency)}</span></span>
            {endAny && <span>Current <span className="font-semibold text-foreground">{formatMoney(endSum, currency)}</span></span>}
          </div>
        )}
      </button>
      {reorderError && !collapsed ? (
        <p className="border-b border-line/70 px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
      ) : null}
      {collapsed ? null : <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-medium text-muted">
              <th className="px-4 py-2 text-left">Account</th>
              {showStart ? <th className="px-3 py-2 text-left">Start</th> : null}
              <th className="px-3 py-2 text-center">Contrib</th>
              <th className="px-3 py-2 text-center">Gains</th>
              <th className="px-3 py-2 text-center">Current</th>
              <th className="px-4 py-2 text-center">Gain vs contrib</th>
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
              const ret = gainVsContributed({
                startBalanceCents: eff.startBalanceCents ?? priorEff.endBalanceCents ?? null,
                contributedCents: eff.contributedCents,
                accruedCents: eff.accruedCents,
              });
              const isSelected = selectedId === a.id;
              // Account-level slot (bucket_id NULL) — where CSV seed lives. When
              // buckets exist, this slot is still editable so the seed row can be
              // adjusted, but bucket rows render below.
              const parentCell = a.cells[year];
              const isDragOver = dragOverId === a.id;
              return (
                <Fragment key={a.id}>
                  <tr
                    data-drop-key={`invest-account:${a.id}`}
                    className={`border-t border-line/70 transition ${isSelected ? "bg-brand-soft/40" : "hover:bg-brand-soft/10"} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <GripHandle onMouseDown={() => startDrag(a.id)} />
                        {hasBuckets ? (
                          <button
                            type="button"
                            onClick={() => toggleBuckets(a.id)}
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
                        <button
                          type="button"
                          onClick={() => onSelect(a.id)}
                          className="flex items-baseline gap-1.5 text-left"

                        >
                          <span className={`font-medium ${isSelected ? "text-brand" : "hover:underline"}`}>{a.name}</span>
                          {a.subtype ? (
                            <span className="text-[11px] text-muted">{a.subtype}</span>
                          ) : null}
                          {a.holder ? (
                            <span className="rounded bg-background px-1 text-[10px] font-medium text-muted ring-1 ring-line">
                              {a.holder}
                            </span>
                          ) : null}
                          {hasBuckets ? (
                            <span className="rounded bg-brand-soft/70 px-1 text-[10px] font-medium text-brand ring-1 ring-brand/20">
                              {a.buckets.length} bucket{a.buckets.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </td>
                    {showStart ? (
                      <td className="px-1 py-1">
                        {hasBuckets ? (
                          <span className={`block text-left text-sm tabular-nums ${(eff.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"}`}>
                            {eff.startBalanceCents == null ? "—" : formatMoney(eff.startBalanceCents, currency)}
                          </span>
                        ) : (
                          <EditCell accountId={a.id} year={year} field="start" cents={parentCell?.startBalanceCents ?? 0} placeholder={parentCell?.startBalanceCents == null} currency={currency} tone={(parentCell?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                        )}
                      </td>
                    ) : null}
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-left text-sm tabular-nums font-medium ${eff.contributedCents === 0 ? zeroCls : ""}`}>
                          {formatMoney(eff.contributedCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="contributed" cents={parentCell?.contributedCents ?? 0} currency={currency} tone={(parentCell?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-left text-sm tabular-nums font-medium ${eff.accruedCents === 0 ? zeroCls : ""}`} style={eff.accruedCents > 0 ? { color: "var(--viz-bills)" } : eff.accruedCents < 0 ? { color: "var(--color-negative)" } : undefined}>
                          {formatMoney(eff.accruedCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="accrued" cents={parentCell?.accruedCents ?? 0} currency={currency} tone={(parentCell?.accruedCents ?? 0) === 0 ? zeroCls : (parentCell?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      {hasBuckets ? (
                        <span className={`block text-left text-sm tabular-nums font-medium ${(eff.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                          {eff.endBalanceCents == null ? "—" : formatMoney(eff.endBalanceCents, currency)}
                        </span>
                      ) : (
                        <EditCell accountId={a.id} year={year} field="end" cents={parentCell?.endBalanceCents ?? 0} placeholder={parentCell?.endBalanceCents == null} currency={currency} tone={(parentCell?.endBalanceCents ?? 0) === 0 ? zeroCls : ""} />
                      )}
                    </td>
                    <td className={`px-4 py-2 text-left tabular-nums ${ret == null ? zeroCls : ret > 0 ? "text-positive" : ret < 0 ? "text-negative" : zeroCls}`}>
                      {ret == null ? "—" : `${ret > 0 ? "+" : ""}${formatMoney(ret, currency)}`}
                    </td>
                  </tr>
                  {hasBuckets && open ? (
                    <>
                      {/* Account-level seed row (only when the CSV/manual seed at
                          account level has any non-zero value — otherwise buckets
                          alone are enough and the row would be pure noise). */}
                      {(parentCell?.contributedCents || parentCell?.accruedCents || parentCell?.startBalanceCents || parentCell?.endBalanceCents) ? (
                        <tr className="border-t border-line/40 bg-background/30 text-xs">
                          <td className="px-4 py-1 pl-10 text-muted italic">Account (unallocated / seed)</td>
                          {showStart ? (
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} year={year} field="start" cents={parentCell?.startBalanceCents ?? 0} placeholder={parentCell?.startBalanceCents == null} currency={currency} tone={(parentCell?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                            </td>
                          ) : null}
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="contributed" cents={parentCell?.contributedCents ?? 0} currency={currency} tone={(parentCell?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                          </td>
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="accrued" cents={parentCell?.accruedCents ?? 0} currency={currency} tone={(parentCell?.accruedCents ?? 0) === 0 ? zeroCls : (parentCell?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                          </td>
                          <td className="px-1 py-1">
                            <EditCell accountId={a.id} year={year} field="end" cents={parentCell?.endBalanceCents ?? 0} placeholder={parentCell?.endBalanceCents == null} currency={currency} tone={(parentCell?.endBalanceCents ?? 0) === 0 ? zeroCls : ""} />
                          </td>
                          <td className="px-4 py-1 text-left tabular-nums text-muted">—</td>
                        </tr>
                      ) : null}
                      {a.buckets.map((b) => {
                        const bc = b.cells[year];
                        return (
                          <tr key={b.id} className="border-t border-line/40 bg-background/20 text-sm">
                            <td className="px-4 py-1 pl-10 text-foreground/80">
                              <span className="text-brand-strong">↳</span> <span className="ml-1">{b.name}</span>
                            </td>
                            {showStart ? (
                              <td className="px-1 py-1">
                                <EditCell accountId={a.id} bucketId={b.id} year={year} field="start" cents={bc?.startBalanceCents ?? 0} placeholder={bc?.startBalanceCents == null} currency={currency} tone={(bc?.startBalanceCents ?? 0) === 0 ? zeroCls : "text-muted"} />
                              </td>
                            ) : null}
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} bucketId={b.id} year={year} field="contributed" cents={bc?.contributedCents ?? 0} currency={currency} tone={(bc?.contributedCents ?? 0) === 0 ? zeroCls : ""} />
                            </td>
                            <td className="px-1 py-1">
                              <EditCell accountId={a.id} bucketId={b.id} year={year} field="accrued" cents={bc?.accruedCents ?? 0} currency={currency} tone={(bc?.accruedCents ?? 0) === 0 ? zeroCls : (bc?.accruedCents ?? 0) > 0 ? "text-[color:var(--viz-bills)]" : "text-negative"} />
                            </td>
                            <td className="px-1 py-1">
                              <span className={`block text-left text-sm tabular-nums ${(bc?.endBalanceCents ?? 0) === 0 ? zeroCls : ""}`}>
                                {bc?.endBalanceCents == null ? "—" : formatMoney(bc.endBalanceCents, currency)}
                              </span>
                            </td>
                            <td className="px-4 py-1 text-left tabular-nums text-muted">—</td>
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
            <tr className="border-t-2 border-line bg-background/40 font-semibold">
              <td className="px-4 py-2">Total</td>
              {showStart ? (
                <td className={`px-3 py-2 text-left tabular-nums ${startAny ? "text-muted" : zeroCls}`}>
                  {startAny ? formatMoney(startSum, currency) : "—"}
                </td>
              ) : null}
              <td className={`px-3 py-2 text-left tabular-nums ${contribSum === 0 ? zeroCls : ""}`}>{formatMoney(contribSum, currency)}</td>
              <td
                className={`px-3 py-2 text-left tabular-nums ${accruedSum === 0 ? zeroCls : ""}`}
                style={accruedSum > 0 ? { color: "var(--viz-bills)" } : accruedSum < 0 ? { color: "var(--color-negative)" } : undefined}
              >
                {formatMoney(accruedSum, currency)}
              </td>
              <td className={`px-3 py-2 text-left tabular-nums font-medium ${endAny ? "" : zeroCls}`}>
                {endAny ? formatMoney(endSum, currency) : "—"}
              </td>
              <td className={`px-4 py-2 text-left tabular-nums ${totalReturn == null ? zeroCls : totalReturn > 0 ? "text-positive" : totalReturn < 0 ? "text-negative" : zeroCls}`}>
                {totalReturn == null ? "—" : `${totalReturn > 0 ? "+" : ""}${formatMoney(totalReturn, currency)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>}
    </section>
  );
}

// Editable contributed / gain cell — reads like text, saves on blur. Editing a
// cell writes an investment_years row, which "locks in" that account+year
// (stored value then wins over live derivation).
function EditCell({
  accountId,
  bucketId,
  year,
  field,
  cents,
  placeholder: showDash,
  currency,
  tone,
}: {
  accountId: string;
  bucketId?: string;
  year: number;
  field: "contributed" | "accrued" | "start" | "end";
  cents: number;
  placeholder?: boolean;
  currency: string;
  tone: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = showDash ? "" : centsToDisplay(cents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setInvestmentYear(fd))}
      className="flex items-center justify-start"
    >
      <span className="pointer-events-none select-none text-sm text-muted">{currencySymbol(currency)}</span>
      <input type="hidden" name="accountId" value={accountId} />
      {bucketId ? <input type="hidden" name="bucketId" value={bucketId} /> : null}
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="field" value={field} />
      <input
        key={initial}
        name="value"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="0.00"
        size={Math.max(initial.length, 4)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent pl-0 pr-1 py-0.5 text-left text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${tone} ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Secondary view: each account's contributed vs. gain across every year, so the
// "keep investing here?" trend is visible at a glance.
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
        <h2 className="text-sm font-bold">Year by year</h2>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
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
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${mineCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                    Investments
                  </span>
                </td>
                <td className="bg-background/60 px-3 py-1.5 text-[11px] text-muted">Contributed + Gain</td>
                {desc.map((y) => {
                  const contrib = mine.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                  const gain = mine.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                  return (
                    <td key={y} className="bg-background/60 px-3 py-1.5 text-center text-[11px] tabular-nums text-muted">
                      <span className="text-foreground">{formatMoney(contrib, currency)}</span>{" / "}<span className={gainTone(gain)}>{formatMoney(gain, currency)}</span>
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
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${kidsCollapsed ? "" : "rotate-90"}`} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                      Kids Funding
                    </span>
                  </td>
                  <td className="border-t-2 border-line bg-background/60 px-3 py-1.5 text-[11px] text-muted">Contributed + Gain</td>
                  {desc.map((y) => {
                    const contrib = kids.reduce((s, a) => s + (effectiveCell(a, y).contributedCents), 0);
                    const gain = kids.reduce((s, a) => s + (effectiveCell(a, y).accruedCents), 0);
                    return (
                      <td key={y} className="border-t-2 border-line bg-background/60 px-3 py-1.5 text-center text-[11px] tabular-nums text-muted">
                        <span className="text-foreground">{formatMoney(contrib, currency)}</span>{" / "}<span className={gainTone(gain)}>{formatMoney(gain, currency)}</span>
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
  return (
    <>
      <tr className="border-t border-line/70">
        <td rowSpan={2} className="px-4 py-2 align-top font-medium">
          <span className="flex items-center gap-1.5">
            {hasBuckets ? (
              <button
                type="button"
                onClick={onToggle}
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
              <span className="rounded bg-brand-soft/40 px-1.5 py-0.5 text-[10px] font-normal text-muted">
                {account.buckets.length} bucket{account.buckets.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </td>
        <td className="px-3 py-1.5 text-muted">Contributed</td>
        {desc.map((y) => (
          <td key={y} className="px-3 py-1.5 text-center tabular-nums">
            {hasBuckets ? (
              formatMoney(effectiveCell(account, y).contributedCents, currency)
            ) : (
              <EditCell accountId={account.id} year={y} field="contributed" cents={account.cells[y]?.contributedCents ?? 0} currency={currency} tone="" />
            )}
          </td>
        ))}
      </tr>
      <tr>
        <td className="px-3 py-1.5 text-muted">Gain</td>
        {desc.map((y) => {
          const g = effectiveCell(account, y).accruedCents;
          const rawG = account.cells[y]?.accruedCents ?? 0;
          return (
            <td key={y} className={`px-3 py-1.5 text-center tabular-nums ${gainTone(g)}`}>
              {hasBuckets ? (
                formatMoney(g, currency)
              ) : (
                <EditCell accountId={account.id} year={y} field="accrued" cents={rawG} currency={currency} tone={gainTone(rawG)} />
              )}
            </td>
          );
        })}
      </tr>
      {hasBuckets && open
        ? account.buckets.map((b) => (
            <Fragment key={b.id}>
              <tr className="border-t border-line/40 bg-background/30">
                <td rowSpan={2} className="px-4 py-1.5 pl-10 align-top text-sm text-muted">↳ {b.name}</td>
                <td className="px-3 py-1 text-sm text-muted">Contributed</td>
                {desc.map((y) => (
                  <td key={y} className="px-3 py-1 text-center text-sm tabular-nums text-muted">
                    <EditCell accountId={account.id} bucketId={b.id} year={y} field="contributed" cents={b.cells[y]?.contributedCents ?? 0} currency={currency} tone="text-muted" />
                  </td>
                ))}
              </tr>
              <tr className="bg-background/30">
                <td className="px-3 py-1 text-sm text-muted">Gain</td>
                {desc.map((y) => {
                  const g = b.cells[y]?.accruedCents ?? 0;
                  return (
                    <td key={y} className={`px-3 py-1 text-center text-sm tabular-nums ${gainTone(g)}`}>
                      <EditCell accountId={account.id} bucketId={b.id} year={y} field="accrued" cents={g} currency={currency} tone={gainTone(g)} />
                    </td>
                  );
                })}
              </tr>
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
  const [pending, start] = useTransition();
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [sourceBucketId, setSourceBucketId] = useState("");
  const [destAccountId, setDestAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");

  const srcAccount = accounts.find((a) => a.id === sourceAccountId);
  const hasBuckets = (srcAccount?.buckets.length ?? 0) > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("sourceAccountId", sourceAccountId);
    if (sourceBucketId) fd.set("sourceBucketId", sourceBucketId);
    fd.set("destAccountId", destAccountId);
    fd.set("amount", amount);
    fd.set("date", date);
    if (memo) fd.set("memo", memo);
    start(async () => {
      await transferFromInvestment(fd);
      onClose();
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
            <span className="mb-1 block text-xs font-medium text-muted">From (investment account)</span>
            <select
              required
              value={sourceAccountId}
              onChange={(e) => { setSourceAccountId(e.target.value); setSourceBucketId(""); }}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
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
              <span className="mb-1 block text-xs font-medium text-muted">Bucket</span>
              <select
                value={sourceBucketId}
                onChange={(e) => setSourceBucketId(e.target.value)}
                className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Entire account (no specific bucket)</option>
                {srcAccount!.buckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} — {formatMoney(b.balanceCents, currency)}</option>
                ))}
              </select>
            </label>
          )}

          {/* Destination account */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">To (banking account)</span>
            <select
              required
              value={destAccountId}
              onChange={(e) => setDestAccountId(e.target.value)}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Select destination account</option>
              {destAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          {/* Amount */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Amount</span>
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
                className="w-full rounded-lg border border-line bg-background py-2 pl-7 pr-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </label>

          {/* Date */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Date</span>
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>

          {/* Memo */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Note</span>
            <input
              type="text"
              placeholder="Transfer note (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>

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

// Grab handle for drag-to-reorder — mirrors the Accounts board's handle so
// both pages reorder the same way.
function GripHandle({ onMouseDown }: { onMouseDown: () => void }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}

      className="flex shrink-0 cursor-grab items-center rounded p-0.5 text-muted/60 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </span>
  );
}

// Pointer-based row reordering — rows carry data-drop-key="<kind>:<id>",
// grabbing a handle starts the drag, releasing over another row of the same
// kind fires onReorder(fromId, toId). Same mechanism as the Accounts board.
function usePointerReorder(kind: string, onReorder: (fromId: string, toId: string) => void) {
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const keyUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>("[data-drop-key]");
    const key = rowEl?.getAttribute("data-drop-key");
    return key && key.startsWith(`${kind}:`) ? key.slice(kind.length + 1) : null;
  };

  const startDrag = (id: string) => {
    dragId.current = id;
    document.body.style.cursor = "grabbing";
    const onMove = (e: MouseEvent) => setDragOverId(keyUnder(e.clientX, e.clientY));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverId(null);
      const from = dragId.current;
      dragId.current = null;
      const to = keyUnder(e.clientX, e.clientY);
      if (from && to && from !== to) onReorder(from, to);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { dragOverId, startDrag };
}
