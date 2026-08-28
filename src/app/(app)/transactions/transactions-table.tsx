"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useHideOnScroll } from "@/lib/use-hide-on-scroll";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { deleteTransaction, listPayees, toggleCleared, updateTransactionAmount } from "../budget/actions";
import { TransactionModal } from "../budget/transaction-modal";
import { MonthPicker } from "../budget/month-picker";
import { ImportCsvModal } from "./import-csv-modal";
import { TransferEditorModal } from "./transfer-editor-modal";
import { DOT as KIND_DOT } from "../budget/category-icons";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "../budget/types";

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};

const GRID = "grid-cols-[5rem_2rem_6.5rem_8.5rem_minmax(8rem,1.3fr)_minmax(7rem,1.2fr)_minmax(7rem,1.1fr)_2rem]";
const CalendarIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
);

type Props = {
  month: { key: string; label: string; firstOfMonth: string };
  currency: string;
  transactions: TxData[];
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  bucketsByAccount?: import("../budget/types").BucketsByAccount;
  transferBuckets?: { id: string; accountId: string; name: string }[];
  payeeLineItems?: PayeeLineItem[];
  dateRange: { from: string | null; to: string | null };
};

export function TransactionsTable({
  month,
  currency,
  transactions,
  subOptions,
  accountOptions,
  bucketsByAccount = {},
  transferBuckets = [],
  payeeLineItems = [],
  dateRange,
}: Props) {
  const router = useRouter();
  // null = closed, "new" = add form, otherwise an existing tx to edit.
  const [modal, setModal] = useState<"new" | TxData | null>(null);
  // Same deal as the budget board: the payee autocomplete list is a large
  // array serialised into every page load for a control most visits never
  // open, so it's fetched the first time the transaction modal appears.
  const [payeeOptions, setPayeeOptions] = useState<{ id: string; name: string }[]>([]);
  const payeesRequested = useRef(false);
  const openModal = (target: "new" | TxData) => {
    if (!payeesRequested.current) {
      payeesRequested.current = true;
      void listPayees().then(setPayeeOptions);
    }
    setModal(target);
  };
  const [transferEdit, setTransferEdit] = useState<TxData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToolbarRef = useRef<HTMLDivElement>(null);
  const [fromDate, setFromDate] = useState(dateRange.from ?? "");
  const [toDate, setToDate] = useState(dateRange.to ?? "");
  // Date sort — defaults to descending (newest first). Click header to flip.
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");
  const cycleDateSort = () => setDateSort((s) => (s === "asc" ? "desc" : "asc"));
  // Toggles the table to show only rows the user hasn't yet reconciled
  // against their bank/card app — the exact set they need to hunt through
  // on any given day. Kept in local state (not URL) so a filter clicks off
  // easily and doesn't linger across sessions.
  const [uncleredOnly, setUnclearedOnly] = useState(false);
  const hasRange = Boolean(dateRange.from || dateRange.to);

  useEffect(() => {
    if (!searchOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !searchToolbarRef.current?.contains(target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [searchOpen]);

  // Mobile selection mode: tap Select to reveal checkboxes and a batch-action
  // bar at the bottom for Clear / Delete on many transactions at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [, startBatch] = useTransition();
  const toggleSelected = (id: string) => setSelectedIds((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectedTxs = () => transactions.filter((t) => selectedIds.has(t.id));
  const selectedNetCents = () => selectedTxs().reduce(
    (sum, t) => sum + (t.movementType ? 0 : t.kind === "income" ? t.amountCents : -t.amountCents),
    0,
  );
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const batchDelete = () => {
    const ids = selectedTxs()
      .filter((tx) => !tx.isCardPayment && !tx.isInvestmentTransfer)
      .map((tx) => tx.id);
    startBatch(async () => {
      for (const id of ids) {
        const fd = new FormData();
        fd.append("id", id);
        await deleteTransaction(fd);
      }
      exitSelectMode();
    });
  };
  const batchClear = (cleared: boolean) => {
    const ids = [...selectedIds];
    startBatch(async () => {
      for (const id of ids) {
        const fd = new FormData();
        fd.append("id", id);
        fd.append("cleared", cleared ? "true" : "false");
        await toggleCleared(fd);
      }
      exitSelectMode();
    });
  };
  const batchExportCsv = () => {
    const rows = selectedTxs();
    if (rows.length === 0) return;
    const qf = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Date", "Cleared", "Amount", "Type", "Category", "Payee", "Account", "Remarks"].join(","),
      ...rows.map((t) =>
        [
          t.date,
          t.cleared ? "yes" : "no",
          (t.amountCents / 100).toFixed(2),
          t.isTransfer ? "Transfer" : t.isInvestmentTransfer ? "Investment Transfer" : t.isCardPayment ? "Card Payment" : t.kind ? KIND_LABEL[t.kind] : "",
          t.subName,
          t.payee ?? "",
          t.accountId ? accountName.get(t.accountId) ?? "" : "",
          t.memo ?? "",
        ].map(qf).join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-selected-${rows.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function applyRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    router.push(params.toString() ? `/transactions?${params}` : "/transactions");
  }

  function clearRange() {
    setFromDate("");
    setToDate("");
    setSearchOpen(false);
    router.push(`/transactions?month=${month.key}`);
  }

  const accountName = new Map(accountOptions.map((a) => [a.id, a.name]));

  function exportCsv() {
    const qf = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ["Date", "Cleared", "Amount", "Type", "Category", "Payee", "Account", "Remarks"].join(","),
      ...filtered.map((t) =>
        [
          qf(t.date),
          qf(t.cleared ? "Yes" : "No"),
          qf(((t.isWithdrawal ? -1 : 1) * t.amountCents / 100).toFixed(2)),
          qf(t.isTransfer ? "Transfer" : t.isInvestmentTransfer ? "Investment Transfer" : t.isCardPayment ? "Card Payment" : (t.kind ? KIND_LABEL[t.kind] : "")),
          qf(t.subName),
          qf(t.payee),
          qf(t.accountId ? accountName.get(t.accountId) : ""),
          qf(t.memo),
        ].join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${month.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  const searchTerms = query.toLowerCase().split(/[;,\s]+/).map((term) => term.trim()).filter(Boolean);
  const filtered = transactions.filter((t) => {
    const amountText = (t.amountCents / 100).toFixed(2);
    const accountLabel = t.accountId ? accountName.get(t.accountId) ?? "" : "";
    const searchableText = [t.payee, t.subName, t.memo, accountLabel].filter(Boolean).join(" ").toLowerCase();
    const matchesSearch = searchTerms.every((term) => {
      const amountQuery = term.replace(/[$,]/g, "");
      return searchableText.includes(term) || amountText.includes(amountQuery.replace(/^-/, "")) || `-${amountText}`.includes(amountQuery);
    });
    if (!matchesSearch) return false;
    if (uncleredOnly && t.cleared) return false;
    return true;
  });
  {
    const dir = dateSort === "desc" ? -1 : 1;
    filtered.sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : 0));
  }

  const incomeTotal = filtered
    .filter((t) => t.kind === "income")
    .reduce((sum, t) => sum + t.amountCents, 0);
  const outflowTotal = filtered
    .filter((t) => t.kind !== "income" && !t.movementType)
    .reduce((sum, t) => sum + t.amountCents, 0);
  const incomeLeft = searchTerms.length > 0 ? 0 : incomeTotal - outflowTotal;

  const headerHidden = useHideOnScroll();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-2">
      {/* Phone-only auto-hide: scrolling further down slides the month picker
          and the toolbar away so the list gets the screen; scrolling back up
          brings them straight back. Desktop pins it (md:translate-y-0) — there
          is room for both there, and a header that moves under a mouse wheel
          is just twitchy. */}
      <div
        className={`sticky top-0 z-20 -mx-4 space-y-4 bg-background/95 px-4 pb-1 pt-3 backdrop-blur-sm transition-transform duration-200 ease-out md:mx-0 md:translate-y-0 md:px-0 ${
          headerHidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
      <div className="flex flex-wrap items-center justify-between gap-3 pr-8 sm:pr-0">
        {hasRange ? (
          <span className="text-2xl font-bold tracking-tight text-foreground">
            Custom range
          </span>
        ) : (
          <MonthPicker monthKey={month.key} basePath="/transactions" />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-muted ring-1 ring-black/20 transition hover:bg-brand-soft hover:text-brand sm:inline-block dark:ring-white/20"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-brand ring-1 ring-brand transition hover:bg-brand-soft sm:inline-block"
          >
            Import CSV
          </button>
        </div>
      </div>

      {/* Search popover + date range controls */}
      <div className="relative flex flex-wrap items-center gap-1.5 text-sm sm:gap-2">
        <div ref={searchToolbarRef} className="relative contents">
          <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-label="Search transactions"
          aria-expanded={searchOpen}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${searchOpen || query ? "bg-brand text-white shadow-sm" : "bg-surface text-brand ring-1 ring-brand/15 hover:bg-brand-soft"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      {searchOpen ? (
        <div className="absolute left-0 top-11 z-30 w-full rounded-xl bg-surface p-2 shadow-lg ring-1 ring-black/10 dark:ring-white/10 sm:max-w-md">
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search categories, payees, accounts, or amounts"
              className="w-full rounded-lg bg-background py-2 pl-3 pr-10 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-1 flex w-8 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-brand-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
          ) : null}
        </div>

      {/* Date range — searches across months instead of just the one selected above */}
        <div className="order-3 grid w-full grid-cols-[1fr_1fr_auto] items-center gap-1 rounded-xl bg-surface px-1.5 py-1 shadow-sm ring-1 ring-line sm:flex sm:w-auto sm:gap-1.5">
        <div className="relative min-w-0 sm:w-40 sm:flex-none">
          {!fromDate ? <span className="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center text-xs font-semibold text-muted">From</span> : null}
          <input
            type="date"
            aria-label="From date"
            value={fromDate}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                // Some browsers only expose their native picker through focus.
              }
            }}
            onChange={(e) => {
              setFromDate(e.target.value);
              applyRange(e.target.value, toDate);
            }}
            className={`w-full cursor-pointer appearance-none rounded-lg bg-background py-1.5 pr-9 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-brand [&::-webkit-calendar-picker-indicator]:opacity-0 dark:ring-white/15 ${fromDate ? "pl-2" : "pl-12 [&::-webkit-datetime-edit]:text-transparent"}`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 z-10 flex items-center text-foreground">{CalendarIcon}</span>
        </div>
        <div className="relative min-w-0 sm:w-40 sm:flex-none">
          {!toDate ? <span className="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center text-xs font-semibold text-muted">To</span> : null}
          <input
            type="date"
            aria-label="To date"
            value={toDate}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                // Some browsers only expose their native picker through focus.
              }
            }}
            onChange={(e) => {
              setToDate(e.target.value);
              applyRange(fromDate, e.target.value);
            }}
            className={`w-full cursor-pointer appearance-none rounded-lg bg-background py-1.5 pr-9 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-brand [&::-webkit-calendar-picker-indicator]:opacity-0 dark:ring-white/15 ${toDate ? "pl-2" : "pl-7 [&::-webkit-datetime-edit]:text-transparent"}`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 z-10 flex items-center text-foreground">{CalendarIcon}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setFromDate("2000-01-01");
            setToDate("");
            applyRange("2000-01-01", "");
          }}
          className="shrink-0 rounded-lg bg-black/10 px-2 py-1.5 font-medium text-foreground ring-1 ring-black/10 transition hover:bg-black/20 sm:px-3 dark:bg-white/15 dark:ring-white/15 dark:hover:bg-white/25"
        >
          All time
        </button>
        </div>
        <button
          type="button"
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          className={`order-1 rounded-xl px-2 py-1.5 font-semibold transition sm:px-3 ${
            selectMode
              ? "bg-negative/10 text-negative ring-1 ring-negative/20 hover:bg-negative/20"
              : "bg-positive/10 text-positive ring-1 ring-positive/20 hover:bg-positive/30 hover:shadow-sm"
          }`}
        >
          {selectMode ? "Cancel" : "Select"}
        </button>
        <button
          type="button"
          onClick={() => openModal("new")}
          className="order-2 flex items-center gap-1.5 rounded-xl bg-brand-soft px-2.5 py-1.5 font-bold text-brand shadow-sm ring-1 ring-brand/15 transition hover:bg-brand hover:text-white hover:shadow-sm sm:px-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Transaction
        </button>
        {/* Filter chip: show only rows still un-reconciled (cleared=false).
            Uses viz-savings blue when active so it never reads as
            purple/brand. Sits right after +Transaction so on mobile it
            wraps onto the same first row; on desktop it moves to the
            right of the date pill (order-4). */}
        <button
          type="button"
          aria-pressed={uncleredOnly}
          onClick={() => setUnclearedOnly((v) => !v)}
          className={`order-2 flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-semibold transition sm:order-4 sm:px-3 sm:py-1.5 sm:text-sm ${
            uncleredOnly
              ? "text-white shadow-sm ring-1"
              : "bg-surface text-foreground ring-1 ring-line hover:bg-black/5 dark:hover:bg-white/10"
          }`}
          style={
            uncleredOnly
              ? { backgroundColor: "var(--viz-savings)", boxShadow: "inset 0 0 0 1px var(--viz-savings)" }
              : undefined
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="2.5" />
          </svg>
          {/* Shorter label on mobile so the whole toolbar stays on one row
              next to +Transaction; full "Uncleared" text on sm+. */}
          <span className="sm:hidden">Unclear</span>
          <span className="hidden sm:inline">Uncleared</span>
        </button>
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded-xl px-2 py-1.5 font-medium text-muted transition hover:bg-brand-soft hover:text-foreground sm:px-3"
          >
            Clear search
          </button>
        ) : null}
        {hasRange ? (
          <button
            type="button"
            onClick={clearRange}
            className="rounded-xl px-3 py-1.5 font-medium text-muted hover:bg-brand-soft hover:text-foreground"
          >
            Clear — back to {month.label}
          </button>
        ) : null}
      </div>


      {/* Register — desktop table */}
      <div className="hidden overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 sm:block dark:ring-white/10">
        {selectMode && selectedIds.size > 0 ? (
          <div className="flex items-center gap-3 bg-brand-soft px-4 py-2.5 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-brand">{selectedIds.size} selected</span>
              <span className="text-muted">·</span>
              <span className="text-muted">
                <span className="font-medium">Selected total</span>{" "}
                <span className={`tabular-nums font-bold ${selectedNetCents() < 0 ? "text-negative" : "text-positive"}`}>
                  {formatMoney(selectedNetCents(), currency)}
                </span>
              </span>
            </div>
            <span className="text-base font-bold leading-none text-muted">/</span>
            <BatchActionButtons
              onClear={() => batchClear(true)}
              onUncheck={() => batchClear(false)}
              onExport={batchExportCsv}
              onDelete={batchDelete}
            />
          </div>
        ) : (
          <div className={`grid ${GRID} items-center gap-2 bg-positive/5 px-4 py-2.5 dark:bg-positive/10`}>
            <span className="col-span-2 whitespace-nowrap text-xs font-medium text-muted">
              {filtered.length} {filtered.length === 1 ? "transaction" : "transactions"}
            </span>
            <span className="col-span-7 whitespace-nowrap text-xs text-muted">
              <span className="font-bold text-foreground">Income Received</span>{" "}
              <span className="tabular-nums font-semibold text-positive">{formatMoney(incomeTotal, currency)}</span>
              <span className="mx-1.5">–</span>
              <span className="font-bold text-foreground">Spent Income</span>{" "}
              <span className="tabular-nums font-semibold text-negative">{formatMoney(outflowTotal, currency)}</span>
              <span className="mx-1.5">–</span>
              <span className="font-bold text-foreground">Income Left</span>{" "}
              <span className={`tabular-nums ${incomeLeft >= 0 ? "text-positive" : "text-negative"}`}>
                {formatMoney(incomeLeft, currency)}
              </span>
            </span>
            <span />
          </div>
        )}
      </div>

      {selectMode && selectedIds.size > 0 ? (
        <div className="-mx-4 space-y-2 border-y border-line bg-surface px-4 py-2 shadow-sm sm:hidden">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">{selectedIds.size} selected</span>
            <span className="text-muted">Total <span className={`font-bold tabular-nums ${selectedNetCents() < 0 ? "text-negative" : "text-positive"}`}>{formatMoney(selectedNetCents(), currency)}</span></span>
          </div>
          <BatchActionButtons
            onClear={() => batchClear(true)}
            onUncheck={() => batchClear(false)}
            onExport={batchExportCsv}
            onDelete={batchDelete}
            mobile
          />
        </div>
      ) : (
        <div className="-mx-4 flex items-center justify-between gap-2 bg-positive/5 px-4 py-2 text-[11px] shadow-sm ring-1 ring-black/5 sm:hidden dark:bg-positive/10 dark:ring-white/10">
          <span className="whitespace-nowrap"><span className="font-bold text-foreground">Received:</span>{" "}<span className="tabular-nums text-positive font-semibold">{formatMoney(incomeTotal, currency)}</span></span>
          <span className="whitespace-nowrap"><span className="font-bold text-foreground">Spent:</span>{" "}<span className="tabular-nums text-negative font-semibold">{formatMoney(outflowTotal, currency)}</span></span>
          <span className="whitespace-nowrap"><span className="font-bold text-foreground">Left:</span>{" "}<span className={`font-semibold tabular-nums ${incomeLeft >= 0 ? "text-positive" : "text-negative"}`}>{formatMoney(incomeLeft, currency)}</span></span>
        </div>
      )}

      </div>

      <section className="hidden overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 sm:block dark:ring-white/10">
        <div className="overflow-x-auto">
          <div className="min-w-[56.5rem]">
            {/* Header */}
            <div className={`grid ${GRID} items-center gap-2 border-t border-b border-line px-4 py-2.5`}>
              <button
                type="button"
                onClick={cycleDateSort}
                className="flex w-full items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted hover:text-primary"
                title={
                  dateSort === "asc"
                    ? "Oldest first — click for newest first"
                    : "Newest first — click for oldest first"
                }
              >
                Date
                <span className="text-[9px] leading-none">
                  {dateSort === "desc" ? "▼" : "▲"}
                </span>
              </button>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">{selectMode ? "Select" : "Clear"}</span>
              <span className="flex w-full justify-center text-[11px] font-medium uppercase tracking-wide text-muted">Amount</span>
              <span className="flex w-full justify-start text-[11px] font-medium uppercase tracking-wide text-muted">Type</span>
              <span className="flex w-full justify-start text-[11px] font-medium uppercase tracking-wide text-muted">Category</span>
              <span className="flex w-full justify-start text-[11px] font-medium uppercase tracking-wide text-muted">Payee</span>
              <span className="flex w-full justify-start text-[11px] font-medium uppercase tracking-wide text-muted">Account</span>
              <span />
            </div>

            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {transactions.length === 0
                  ? "No transactions this month yet — click + Transaction to log one."
                  : "No transactions match your filters."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((t) => (
                  <TxLine
                    key={t.id}
                    tx={t}
                    currency={currency}
                    accountName={t.accountId ? accountName.get(t.accountId) ?? "—" : "—"}
                    selectMode={selectMode}
                    selected={selectedIds.has(t.id)}
                    onSelect={() => toggleSelected(t.id)}
                    onEdit={() => {
                      if (t.isTransfer) setTransferEdit(t);
                      else if (!t.isCardPayment && !t.isInvestmentTransfer) openModal(t);
                    }}
                  />
                ))}
              </ul>
            )}

          </div>
        </div>
      </section>

      {/* Register — mobile card list */}
      <section className="-mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-black/5 sm:hidden dark:ring-white/10">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {transactions.length === 0
              ? "No transactions this month yet — tap + Transaction to log one."
              : "No transactions match your filters."}
          </p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {filtered.map((t) => (
              <TxCard
                key={t.id}
                tx={t}
                currency={currency}
                accountName={t.accountId ? accountName.get(t.accountId) ?? "—" : "—"}
                selectMode={selectMode}
                selected={selectedIds.has(t.id)}
                onSelect={() => toggleSelected(t.id)}
                onTap={() => {
                  if (selectMode) toggleSelected(t.id);
                  else if (t.isTransfer) setTransferEdit(t);
                  else if (!t.isCardPayment && !t.isInvestmentTransfer) openModal(t);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {modal ? (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full sm:max-w-[520px]">
            <TransactionModal
              editTx={modal === "new" ? null : modal}
              monthKey={month.key}
              firstOfMonth={month.firstOfMonth}
              subOptions={subOptions}
              accountOptions={accountOptions}
              bucketsByAccount={bucketsByAccount}
              payeeOptions={payeeOptions}
              payeeLineItems={payeeLineItems}
              onClose={() => setModal(null)}
            />
          </div>
        </div>
      ) : null}

      {transferEdit ? (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full sm:max-w-[520px]">
            <TransferEditorModal
              transfer={transferEdit}
              accounts={accountOptions}
              buckets={transferBuckets}
              onClose={() => setTransferEdit(null)}
            />
          </div>
        </div>
      ) : null}

      {importOpen ? <ImportCsvModal onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function BatchActionButtons({
  onClear,
  onUncheck,
  onExport,
  onDelete,
  mobile = false,
}: {
  onClear: () => void;
  onUncheck: () => void;
  onExport: () => void;
  onDelete: () => void;
  mobile?: boolean;
}) {
  const buttonClass = mobile
    ? "flex-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold transition"
    : "whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition";

  return (
    <div className={`flex items-center gap-1.5 ${mobile ? "w-full" : "shrink-0"}`}>
      <button type="button" onClick={onClear} className={`${buttonClass} bg-positive/10 text-positive hover:bg-positive/20`}>Clear</button>
      <button type="button" onClick={onUncheck} className={`${buttonClass} bg-line/60 text-foreground hover:bg-line`}>Uncheck</button>
      <button type="button" onClick={onExport} className={`${buttonClass} bg-line/60 text-foreground hover:bg-line`}>Export</button>
      <button type="button" onClick={onDelete} className={`${buttonClass} bg-negative/10 text-negative hover:bg-negative/20`}>Delete</button>
    </div>
  );
}

function TxLine({
  tx,
  currency,
  accountName,
  selectMode,
  selected,
  onSelect,
  onEdit,
}: {
  tx: TxData;
  currency: string;
  accountName: string;
  selectMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const [clearPending, startClear] = useTransition();
  const [delPending, startDel] = useTransition();
  const [amountEditing, setAmountEditing] = useState(false);
  const [amountValue, setAmountValue] = useState((tx.amountCents / 100).toFixed(2));
  const [amountPending, startAmountSave] = useTransition();
  const isIncome = tx.kind === "income";
  const canEdit = !tx.isCardPayment && !tx.isInvestmentTransfer;

  const saveAmount = () => {
    const normalized = Number(amountValue.replace(",", "."));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      setAmountValue((tx.amountCents / 100).toFixed(2));
      setAmountEditing(false);
      return;
    }
    const nextValue = normalized.toFixed(2);
    if (nextValue === (tx.amountCents / 100).toFixed(2)) {
      setAmountEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("id", tx.id);
    fd.set("amount", nextValue);
    startAmountSave(async () => {
      await updateTransactionAmount(fd);
      setAmountEditing(false);
    });
  };

  const onToggle = (checked: boolean) => {
    const fd = new FormData();
    fd.set("id", tx.id);
    fd.set("cleared", String(checked));
    startClear(() => toggleCleared(fd));
  };

  // Clicking anywhere on the row opens the edit card. Date, category and payee
  // were already wired individually, which left the Type and Account cells
  // dead — clicking the account you were looking at did nothing. The controls
  // that do something else (cleared, amount, delete) stop the click first.
  return (
    <li
      onClick={selectMode ? onSelect : canEdit ? onEdit : undefined}
      className={`group grid ${GRID} ${selectMode || canEdit ? "cursor-pointer" : "cursor-default"} select-none items-center gap-2 px-4 py-2 hover:bg-brand-soft/25 ${
        tx.cleared && !selected ? "opacity-60" : ""
      } ${selected ? "bg-brand-soft/40" : ""}`}
    >
      <button type="button" disabled={!canEdit} onClick={onEdit} className="text-left text-sm tabular-nums disabled:cursor-default">
        {tx.date.slice(5, 7)}/{tx.date.slice(8, 10)}/{tx.date.slice(2, 4)}
      </button>
      <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="flex justify-center">
        {selectMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            title="Select this transaction"
            aria-label="Select transaction"
            className="h-4 w-4 rounded accent-[var(--brand)]"
          />
        ) : (
          <input
            type="checkbox"
            checked={tx.cleared}
            disabled={clearPending}
            onChange={(e) => onToggle(e.target.checked)}
            title="Cleared — verified against your bank / card app"
            aria-label="Cleared"
            className="h-4 w-4 rounded accent-[var(--positive)] disabled:opacity-50"
          />
        )}
      </span>
      {amountEditing ? (
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={amountValue}
          disabled={amountPending}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setAmountValue(e.target.value)}
          onBlur={saveAmount}
          // In selectMode the row's onClick toggles selection; a click INSIDE
          // this edit input would otherwise bubble up and uncheck the row
          // Victor was in the middle of adjusting. Stop it at the input.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setAmountValue((tx.amountCents / 100).toFixed(2));
              setAmountEditing(false);
            }
          }}
          aria-label={`Edit amount for ${tx.payee ?? tx.subName}`}
          className="w-20 rounded-md border border-brand bg-surface px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums outline-none ring-2 ring-brand/30 disabled:opacity-60"
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation();
            setAmountEditing(true);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={canEdit ? "Click to edit amount" : "Card payment — edit it from the card account"}
          className={`rounded-md px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums transition hover:bg-brand-soft hover:text-brand-strong focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-inherit ${
          isIncome || tx.amountCents < 0 ? "text-positive" : "text-foreground"
        }`}
      >
        {/* Refunds are stored as negative amounts. They still read as an
            inflow, so we show them as +$X (positive-colored) with a small
            "Refund" chip next to the value in the type column below. */}
        {isIncome || tx.amountCents < 0 ? "+" : "−"}
        {formatMoney(Math.abs(tx.amountCents), currency)}
        </button>
      )}
      <span className="truncate text-sm text-muted">
        {tx.amountCents < 0 ? (
          <span className="rounded bg-positive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-positive">
            Refund
          </span>
        ) : (
          tx.isTransfer
            ? "Transfer"
            : tx.isInvestmentTransfer
              ? "Investment transfer"
              : tx.isCardPayment
                ? "Card payment"
                : tx.kind ? KIND_LABEL[tx.kind] : "—"
        )}
      </span>
      <button type="button" disabled={!canEdit} onClick={onEdit} className="flex min-w-0 items-center gap-1.5 text-left disabled:cursor-default">
        {tx.kind ? <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[tx.kind]}`} /> : null}
        <span className="truncate text-sm">{tx.subName}</span>
      </button>
      <button type="button" disabled={!canEdit} onClick={onEdit} className="truncate text-left text-sm font-medium disabled:cursor-default">
        {tx.payee ?? "—"}
      </button>
      <span className="truncate text-xs text-muted">{accountName}</span>
      <form
        action={(fd) => startDel(() => deleteTransaction(fd))}
        onClick={(e) => e.stopPropagation()}
        className="justify-self-end"
      >
        <input type="hidden" name="id" value={tx.id} />
        <button
          type="submit"
          disabled={delPending || !canEdit}
          title="Delete transaction"
          aria-label="Delete transaction"
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-negative/10 hover:text-negative group-hover:opacity-100 disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </form>
    </li>
  );
}

function TxCard({
  tx,
  currency,
  accountName,
  selectMode,
  selected,
  onSelect,
  onTap,
}: {
  tx: TxData;
  currency: string;
  accountName: string;
  selectMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onTap: () => void;
}) {
  const canEdit = !tx.isCardPayment && !tx.isInvestmentTransfer;
  const isIncome = tx.kind === "income";
  const dateStr = `${tx.date.slice(5, 7)}/${tx.date.slice(8, 10)}`;

  // Swipe gesture — dragging left reveals Delete, dragging right reveals
  // Clear/Uncheck. Released past the threshold, the corresponding action fires;
  // otherwise the row springs back. Disabled in select mode (tap = toggle).
  // Direction lock: if the first significant movement is more vertical than
  // horizontal we treat it as a scroll and don't intercept the gesture.
  const [dx, setDx] = useState(0);
  const [committed, setCommitted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const direction = useRef<"h" | "v" | null>(null);
  const [, startAction] = useTransition();
  const THRESH = 72;
  const MAX = 96;

  const onTouchStart = (e: React.TouchEvent) => {
    if (selectMode || !canEdit) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    direction.current = null;
    setCommitted(false);
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (selectMode || !canEdit || startX.current === 0) return;
    const rawX = e.touches[0].clientX - startX.current;
    const rawY = e.touches[0].clientY - startY.current;
    if (direction.current === null) {
      if (Math.abs(rawX) < 6 && Math.abs(rawY) < 6) return;
      direction.current = Math.abs(rawX) >= Math.abs(rawY) ? "h" : "v";
    }
    if (direction.current === "v") return;
    setDx(Math.max(-MAX, Math.min(MAX, rawX)));
  };
  const onTouchEnd = () => {
    if (selectMode || !canEdit) return;
    if (dx <= -THRESH) {
      setDx(-MAX);
      setCommitted(true);
      startAction(async () => {
        const fd = new FormData();
        fd.append("id", tx.id);
        await deleteTransaction(fd);
      });
    } else if (dx >= THRESH) {
      setDx(MAX);
      setCommitted(true);
      startAction(async () => {
        const fd = new FormData();
        fd.append("id", tx.id);
        fd.append("cleared", tx.cleared ? "false" : "true");
        await toggleCleared(fd);
        setDx(0);
        setCommitted(false);
      });
    } else {
      setDx(0);
    }
    startX.current = 0;
    setDragging(false);
  };

  return (
    <li className="relative overflow-hidden">
      {/* Swipe backgrounds */}
      {!selectMode && (
        <>
          {/* right-swipe (Clear) */}
          <div className={`pointer-events-none absolute inset-0 flex items-center bg-positive px-4 text-sm font-semibold text-white ${dx > 0 ? "opacity-100" : "opacity-0"} transition-opacity`}>
            {tx.cleared ? "Uncheck" : "Clear ✓"}
          </div>
          {/* left-swipe (Delete) */}
          <div className={`pointer-events-none absolute inset-0 flex items-center justify-end bg-negative px-4 text-sm font-semibold text-white ${dx < 0 ? "opacity-100" : "opacity-0"} transition-opacity`}>
            Delete
          </div>
        </>
      )}

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)`, transition: dragging && !committed ? "none" : "transform 200ms ease" }}
        className="relative flex items-center gap-2 bg-surface"
      >
        {selectMode ? (
          <button
            type="button"
            onClick={onSelect}
            aria-label={selected ? "Deselect" : "Select"}
            className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${selected ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}
          >
            {selected ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 13l4 4L19 7" />
              </svg>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canEdit && !selectMode}
          onClick={onTap}
          className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition active:bg-brand-soft/25 disabled:cursor-default ${
            tx.cleared ? "opacity-60" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm font-semibold ${tx.cleared ? "text-muted" : "text-foreground"}`}>
              {tx.payee ?? tx.subName}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={`whitespace-nowrap text-sm font-bold tabular-nums ${
                  isIncome ? "text-positive" : "text-foreground"
                }`}
              >
                {isIncome ? "+" : "−"}
                {formatMoney(tx.amountCents, currency)}
              </span>
              <span
                aria-label={tx.cleared ? "Cleared" : "Not cleared"}
                title={tx.cleared ? "Cleared" : "Not cleared"}
                className={`inline-flex h-3 w-3 items-center justify-center rounded-full text-[7px] font-bold leading-none ring-1 ${
                  tx.cleared
                    ? "bg-positive text-white ring-positive"
                    : "bg-transparent text-muted/40 ring-line"
                }`}
              >
                c
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 shrink items-center gap-1.5 truncate text-xs text-muted">
              {tx.kind ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[tx.kind]}`} /> : null}
              {tx.payee
                ? accountName && accountName !== "—"
                  ? `${tx.subName} · ${accountName}`
                  : tx.subName
                : accountName}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs font-medium text-muted tabular-nums">
              {dateStr}
            </span>
          </div>
        </button>
      </div>
    </li>
  );
}
