"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { setInvestmentYear } from "./actions";

export type YearCell = {
  year: number;
  startBalanceCents: number | null;
  endBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
  stored: boolean;
};

export type InvestAccount = {
  id: string;
  name: string;
  holder: string | null;
  subtype: string | null;
  isKids: boolean;
  cells: Record<number, YearCell>;
};

type Props = {
  accounts: InvestAccount[];
  years: number[]; // newest first
  currency: string;
};

const gainTone = (cents: number) =>
  cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "text-foreground";

// gain ÷ (start balance + contributions) — the money at work that produced it.
// Undefined without a starting balance (seeded historical years).
function returnPct(cell: {
  startBalanceCents: number | null;
  contributedCents: number;
  accruedCents: number;
}): number | null {
  if (cell.startBalanceCents == null) return null;
  const base = cell.startBalanceCents + cell.contributedCents;
  if (base <= 0) return null;
  return (cell.accruedCents / base) * 100;
}

export function InvestBoard({ accounts, years, currency }: Props) {
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());

  const mine = accounts.filter((a) => !a.isKids);
  const kids = accounts.filter((a) => a.isKids);

  const yearIdx = years.indexOf(year);
  const goPrev = () => yearIdx < years.length - 1 && setYear(years[yearIdx + 1]);
  const goNext = () => yearIdx > 0 && setYear(years[yearIdx - 1]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Invest</h1>
          <p className="text-sm text-muted">
            Contributions vs. unrealized gains, per account, per year.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={yearIdx >= years.length - 1}
            aria-label="Previous year"
            className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="cursor-pointer rounded-lg bg-background px-3 py-1.5 text-sm font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
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
            className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-line text-muted transition hover:bg-brand-soft hover:text-foreground disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
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
          <PerfTable title="My Investments" accounts={mine} year={year} currency={currency} />
          {kids.length > 0 ? (
            <PerfTable title="Kids Funding" accounts={kids} year={year} currency={currency} />
          ) : null}
          <YearByYear accounts={accounts} years={years} currency={currency} />
        </>
      )}
    </div>
  );
}

function PerfTable({
  title,
  accounts,
  year,
  currency,
}: {
  title: string;
  accounts: InvestAccount[];
  year: number;
  currency: string;
}) {
  if (accounts.length === 0) return null;

  // Group totals for the selected year.
  let startSum = 0;
  let startAny = false;
  let endSum = 0;
  let endAny = false;
  let contribSum = 0;
  let accruedSum = 0;
  for (const a of accounts) {
    const c = a.cells[year];
    if (!c) continue;
    if (c.startBalanceCents != null) { startSum += c.startBalanceCents; startAny = true; }
    if (c.endBalanceCents != null) { endSum += c.endBalanceCents; endAny = true; }
    contribSum += c.contributedCents;
    accruedSum += c.accruedCents;
  }
  const totalReturn = startAny
    ? returnPct({ startBalanceCents: startSum, contributedCents: contribSum, accruedCents: accruedSum })
    : null;

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 text-left font-semibold">Account</th>
              <th className="px-3 py-2 text-right font-semibold">Start</th>
              <th className="px-3 py-2 text-right font-semibold">Contributed</th>
              <th className="px-3 py-2 text-right font-semibold">Unrealized Gain</th>
              <th className="px-3 py-2 text-right font-semibold">End</th>
              <th className="px-4 py-2 text-right font-semibold">Return</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const c = a.cells[year];
              const start = c?.startBalanceCents ?? null;
              const end = c?.endBalanceCents ?? null;
              const contributed = c?.contributedCents ?? 0;
              const accrued = c?.accruedCents ?? 0;
              const ret = c ? returnPct(c) : null;
              return (
                <tr key={a.id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium">{a.name}</span>
                      {a.subtype ? (
                        <span className="text-[11px] text-muted">{a.subtype}</span>
                      ) : null}
                      {a.holder ? (
                        <span className="rounded bg-background px-1 text-[10px] font-medium text-muted ring-1 ring-line">
                          {a.holder}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {start == null ? "—" : formatMoney(start, currency)}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <EditCell accountId={a.id} year={year} field="contributed" cents={contributed} currency={currency} tone="" />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <EditCell accountId={a.id} year={year} field="accrued" cents={accrued} currency={currency} tone={gainTone(accrued)} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {end == null ? "—" : formatMoney(end, currency)}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums ${ret == null ? "text-muted" : gainTone(accrued)}`}>
                    {ret == null ? "—" : `${ret > 0 ? "+" : ""}${ret.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-background/40 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {startAny ? formatMoney(startSum, currency) : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(contribSum, currency)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${gainTone(accruedSum)}`}>
                {formatMoney(accruedSum, currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {endAny ? formatMoney(endSum, currency) : "—"}
              </td>
              <td className={`px-4 py-2 text-right tabular-nums ${totalReturn == null ? "text-muted" : gainTone(accruedSum)}`}>
                {totalReturn == null ? "—" : `${totalReturn > 0 ? "+" : ""}${totalReturn.toFixed(1)}%`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// Editable contributed / gain cell — reads like text, saves on blur. Editing a
// cell writes an investment_years row, which "locks in" that account+year
// (stored value then wins over live derivation).
function EditCell({
  accountId,
  year,
  field,
  cents,
  currency,
  tone,
}: {
  accountId: string;
  year: number;
  field: "contributed" | "accrued";
  cents: number;
  currency: string;
  tone: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = centsToDisplay(cents);

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => setInvestmentYear(fd))}
      className="flex items-center justify-end gap-0.5"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="field" value={field} />
      <span className="pointer-events-none text-xs text-muted">{currencySymbol(currency)}</span>
      <input
        key={initial}
        name="value"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="0.00"
        size={Math.max(initial.length, 4) + 1}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${tone} ${
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
  const [open, setOpen] = useState(false);
  const asc = useMemo(() => [...years].sort((a, b) => a - b), [years]);

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <h2 className="text-sm font-bold">Year by year</h2>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-semibold">Account</th>
                <th className="px-3 py-2 text-left font-semibold">Metric</th>
                {asc.map((y) => (
                  <th key={y} className="px-3 py-2 text-right font-semibold">{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-t border-line/70">
                    <td rowSpan={2} className="px-4 py-2 align-top font-medium">{a.name}</td>
                    <td className="px-3 py-1.5 text-muted">Contributed</td>
                    {asc.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-right tabular-nums">
                        {formatMoney(a.cells[y]?.contributedCents ?? 0, currency)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-muted">Gain</td>
                    {asc.map((y) => {
                      const g = a.cells[y]?.accruedCents ?? 0;
                      return (
                        <td key={y} className={`px-3 py-1.5 text-right tabular-nums ${gainTone(g)}`}>
                          {formatMoney(g, currency)}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
