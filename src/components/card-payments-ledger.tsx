"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { ModalShell } from "@/components/modal-shell";
import { updatePayment } from "@/app/(app)/accounts/actions";
import { deleteTransaction } from "@/app/(app)/budget/actions";

// The payment popup's columns, with the headers once above the list rather
// than on every row. Wide: Date · Paid · Reimbursed · From · buttons on one
// line. Phone: Date · Paid · Reimbursed, then From and the buttons under them.
const PAYMENT_GRID =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-2 sm:grid-cols-[9.5rem_7rem_7rem_var(--from-w)_8.5rem] sm:gap-x-3";

const PAYMENT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One payment made toward a credit card (or, in the Debt Payments copy of this
 * table, toward a debt). Charges ON the card are not here.
 */
export type CardPayment = {
  id: string;
  // YYYY-MM-DD
  date: string;
  amountCents: number;
  // The card's account id — or the debt's subcategory id in the debt table.
  cardId: string;
  // How much of it came back. amountCents is the NET (paid − reimbursed).
  reimbursedCents: number;
  // When it was last changed after being logged; null if never edited.
  editedAt: string | null;
  fromAccountId: string | null;
  /** Paid by cashing out points (a statement credit) — no bank behind it. */
  fromPoints?: boolean;
  memo: string | null;
  // What Remove would put back, worked out on the server from the same rules
  // deleteTransaction follows. `refund` is null when no bank balance moves.
  undo?: {
    refund: { name: string; balanceCents: number } | null;
    debt: { name: string; owedCents: number } | null;
  };
};

