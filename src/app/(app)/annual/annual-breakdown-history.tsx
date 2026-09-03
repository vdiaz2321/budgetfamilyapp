"use client";

import { useState, useRef, type CSSProperties, type RefObject } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";

export type BreakdownLine = {
  label: string;
  byYear: Record<number, number>; // cents, positive magnitude
  total: number;
  // Optional per-item breakdown (e.g. Subscriptions → Netflix, Spotify, …).
  // When present, the row shows a chevron and expands to indented sub-rows.
  details?: BreakdownLine[];
};

export type BreakdownGroup = {
  label: string;
  lines: BreakdownLine[];
  subtotalByYear: Record<number, number>;
  total: number;
};

export type BreakdownKind = {
  kind: "income" | "expenses" | "bills" | "debt" | "savings" | "investment" | "kidsFunding";
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
  const [collapse, setCollapse] = useSessionCollapse("annual-breakdown-history", () => ({ open: false }));
  const open = collapse.open;
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
    // Columns are sized to the figures they hold — a year column fits
    // "$133,847.09" and no more — so nine years of history read as a table
    // rather than as numbers marooned in white space. The line-item column
    // still takes any width left over on a wide screen.
    gridTemplateColumns: `minmax(11rem, 1fr) minmax(7.5rem, 1fr) repeat(${years.length}, minmax(7rem, 1fr))`,
  };
  const minW = `${12 + 7.5 + years.length * 7}rem`;

  return (
    <section className="rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Annual Breakdown</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line bg-brand-soft/10 p-3">
          {/* Summary strip — the whole panel's totals, above the two section columns */}
          <div className="rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
            <div
              ref={(el) => { if (el) scrollersRef.current.add(el); }}
              onScroll={(e) => syncScrollX(e.currentTarget.scrollLeft)}
              className="scroll-handle overflow-x-auto"
            >
              <div style={{ minWidth: minW }}>
                <div className="grid items-center gap-2 border-b border-line pr-4 py-2" style={gridStyle}>
                  <span className="pl-4 text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide">
                    Category
                  </span>
                  <span className="text-center text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide text-foreground">Total</span>
                  {years.map((y) => (
                    <span key={y} className="text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
                      {y}
                    </span>
                  ))}
                </div>
                {kinds.map((k) => (
                  <SummaryRow
                    key={k.kind}
                    label={k.label}
                    kind={k.kind}
                    byYear={k.totalByYear}
                    total={k.total}
                    years={years}
                    gridStyle={gridStyle}
                    currency={currency}
                  />
                ))}
                {/* Net (unallocated) — Income − Expenses − Savings − Investment */}
                <div className="grid items-center gap-2 border-t border-line pr-4 py-2" style={gridStyle}>
                  <span className="pl-4 text-[15px] 2xl:text-[21px] font-bold">Net</span>
                  {(() => { const netTotal = years.reduce((sum, y) => sum + (netByYear[y] ?? 0), 0); return (
                    <span className={`text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums ${netTotal < 0 ? "text-negative" : "text-positive"}`}>{formatMoney(netTotal, currency)}</span>
                  ); })()}
                  {years.map((y) => {
                    const v = netByYear[y] ?? 0;
                    return (
                      <span
                        key={y}
                        className={`text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums ${v < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatMoney(v, currency)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Per-kind detail, stacked in the same order as the summary rows
              above so a section is where its total says it is. */}
          {kinds.map((k) => (
            <KindBlock
              key={k.kind}
              kind={k}
              years={years}
              gridStyle={gridStyle}
              minW={minW}
              currency={currency}
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
  label, kind, byYear, total, years, gridStyle, currency,
}: {
  label: string; kind: string; byYear: Record<number, number>; total: number;
  years: number[]; gridStyle: CSSProperties; currency: string;
}) {
  const totalColor = kind === "income" || kind === "savings" || kind === "investment" ? "text-positive" : kind === "kidsFunding" ? "" : "text-negative";
  return (
    <div className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
      <span className="pl-4 text-[15px] 2xl:text-[21px] font-semibold">{label}</span>
      <span className={`text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums ${totalColor}`}>{formatMoney(total, currency)}</span>
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        return (
          <span key={y} className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums">
            {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
          </span>
        );
      })}
    </div>
  );
}

function KindBlock({
  kind, years, gridStyle, minW, currency, scrollersRef, syncScrollX,
}: {
  kind: BreakdownKind; years: number[]; gridStyle: CSSProperties; minW: string; currency: string;
  scrollersRef: RefObject<Set<HTMLDivElement>>; syncScrollX: (x: number) => void;
}) {
  const [collapse, setCollapse] = useSessionCollapse(`annual-breakdown-kind-${kind.kind}`, () => ({ open: false }));
  const open = collapse.open;
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  function syncHeader() {
    if (headerRef.current && bodyRef.current) {
      headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  }

  const filteredGroups = kind.groups;
  const effectiveOpen = open;

  return (
    <div className="rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10" style={{ overflow: "clip" }}>
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={effectiveOpen}
        className="flex w-full items-center gap-2 bg-brand-soft/40 px-4 py-2 text-left transition hover:bg-brand-soft/60"
      >
        <Chevron open={effectiveOpen} small />
        <span className="text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide">{kind.label}</span>
      </button>

      {effectiveOpen ? (
        <>
          {/* Sticky column header — overflow hidden so no scrollbar; JS-synced to body scroll */}
          <div
            ref={headerRef}
            className="border-y border-line bg-surface"
            style={{ overflowX: "hidden" }}
          >
            <div style={{ minWidth: minW }}>
              <div className="grid items-center gap-2 pr-4 py-2" style={gridStyle}>
                <span className="pl-4 text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
                  Line item
                </span>
                <span className="text-center text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide text-foreground">Total</span>
                {years.map((y) => (
                  <span key={y} className="text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
                    {y}
                  </span>
                ))}
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
            className="scroll-handle overflow-x-auto"
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
          <span className="pl-4 text-sm 2xl:text-lg font-bold leading-tight truncate">
            {group.label}
          </span>
          <span className="text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums">
            {formatMoney(group.total, currency)}
          </span>
          {years.map((y) => {
            const v = group.subtotalByYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums text-muted">
                {v !== 0 ? formatMoney(v, currency) : "—"}
              </span>
            );
          })}
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {group.lines.map((l) => (
          <LineRow
            key={l.label}
            line={l}
            years={years}
            gridStyle={gridStyle}
            currency={currency}
            indent={singleGroup ? "pl-4" : "pl-7"}
          />
        ))}
      </ul>
    </div>
  );
}

function LineRow({
  line, years, gridStyle, currency, indent,
}: {
  line: BreakdownLine; years: number[]; gridStyle: CSSProperties; currency: string; indent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (line.details?.length ?? 0) > 0;
  return (
    <>
      <li
        className={`grid items-center gap-2 pr-4 py-1.5 ${hasDetails ? "cursor-pointer hover:bg-brand-soft/20" : ""}`}
        style={gridStyle}
        onClick={hasDetails ? () => setExpanded((v) => !v) : undefined}
      >
        <span
          className={`min-w-0 text-sm 2xl:text-lg leading-tight ${indent} ${hasDetails ? "flex items-center gap-1.5" : "truncate"}`}
        >
          {hasDetails ? <Chevron open={expanded} small /> : null}
          <span className="truncate">{line.label}</span>
        </span>
        <span className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums">{formatMoney(line.total, currency)}</span>
        {years.map((y) => {
          const v = line.byYear[y] ?? 0;
          return (
            <span key={y} className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums">
              {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
            </span>
          );
        })}
      </li>
      {hasDetails && expanded ? line.details!.map((d) => (
        <li key={`${line.label}::${d.label}`} className="grid items-center gap-2 pr-4 py-1 bg-brand-soft/10" style={gridStyle}>
          <span className="truncate pl-12 text-[13px] 2xl:text-[18px] leading-tight text-muted">
            └ {d.label}
          </span>
          <span className="text-center text-[12px] 2xl:text-[16px] font-medium tabular-nums text-muted">{formatMoney(d.total, currency)}</span>
          {years.map((y) => {
            const v = d.byYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-[12px] 2xl:text-[16px] font-semibold tabular-nums text-muted">
                {v !== 0 ? formatMoney(v, currency) : <span className="opacity-40">—</span>}
              </span>
            );
          })}
        </li>
      )) : null}
    </>
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
