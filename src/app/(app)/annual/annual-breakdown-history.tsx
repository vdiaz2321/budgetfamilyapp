"use client";

import { useState, useRef, type CSSProperties, type RefObject } from "react";
import { formatMoney } from "@/lib/money";

export type BreakdownLine = {
  label: string;
  byYear: Record<number, number>; // cents, positive magnitude
  total: number;
};

export type BreakdownGroup = {
  label: string;
  lines: BreakdownLine[];
  subtotalByYear: Record<number, number>;
  total: number;
};

export type BreakdownKind = {
  kind: "income" | "expenses" | "bills" | "debt" | "savings" | "investment";
  label: string;
  groups: BreakdownGroup[];
  totalByYear: Record<number, number>;
  total: number;
};

type Props = {
  kinds: BreakdownKind[];
  years: number[]; // newest-first
  netByYear: Record<number, number>; // income − expenses − savings − investment
  currency: string;
};

export function AnnualBreakdownHistory({ kinds, years, netByYear, currency }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase();

  // All overflow-x-auto scroll containers (summary + each kind body) share one
  // scroll position so horizontal scrolling moves everything together.
  const scrollersRef = useRef<Set<HTMLDivElement>>(new Set());
  function syncScrollX(scrollLeft: number) {
    scrollersRef.current.forEach((el) => {
      if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
    });
  }

  if (!kinds.length) return null;

  // Dynamic column count (label + N years + Total) → inline style, since Tailwind's
  // JIT can't see a computed grid-cols-[…] arbitrary value.
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `12rem repeat(${years.length + 1}, minmax(7rem, 1fr))`,
  };
  const minW = `${13 + (years.length + 1) * 7.25}rem`;

  return (
    <section className="rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Annual Breakdown</span>
        <span className="text-xs text-muted">
          {years[years.length - 1]}–{years[0]} history · yearly totals
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line bg-brand-soft/10 p-3">
          {/* Search */}
          <input
            type="search"
            placeholder="Search line items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
          {/* Summary strip — sticky so year columns stay visible while scrolling into detail */}
          <div className="sticky top-0 z-30 rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
            <div
              ref={(el) => { if (el) scrollersRef.current.add(el); }}
              onScroll={(e) => syncScrollX(e.currentTarget.scrollLeft)}
              className="overflow-x-auto"
            >
              <div style={{ minWidth: minW }}>
                <div className="grid items-center gap-2 border-b border-line pr-4 py-2" style={gridStyle}>
                  <span className="sticky left-0 z-10 bg-surface pl-4 text-[11px] font-bold uppercase tracking-wide">
                    Summary
                  </span>
                  {years.map((y) => (
                    <span key={y} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                      {y}
                    </span>
                  ))}
                  <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Total</span>
                </div>
                {kinds.map((k) => (
                  <SummaryRow
                    key={k.kind}
                    label={k.label}
                    byYear={k.totalByYear}
                    total={k.total}
                    years={years}
                    gridStyle={gridStyle}
                    currency={currency}
                  />
                ))}
                {/* Net (unallocated) — Income − Expenses − Savings − Investment */}
                <div className="grid items-center gap-2 border-t border-line pr-4 py-2" style={gridStyle}>
                  <span className="sticky left-0 z-10 bg-surface pl-4 text-sm font-bold">Net</span>
                  {years.map((y) => {
                    const v = netByYear[y] ?? 0;
                    return (
                      <span
                        key={y}
                        className={`text-center text-xs font-bold tabular-nums ${v < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatMoney(v, currency)}
                      </span>
                    );
                  })}
                  <span className="text-center text-xs font-bold tabular-nums text-muted">—</span>
                </div>
              </div>
            </div>
          </div>

          {/* Per-kind detail */}
          {kinds.map((k) => (
            <KindBlock
              key={k.kind}
              kind={k}
              years={years}
              gridStyle={gridStyle}
              minW={minW}
              currency={currency}
              search={searchLower}
              scrollersRef={scrollersRef}
              syncScrollX={syncScrollX}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SummaryRow({
  label, byYear, total, years, gridStyle, currency,
}: {
  label: string; byYear: Record<number, number>; total: number;
  years: number[]; gridStyle: CSSProperties; currency: string;
}) {
  return (
    <div className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
      <span className="sticky left-0 z-10 bg-surface pl-4 text-sm font-semibold">{label}</span>
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        return (
          <span key={y} className="text-center text-xs tabular-nums">
            {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
          </span>
        );
      })}
      <span className="text-center text-xs font-bold tabular-nums">{formatMoney(total, currency)}</span>
    </div>
  );
}

function KindBlock({
  kind, years, gridStyle, minW, currency, search, scrollersRef, syncScrollX,
}: {
  kind: BreakdownKind; years: number[]; gridStyle: CSSProperties; minW: string; currency: string; search: string;
  scrollersRef: RefObject<Set<HTMLDivElement>>; syncScrollX: (x: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  function syncHeader() {
    if (headerRef.current && bodyRef.current) {
      headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  }

  // When searching, filter to groups/lines that match; auto-expand if there are hits.
  const filteredGroups = search
    ? kind.groups
        .map((g) => ({ ...g, lines: g.lines.filter((l) => l.label.toLowerCase().includes(search)) }))
        .filter((g) => g.lines.length > 0)
    : kind.groups;
  const effectiveOpen = open || (search.length > 0 && filteredGroups.length > 0);

  return (
    <div className="rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={effectiveOpen}
        className="flex w-full items-center gap-2 bg-brand-soft/40 px-4 py-2 text-left transition hover:bg-brand-soft/60"
      >
        <Chevron open={effectiveOpen} small />
        <span className="text-[11px] font-bold uppercase tracking-wide">{kind.label}</span>
      </button>

      {effectiveOpen ? (
        <>
          {/* Sticky column header — overflow hidden so no scrollbar; JS-synced to body scroll */}
          <div
            ref={headerRef}
            className="sticky top-0 z-20 border-y border-line bg-surface"
            style={{ overflowX: "hidden" }}
          >
            <div style={{ minWidth: minW }}>
              <div className="grid items-center gap-2 pr-4 py-2" style={gridStyle}>
                <span className="sticky left-0 z-10 bg-surface pl-4 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Line item
                </span>
                {years.map((y) => (
                  <span key={y} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                    {y}
                  </span>
                ))}
                <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Total</span>
              </div>
            </div>
          </div>

          {/* Scrollable body — syncs header locally and summary/sibling blocks globally */}
          <div
            ref={(el) => {
              bodyRef.current = el;
              if (el) scrollersRef.current.add(el);
            }}
            onScroll={(e) => {
              syncHeader();
              syncScrollX(e.currentTarget.scrollLeft);
            }}
            className="overflow-x-auto"
          >
            <div style={{ minWidth: minW }}>
              {filteredGroups.map((g) => (
                <Group
                  key={g.label}
                  group={g}
                  years={years}
                  gridStyle={gridStyle}
                  currency={currency}
                  singleGroup={kind.groups.length === 1}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Group({
  group, years, gridStyle, currency, singleGroup,
}: {
  group: BreakdownGroup; years: number[]; gridStyle: CSSProperties; currency: string; singleGroup: boolean;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      {/* Group subtotal header — omitted when the kind is a single group (Income,
          Savings, Investment) whose name would just repeat the section. */}
      {!singleGroup ? (
        <div className="grid items-center gap-2 bg-brand-soft/15 pr-4 py-1.5" style={gridStyle}>
          <span className="sticky left-0 z-10 truncate bg-surface pl-4 text-xs font-bold" title={group.label}>
            {group.label}
          </span>
          {years.map((y) => {
            const v = group.subtotalByYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-xs font-semibold tabular-nums text-muted">
                {v !== 0 ? formatMoney(v, currency) : "—"}
              </span>
            );
          })}
          <span className="text-center text-xs font-semibold tabular-nums text-muted">
            {formatMoney(group.total, currency)}
          </span>
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {group.lines.map((l) => (
          <li key={l.label} className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
            <span
              className={`sticky left-0 z-10 truncate bg-surface text-xs ${singleGroup ? "pl-4" : "pl-7"}`}
              title={l.label}
            >
              {l.label}
            </span>
            {years.map((y) => {
              const v = l.byYear[y] ?? 0;
              return (
                <span key={y} className="text-center text-[11px] tabular-nums">
                  {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                </span>
              );
            })}
            <span className="text-center text-[11px] font-semibold tabular-nums">{formatMoney(l.total, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  const size = small ? 13 : 15;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