// Wording for each copy of the table: credit cards (default) or debts.
export type PaymentsLedgerLabels = { title: string; item: string; all: string; empty: string; closed: string };
const CARD_LABELS: PaymentsLedgerLabels = {
  title: "Credit Card Payments",
  item: "Card",
  all: "All cards",
  empty: "No card payments recorded",
  closed: "Closed card",
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
  openCardIds,
  accountNames,
  currency,
  storageKey,
  labels = CARD_LABELS,
}: {
  payments: CardPayment[];
  cardNames: Record<string, string>;
  /** Open cards — each gets a row even with no payment, so a missed one shows. */
  openCardIds: string[];
  /** Any account id -> name, for the "From" column of a card's payment list. */
  accountNames: Record<string, string>;
  currency: string;
  storageKey: string;
  labels?: PaymentsLedgerLabels;
}) {
  const [view, setView] = useState<"month" | "year">("month");
  // The card whose payment history popup is open.
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  // Spreadsheet-style sort: click a header to sort by it (amounts biggest
  // first, names A-Z), click again to flip, a third time to go back to the
  // default active-first order. null = that default.
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
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
  // Every open card gets a row up front, so a card with no payment (or one
  // that's never charged) still shows up instead of vanishing. Months with no
  // payment stay blank — Victor rejected any "Not paid" wording.
  const byCard = new Map<string, Map<string, number>>(openCardIds.map((id) => [id, new Map()]));
  for (const p of inScope) {
    const row = byCard.get(p.cardId) ?? new Map<string, number>();
    row.set(columnOf(p), (row.get(columnOf(p)) ?? 0) + p.amountCents);
    byCard.set(p.cardId, row);
  }
  const rows = [...byCard.entries()]
    .map(([cardId, cells]) => ({
      cardId,
      name: nameById.get(cardId) ?? labels.closed,
      cells,
      total: [...cells.values()].reduce((sum, v) => sum + v, 0),
      // Columns run newest first, so this is how many columns back the last
      // payment sits (Infinity = nothing paid in range).
      lastPaid: (() => {
        const i = columns.findIndex((c) => (cells.get(c.key) ?? 0) !== 0);
        return i === -1 ? Infinity : i;
      })(),
    }))
    // Active first — paid in the latest two months (latest year when By
    // year) — biggest total first. Then the rest by how recently they were
    // paid, so a paid-off debt sinks below the ones still being paid.
    .map((r) => ({ ...r, active: r.lastPaid <= (view === "month" ? 1 : 0) }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.active ? 0 : a.lastPaid - b.lastPaid) ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    );
  if (sort) {
    const sign = sort.dir === "asc" ? 1 : -1;
    const valueOf = (r: (typeof rows)[number]) =>
      sort.key === "total" ? r.total : r.cells.get(sort.key) ?? 0;
    // Stable sort, so ties keep the default order underneath.
    rows.sort((a, b) =>
      sort.key === "name" ? sign * a.name.localeCompare(b.name) : sign * (valueOf(a) - valueOf(b)),
    );
  }
  const toggleSort = (key: string) =>
    setSort((cur) => {
      const first = key === "name" ? "asc" : "desc";
      if (cur?.key !== key) return { key, dir: first };
      if (cur.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });


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
      {/* Title + month/year pickers, then the two total tiles right beside
          them — kept together on the left so a wide screen doesn't drift the
          totals away from the controls they belong to (stacked and centered
          on a phone). All of it stays visible when collapsed, so the totals
          and pickers never disappear with the table. */}
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 md:flex-row md:items-center md:gap-x-6">
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
            <span className="min-w-0 text-sm font-bold">{labels.title}</span>
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
      </div>

      {!open ? null : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          {labels.empty}{view === "month" ? ` in ${year}` : ""} yet.
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
                  <th className={`${headBase} sticky left-0 z-10 bg-surface text-center`}>
                    <SortButton label={labels.item} dir={sort?.key === "name" ? sort.dir : null} onClick={() => toggleSort("name")} />
                  </th>
                  {/* By year this column spans every year, so "Annual" only fits by month. */}
                  <th className={head}>
                    <SortButton label={view === "month" ? "Annual Total" : "Total"} dir={sort?.key === "total" ? sort.dir : null} onClick={() => toggleSort("total")} />
                  </th>
                  {showPeriodColumns
                    ? columns.map((c) => (
                        <th key={c.key} className={head}>
                          <SortButton label={c.label} dir={sort?.key === c.key ? sort.dir : null} onClick={() => toggleSort(c.key)} />
                        </th>
                      ))
                    : null}
                  {/* Avg/mo is the total spread evenly, so it sorts the same as Total. */}
                  {view === "month" ? (
                    <th className={head}>
                      <SortButton label="Avg/mo" dir={sort?.key === "total" ? sort.dir : null} onClick={() => toggleSort("total")} />
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  // The whole row opens that card's payment list — the place to
                  // fix a date or remove a payment without leaving Accounts.
                  <tr
                    key={r.cardId}
                    onClick={() => setDetailCardId(r.cardId)}
                    className="group cursor-pointer border-b border-line last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[11rem] bg-surface px-2.5 py-1.5 text-left text-xs font-semibold group-hover:bg-[color-mix(in_srgb,var(--surface),black_3%)]"
                    >
                      <span className="flex items-center gap-1">
                        <span className="truncate">{r.name}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 -rotate-90 text-muted" aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </th>
                    <td className={`${cell} border-r border-line font-bold ${r.total ? "text-negative" : "text-muted"}`}>{money(r.total)}</td>
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
                    {labels.all}
                  </th>
                  <td className={`${cell} border-r border-line text-negative`}>
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
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Select a row to edit its payments.</p>
        </>
      )}
      {detailCardId ? (
        <CardPaymentsDetail
          cardName={nameById.get(detailCardId) ?? labels.closed}
          // One calendar year — the one picked above (this year by default) —
          // so the list starts fresh every January instead of growing forever.
          year={year}
          payments={payments.filter((p) => p.cardId === detailCardId && p.date.slice(0, 4) === year)}
          accountNames={accountNames}
          currency={currency}
          onClose={() => setDetailCardId(null)}
        />
      ) : null}
    </section>
  );
}

/** Every payment made to one card, newest first — date editable, removable. */
function CardPaymentsDetail({
  cardName,
  year,
  payments,
  accountNames,
  currency,
  onClose,
}: {
  cardName: string;
  year: string;
  payments: CardPayment[];
  accountNames: Record<string, string>;
  currency: string;
  onClose: () => void;
}) {
  const sorted = [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
  return (
    <ModalShell
      title={cardName}
      onClose={onClose}
      // As wide as its rows and no wider: the From column is sized to the longest
      // account name (--from-w below), so there's no empty band on a big screen.
      className="sm:w-fit sm:max-w-[95vw]"
      mobileAlign="top"
      headerExtra={
        <span className="text-sm text-muted">
          {payments.some((p) => p.reimbursedCents > 0) ? "Net payments:" : "Total payments:"} <span className="font-bold tabular-nums" style={{ color: "var(--viz-savings)" }}>{formatMoney(total, currency)}</span>
        </span>
      }
    >
      <div className="px-5 py-3">
        {sorted.length === 0 ? (
          <p className="py-2 text-sm text-muted">No payments in {year}.</p>
        ) : (
          <div
            // Every row is its own grid, so the From column's width is set once
            // here — the longest name at roughly 0.47rem per character.
            style={{ ["--from-w" as string]: `${Math.max(3, ...sorted.map((p) => (p.fromPoints ? "Points" : p.fromAccountId ? accountNames[p.fromAccountId] ?? "Closed account" : "").length + (p.editedAt ? 16 : 0))) * 0.47 + 0.5}rem` }}
          >
          <div className={`border-b border-line pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted ${PAYMENT_GRID}`}>
            <span className="text-center">Date</span>
            <span className="text-center">Paid</span>
            <span className="text-center">Reimbursed</span>
            <span className="hidden sm:block">From</span>
          </div>
          <ul className="divide-y divide-line">
            {sorted.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                itemName={cardName}
                // CSV-imported rows carry no account — show nothing rather than a dash.
                fromName={p.fromPoints ? "Points" : p.fromAccountId ? accountNames[p.fromAccountId] ?? "Closed account" : null}
                currency={currency}
              />
            ))}
          </ul>
          </div>
        )}
        <p className="pt-3 text-xs text-muted">
          Changing a date doesn&rsquo;t change balances.
        </p>
      </div>
    </ModalShell>
  );
}

