"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";

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
 * Lives on the Accounts page, under the Credit Cards section. It used to be
 * on Insights too; `storageKey` is kept so a page could host it again.
 */
export function CardPaymentsLedger({
  payments,
  cardNames,
  currency,
  storageKey,
}: {
  payments: CardPayment[];
  cardNames: Record<string, string>;
  currency: string;
  storageKey: string;
}) {
  const [view, setView] = useState<"month" | "year">("month");
  // Open on a fresh login, and holds whatever it was last set to while moving
  // around the app inside one session.
  const [openState, setOpenState] = useSessionCollapse(storageKey, () => ({ open: true }));
  const open = openState.open;

  const nameById = new Map(Object.entries(cardNames));
  const years = [...new Set(payments.map((p) => p.date.slice(0, 4)))].sort().reverse();
  const [yearState, setYear] = useState<string>("");
  // Falls back to the newest year with data, so the picker is never empty and
  // never points at a year that has since lost its last payment.
  const year = years.includes(yearState) ? yearState : years[0] ?? String(new Date().getFullYear());

  const inScope = view === "month" ? payments.filter((p) => p.date.slice(0, 4) === year) : payments;
  // Newest first in both views: the month just paid sits beside Annual Total
  // (Sep, Aug, … Jan), the same way years run newest-first. In the current
  // year the months that haven't happened yet are dropped rather than shown as
  // a row of empty columns.
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
  // is dropped; the moment a second year exists every year column appears.
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

  // Both views are newest-first, so the useful edge is the left one — reset
  // there when the view or year changes rather than keeping an old scroll.
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box) return;
    box.scrollLeft = 0;
  }, [view, year, payments]);


  const money = (cents: number) => formatMoney(cents, currency);
  // Headers AND the figures under them are centered (Victor's rule for every
  // table) — a centered label over right-aligned money reads as misaligned.
  // tabular-nums keeps the digits the same width, so centered values still
  // line up well enough down a column.
  const cell = "px-2.5 py-1.5 text-center tabular-nums whitespace-nowrap";
  const headBase = "px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap";
  const head = `${headBase} text-center`;

  return (
    <section>
      {/* Title + month/year pickers on the left, the two total tiles centered
          in the bar (a three-zone grid once it's wide; stacked and centered on
          a phone). All of it stays visible when collapsed, so the totals and
          pickers never disappear with the table. */}
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-x-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            <span className="min-w-0 text-sm font-bold">Credit Card Payments Made</span>
          </button>
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
          </div>
        </div>
        {/* The running total reads as a figure worth looking at, not a
            caption: its own tile, label above value. */}
        <div className="flex items-center justify-center divide-x divide-line">
          <div className="px-3 py-1.5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total paid</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>
              {money(grandTotal)}
            </div>
          </div>
          {/* Shown in both views — in By year it's the average month across
              the whole history — so the header keeps its width. */}
          <div className="px-3 py-1.5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Avg / month</div>
            <div className="text-sm font-bold tabular-nums text-foreground">{money(perMonth(grandTotal))}</div>
          </div>
        </div>
        {/* Empty third column: balances the left group so the tiles sit at
            the true center of the bar. */}
        <div aria-hidden className="hidden md:block" />
      </div>

      {!open ? null : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          No card payments recorded{view === "month" ? ` in ${year}` : ""} yet. Use “Pay card” on a card to log one.
        </p>
      ) : (
        <>
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
                  {/* By year this column spans every year, so "Annual" only fits by month. */}
                  <th className={head}>{view === "month" ? "Annual Total" : "Total"}</th>
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
                            <td key={c.key} className={`${cell} ${v ? "text-foreground" : ""}`}>
                              {v ? money(v) : null}
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
                          <td key={c.key} className={cell}>
                            {v ? money(v) : null}
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
        </>
      )}
    </section>
  );
}
