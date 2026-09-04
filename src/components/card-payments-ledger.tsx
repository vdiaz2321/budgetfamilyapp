"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";

// Compact axis money: "$4.0k" past a thousand, whole dollars below it.
function axisMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    const symbol = formatMoney(0, currency).replace(/[\d.,]/g, "");
    return `${symbol}${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return formatMoney(Math.round(dollars) * 100, currency).replace(/\.00$/, "");
}

const PAYMENT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One payment made toward a credit card. Charges ON the card are not here. */
export type CardPayment = {
  id: string;
  // YYYY-MM-DD
  date: string;
  amountCents: number;
  cardId: string;
  fromAccountId: string | null;
  memo: string | null;
};

/**
 * Read-only report of what has been PAID toward each card — never what was
 * charged on it. It reads `transactions` and writes nothing, so it can't move
 * a balance or a net-worth figure. The point is the spending requirement per
 * card: what a month of carrying this card actually costs, and what the year
 * adds up to, before deciding to open another one.
 *
 * Shared by the Accounts page (inside the Credit Cards section) and Insights.
 * `storageKey` keeps their collapse states independent.
 */
export function CardPaymentsLedger({
  payments,
  cardNames,
  sourceNames,
  currency,
  storageKey,
  showChart = true,
}: {
  payments: CardPayment[];
  cardNames: Record<string, string>;
  sourceNames: Record<string, string>;
  currency: string;
  storageKey: string;
  // Accounts renders the table only — that page is already dense with cards,
  // and the chart lives on Insights where trends belong.
  showChart?: boolean;
}) {
  const [view, setView] = useState<"month" | "year">("month");
  const [hoverBar, setHoverBar] = useState<string | null>(null);
  const [showPayments, setShowPayments] = useState(false);
  // Open on a fresh login, and holds whatever it was last set to while moving
  // around the app inside one session.
  const [openState, setOpenState] = useSessionCollapse(storageKey, () => ({ open: true }));
  const open = openState.open;

  const nameById = new Map(Object.entries(cardNames));
  const sourceById = new Map(Object.entries(sourceNames));
  const years = [...new Set(payments.map((p) => p.date.slice(0, 4)))].sort().reverse();
  const [yearState, setYear] = useState<string>("");
  // Falls back to the newest year with data, so the picker is never empty and
  // never points at a year that has since lost its last payment.
  const year = years.includes(yearState) ? yearState : years[0] ?? String(new Date().getFullYear());

  const inScope = view === "month" ? payments.filter((p) => p.date.slice(0, 4) === year) : payments;
  // Most recent period first in both views — the months you actually just
  // paid are the ones worth reading, and they land next to the total. In the
  // current year the months that haven't happened yet are dropped rather than
  // shown as a row of leading dashes.
  const now = new Date();
  const lastMonthShown =
    view === "month" && year === String(now.getFullYear()) ? now.getMonth() + 1 : 12;
  const columns =
    view === "month"
      ? PAYMENT_MONTHS.slice(0, lastMonthShown)
          .map((label, i) => ({ key: String(i + 1).padStart(2, "0"), label }))
          .reverse()
      : years.map((y) => ({ key: y, label: y }));
  const columnOf = (p: CardPayment) => (view === "month" ? p.date.slice(5, 7) : p.date.slice(0, 4));
  // With one year of history the year column would just repeat Total, so it
  // is dropped; the moment a second year exists every year column appears and
  // the table grows sideways, newest first.
  const showPeriodColumns = !(view === "year" && columns.length <= 1);

  // cardId -> column key -> cents.
  const byCard = new Map<string, Map<string, number>>();
  for (const p of inScope) {
    const row = byCard.get(p.cardId) ?? new Map<string, number>();
    row.set(columnOf(p), (row.get(columnOf(p)) ?? 0) + p.amountCents);
    byCard.set(p.cardId, row);
  }
  const rows = [...byCard.entries()]
    .map(([cardId, cells]) => ({
      cardId,
      name: nameById.get(cardId) ?? "Closed card",
      cells,
      total: [...cells.values()].reduce((sum, v) => sum + v, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const columnTotal = (key: string) => rows.reduce((sum, r) => sum + (r.cells.get(key) ?? 0), 0);
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  // Months the average is spread over: a finished year is 12, the current year
  // only counts the months that have actually happened, so an early-year
  // average isn't diluted by months that haven't been paid yet.
  const elapsedMonths = (() => {
    if (view === "month") return year === String(now.getFullYear()) ? now.getMonth() + 1 : 12;
    // By year: the months actually covered, from January of the oldest year
    // with payments through the current month (or the end of the newest year
    // when history stops before this one).
    if (years.length === 0) return 1;
    const oldest = Number(years[years.length - 1]);
    const newest = Number(years[0]);
    return newest >= now.getFullYear()
      ? (now.getFullYear() - oldest) * 12 + now.getMonth() + 1
      : (newest - oldest + 1) * 12;
  })();
  const perMonth = (cents: number) => Math.round(cents / Math.max(1, elapsedMonths));

  // Total and the newest months are the leftmost columns, so the default
  // scroll position (left edge) is already the useful one.
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scrollBoxRef.current;
    if (box) box.scrollLeft = 0;
  }, [view, year, payments]);

  // The chart reads oldest -> newest (time runs left to right) even though the
  // table is newest-first; a reversed time axis reads as a mistake.
  const chartBars = [...columns].reverse().map((c) => ({
    key: c.key,
    label: c.label,
    value: columnTotal(c.key),
  }));
  const chartMax = Math.max(1, ...chartBars.map((b) => b.value));

  const listed = [...inScope].sort((a, b) => b.date.localeCompare(a.date));
  const money = (cents: number) => formatMoney(cents, currency);
  const cell = "px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap";
  // Money columns are right-aligned, so their headers are too — a centered
  // label over a right-aligned figure reads as misaligned. Only the Card
  // column, whose values are text, keeps a centered header.
  const headBase = "px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap";
  const head = `${headBase} text-right`;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => setOpenState((s) => ({ ...s, open: !s.open }))}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
            className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0">
            <span className="block text-sm font-bold">Card payments</span>
            <span className="block text-xs text-muted">
              What you paid toward each card — payments only, not the charges on them.
            </span>
          </span>
        </button>
        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg bg-black/5 p-0.5 dark:bg-white/10">
              {(["month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    view === v ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
                  }`}
                >
                  {v === "month" ? "By month" : "By year"}
                </button>
              ))}
            </div>
            {/* Always rendered, hidden (not removed) in the By year view:
                dropping it out of the flow shoved the whole control cluster
                sideways every time the view was switched. */}
            {years.length > 0 ? (
              <select
                aria-label="Year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                aria-hidden={view !== "month"}
                tabIndex={view === "month" ? undefined : -1}
                className={`cursor-pointer rounded-lg bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand ${
                  view === "month" ? "" : "invisible"
                }`}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            ) : null}
            {/* The running total reads as a figure worth looking at, not a
                caption: its own tile, label above value. */}
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-surface px-3 py-1.5 text-right ring-1 ring-black/5 dark:ring-white/10">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total paid</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>
                  {money(grandTotal)}
                </div>
              </div>
              {/* Shown in both views — in By year it's the average month across
                  the whole history — so the header keeps its width. */}
              <div className="rounded-lg bg-surface px-3 py-1.5 text-right ring-1 ring-black/5 dark:ring-white/10">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Avg / month</div>
                <div className="text-sm font-bold tabular-nums text-foreground">{money(perMonth(grandTotal))}</div>
              </div>
            </div>
          </div>
        ) : (
          <span className="whitespace-nowrap text-xs text-muted">
            Total paid{" "}
            <span className="font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>
              {money(grandTotal)}
            </span>
          </span>
        )}
      </div>

      {!open ? null : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          No card payments recorded{view === "month" ? ` in ${year}` : ""} yet. Use “Pay card” on a card to log one.
        </p>
      ) : (
        <>
          {/* One bar per period — a single series, so no legend: the section
              title names it. Same figures as the All cards row below, drawn
              oldest to newest. */}
          {/* A chart of one bar says nothing the tile above it doesn't. */}
          {showChart && chartBars.length > 1 ? (
          <div className="border-b border-line px-4 py-3">
            <div className="flex">
              <div className="relative mr-2 h-28 w-11 shrink-0">
                {[0, 0.5, 1].map((g) => (
                  <span
                    key={g}
                    className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted"
                    style={{ top: `${(1 - g) * 100}%` }}
                  >
                    {axisMoney(chartMax * g, currency)}
                  </span>
                ))}
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="pointer-events-none absolute inset-0 h-28">
                  {[0, 0.5, 1].map((g) => (
                    <span
                      key={g}
                      className="absolute inset-x-0 border-t"
                      style={{ top: `${(1 - g) * 100}%`, borderColor: "var(--viz-grid)" }}
                    />
                  ))}
                </div>
                <div className="relative flex h-28 items-end gap-1">
                  {chartBars.map((b) => (
                    <div
                      key={b.key}
                      onMouseEnter={() => setHoverBar(b.key)}
                      onMouseLeave={() => setHoverBar((h) => (h === b.key ? null : h))}
                      className="group relative flex h-full flex-1 flex-col justify-end"
                    >
                      <div
                        className="mx-auto w-[60%] max-w-[22px] rounded-t-[4px] transition-[height]"
                        style={{
                          height: `${(b.value / chartMax) * 100}%`,
                          backgroundColor: "var(--viz-savings)",
                          opacity: b.value ? 1 : 0,
                        }}
                      />
                      {hoverBar === b.key ? (
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 rounded-lg bg-surface px-2.5 py-1.5 text-left text-xs shadow-xl ring-1 ring-black/10 dark:ring-white/15">
                          <p className="font-semibold">{b.label}{view === "month" ? ` ${year}` : ""}</p>
                          <p className="tabular-nums text-muted">{money(b.value)}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1">
                  {chartBars.map((b) => (
                    <span key={b.key} className="flex min-w-0 flex-1 justify-center">
                      <span className="max-w-full truncate text-[10px] text-muted">{b.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          ) : null}

          {/* Its own scroll box: 12 month columns never fit a phone, and the
              card names stay readable via the sticky first column. That column
              carries the same surface as the cells beside it, so it reads as
              part of the row rather than a filled band. */}
          <div ref={scrollBoxRef} className="overflow-x-auto bg-surface">
            {/* The min width only exists to keep 12 month columns readable; a
                By-year table with a couple of columns fits a phone as-is. */}
            <table className={`w-full border-collapse text-xs ${columns.length > 3 ? "min-w-[42rem]" : ""}`}>
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className={`${headBase} sticky left-0 z-10 bg-surface text-center`}>Card</th>
                  <th className={head}>Total</th>
                  {showPeriodColumns
                    ? columns.map((c) => <th key={c.key} className={head}>{c.label}</th>)
                    : null}
                  {view === "month" ? <th className={head}>Avg/mo</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cardId} className="border-b border-line last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[11rem] truncate bg-surface px-2.5 py-1.5 text-left text-xs font-semibold"
                    >
                      {r.name}
                    </th>
                    <td className={`${cell} border-r border-line font-bold`}>{money(r.total)}</td>
                    {showPeriodColumns
                      ? columns.map((c) => {
                          const v = r.cells.get(c.key) ?? 0;
                          return (
                            <td key={c.key} className={`${cell} ${v ? "text-foreground" : "text-muted/50"}`}>
                              {v ? money(v) : "—"}
                            </td>
                          );
                        })
                      : null}
                    {view === "month" ? (
                      <td className={`${cell} border-l border-line text-muted`}>{money(perMonth(r.total))}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/20 bg-surface font-bold">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left text-xs">
                    All cards
                  </th>
                  <td className={`${cell} border-r border-line`} style={{ color: "var(--viz-savings)" }}>
                    {money(grandTotal)}
                  </td>
                  {showPeriodColumns
                    ? columns.map((c) => {
                        const v = columnTotal(c.key);
                        return (
                          <td key={c.key} className={`${cell} ${v ? "" : "text-muted/50"}`}>
                            {v ? money(v) : "—"}
                          </td>
                        );
                      })
                    : null}
                  {view === "month" ? (
                    <td className={`${cell} border-l border-line`} style={{ color: "var(--viz-savings)" }}>
                      {money(perMonth(grandTotal))}
                    </td>
                  ) : null}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="border-t border-line px-4 py-2">
            <button
              type="button"
              aria-pressed={showPayments}
              onClick={() => setShowPayments((v) => !v)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
                showPayments
                  ? "bg-negative/15 text-negative ring-negative/40"
                  : "bg-negative/5 text-negative ring-negative/25 hover:bg-negative/15"
              }`}
            >
              {showPayments ? "Hide payments" : `Show ${listed.length} payment${listed.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {showPayments ? (
            <ul className="divide-y divide-line border-t border-line bg-background/70">
              {listed.map((p) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 text-xs"
                >
                  <span className="tabular-nums text-muted">{p.date}</span>
                  <span className="min-w-0 truncate font-semibold">
                    {nameById.get(p.cardId) ?? "Closed card"}
                    {/* The Pay-card modal pre-fills the memo with "Payment to
                        <card>", which just repeats the name — show where the
                        money came from instead, and the memo only when the
                        user actually wrote something of their own. */}
                    {p.fromAccountId && sourceById.has(p.fromAccountId) ? (
                      <span className="font-normal text-muted"> · from {sourceById.get(p.fromAccountId)}</span>
                    ) : null}
                    {p.memo && p.memo !== `Payment to ${nameById.get(p.cardId) ?? ""}` ? (
                      <span className="font-normal text-muted"> · {p.memo}</span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{money(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