function PaymentRow({
  payment,
  itemName,
  fromName,
  currency,
}: {
  payment: CardPayment;
  itemName: string;
  fromName: string | null;
  currency: string;
}) {
  const router = useRouter();
  const toInput = (cents: number) => (cents ? (cents / 100).toFixed(2) : "");
  const startPaid = toInput(payment.amountCents + payment.reimbursedCents);
  const startReimbursed = toInput(payment.reimbursedCents);
  const [date, setDate] = useState(payment.date);
  const [paid, setPaid] = useState(startPaid);
  const [reimbursed, setReimbursed] = useState(startReimbursed);
  // Which confirmation is open: removing the payment, or saving a new amount.
  const [confirm, setConfirm] = useState<"remove" | "amount" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, "") || "0") * 100);
  const paidCents = cents(paid);
  const reimbursedCents = cents(reimbursed);
  // The net is what balances count, so only a change to it needs the check.
  const newCents = paidCents - reimbursedCents;
  const amountChanged = Number.isFinite(newCents) && newCents !== payment.amountCents;
  const changed = date !== payment.date || paid !== startPaid || reimbursed !== startReimbursed;

  const reset = () => {
    setDate(payment.date);
    setPaid(startPaid);
    setReimbursed(startReimbursed);
    setError(null);
  };
  const save = () => {
    const fd = new FormData();
    fd.set("id", payment.id);
    fd.set("date", date);
    fd.set("paid", paid);
    fd.set("reimbursed", reimbursed || "0");
    startTransition(async () => {
      const res = await updatePayment(fd);
      setError(res?.error ?? null);
      if (!res?.error) {
        setConfirm(null);
        // Normalize what was typed ("3" → "3.00") so it matches the saved
        // figures once the page refreshes and the row reads as unchanged.
        setPaid(toInput(paidCents));
        setReimbursed(toInput(reimbursedCents));
        router.refresh();
      }
    });
  };
  // A new amount moves balances, so it gets the same Now / After check as
  // Remove first; a date-only change saves straight away.
  const onSave = () => {
    if (!Number.isFinite(paidCents) || paidCents <= 0) {
      setError("Enter an amount above $0.");
      return;
    }
    if (!Number.isFinite(reimbursedCents) || reimbursedCents < 0 || reimbursedCents >= paidCents) {
      setError("Reimbursed must be less than paid — use Remove instead.");
      return;
    }
    if (amountChanged) setConfirm("amount");
    else save();
  };
  const remove = () => {
    const fd = new FormData();
    fd.set("id", payment.id);
    startTransition(async () => {
      const res = await deleteTransaction(fd);
      setError(res?.error ?? null);
      if (!res?.error) router.refresh();
    });
  };

  return (
    <li className="py-1.5">
      <div className={`gap-y-1 ${PAYMENT_GRID}`}>
        <label className="block min-w-0">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Payment date"
            className="w-full rounded-md bg-background px-1.5 py-1 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-2"
          />
        </label>
        <MoneyBox label="Paid" value={paid} onChange={setPaid} bold />
        <MoneyBox label="Reimbursed" value={reimbursed} onChange={setReimbursed} placeholder="0.00" />
        {/* From + buttons: their own columns on a wide screen (`contents`),
            one shared line under the boxes on a phone. */}
        <div className="col-span-3 flex items-center gap-2 sm:contents">
        <div className="min-w-0 flex-1 text-xs text-muted">
          {fromName || payment.editedAt ? (
            <div className="truncate whitespace-nowrap">
              {fromName}
              {payment.editedAt ? (
                <span className="text-muted/80">
                  {fromName ? " · " : ""}edited{" "}
                  {new Date(payment.editedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              ) : null}
            </div>
          ) : null}
          {payment.reimbursedCents > 0 ? (
            <div className="tabular-nums">
              Net <span className="font-semibold text-foreground">{formatMoney(payment.amountCents, currency)}</span>
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2 sm:ml-0 sm:justify-center">
          {changed ? (
            <>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={pending}
                className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm("remove")}
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-negative hover:bg-negative/10"
            >
              Remove
            </button>
          )}
        </div>
        </div>
      </div>
      {error && !confirm ? <p className="mt-1 text-xs text-negative">{error}</p> : null}
      {confirm ? (
        <BalanceChangeWarning
          payment={payment}
          itemName={itemName}
          currency={currency}
          // Money that goes back to the bank: all of it on Remove, the
          // difference on a smaller amount (negative when the amount grows).
          backCents={confirm === "remove" ? payment.amountCents : payment.amountCents - newCents}
          mode={confirm}
          newCents={newCents}
          pending={pending}
          error={error}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }}
          onConfirm={confirm === "remove" ? remove : save}
        />
      ) : null}
    </li>
  );
}

/**
 * The confirmation before Remove or a new amount: a Now / After table of each
 * balance that moves, because either one changes today's balances — ones
 * Victor may already have typed in by hand.
 */
function BalanceChangeWarning({
  payment,
  itemName,
  currency,
  backCents,
  mode,
  newCents,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  payment: CardPayment;
  itemName: string;
  currency: string;
  backCents: number;
  mode: "remove" | "amount";
  newCents: number;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  const refund = payment.undo?.refund ?? null;
  const debt = payment.undo?.debt ?? null;
  const when = new Date(`${payment.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const back = Math.abs(backCents);
  const owed = (cents: number) => (cents <= 0 ? "Paid off" : money(cents));
  return (
    <ModalShell
      title={mode === "remove" ? "Remove this payment?" : "Change this payment?"}
      onClose={onCancel}
      className="sm:max-w-md"
      mobileAlign="top"
    >
      <div className="space-y-3 px-5 py-4 text-sm">
        <p>
          {mode === "remove" ? (
            <>
              <span className="font-semibold tabular-nums">{money(payment.amountCents)}</span> paid to {itemName} on {when}.
            </>
          ) : (
            <>
              {itemName} on {when}. Net paid: <span className="font-semibold tabular-nums">{money(payment.amountCents)}</span> →{" "}
              <span className="font-semibold tabular-nums">{money(newCents)}</span>
            </>
          )}
        </p>
        {/* One row per balance that moves; a payment with no bank account on
            record simply has no bank row. */}
        {refund || debt ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="py-1.5 text-left font-semibold">What changes</th>
                <th className="px-2 py-1.5 text-center font-semibold">Now</th>
                <th className="px-2 py-1.5 text-center font-semibold">After</th>
              </tr>
            </thead>
            <tbody>
              {refund ? (
                <tr className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">
                    <div className="font-semibold">{refund.name}</div>
                    <div className="text-xs text-muted">{backCents >= 0 ? `gets ${money(back)} back` : `pays ${money(back)} more`}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums">{money(refund.balanceCents)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-center font-semibold tabular-nums">{money(refund.balanceCents + backCents)}</td>
                </tr>
              ) : null}
              {debt ? (
                <tr className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">
                    <div className="font-semibold">{debt.name}</div>
                    <div className="text-xs text-muted">you&rsquo;d owe {money(back)} {backCents >= 0 ? "more" : "less"}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums">{owed(debt.owedCents)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-center font-semibold tabular-nums text-negative">{owed(debt.owedCents + backCents)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
        {mode === "remove" ? (
          <p className="text-xs font-semibold text-negative">Remove only to make an adjustment or reimbursement.</p>
        ) : null}
        {error ? <p className="text-xs text-negative">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/10"
          >
            {mode === "remove" ? "Keep payment" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
              mode === "remove" ? "bg-negative" : "bg-brand hover:bg-brand-strong"
            }`}
          >
            {pending ? "Saving…" : mode === "remove" ? "Remove payment" : "Save change"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// A small money input with its label above it: Paid / Reimbursed on a payment.
function MoneyBox({
  label,
  value,
  onChange,
  placeholder,
  bold,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  bold?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex w-full items-center gap-1 rounded-md bg-background px-1 py-1 text-[14px] ring-1 sm:px-2 sm:text-sm ring-line focus-within:ring-2 focus-within:ring-brand">
        <span className="hidden text-muted sm:inline">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className={`w-20 min-w-0 flex-1 bg-transparent text-center tabular-nums focus:outline-none ${bold ? "font-semibold" : ""}`}
        />
      </span>
    </label>
  );
}

/** A column header that sorts the table. The arrow only shows on the sorted
 *  column; the hover wash says the others are clickable too. A hidden arrow
 *  holds its space so the label stays centred over its figures either way. */
function SortButton({ label, dir, onClick }: { label: string; dir: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 ${
        dir ? "text-foreground" : ""
      }`}
    >
      <span className="invisible w-2 text-[8px]" aria-hidden>▲</span>
      {label}
      <span className={`w-2 text-[8px] ${dir ? "" : "invisible"}`} aria-hidden>
        {dir === "asc" ? "▲" : "▼"}
      </span>
    </button>
  );
}
