"use client";

import { useState, useRef, type CSSProperties, type RefObject } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { MoneyCell } from "./annual-cell";

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

type KindKey = BreakdownKind["kind"];

/** Ring color for a selected cell — the --viz palette, never the brand indigo. */
const BREAKDOWN_COLOR: Record<KindKey, string> = {
  income: "var(--positive)",
  savings: "var(--viz-savings)",
  investment: "var(--viz-savings)",
  bills: "var(--negative)",
  expenses: "var(--negative)",
  debt: "var(--negative)",
  kidsFunding: "var(--foreground)",
};

/**
 * How a kind enters the panel's Net row: income adds, every outflow subtracts,
 * and Kids Funding sits outside it — the same arithmetic the seeded netByYear
 * uses, so a selection's net reads on the same terms as the row above it.
 */
const NET_SIGN: Record<KindKey, 1 | -1 | 0> = {
  income: 1,
  savings: -1,
  investment: -1,
  bills: -1,
  expenses: -1,
  debt: -1,
  kidsFunding: 0,
};

type SelectedYearCell = { year: number; kind: KindKey; amountCents: number };

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
  // Cells picked out of the line-item rows below. Kept here rather than in
  // the hero: those cards are year-scoped ("2026 Spending") and have already
  // scrolled away by the time this panel is on screen, so the answer belongs
  // in this panel's own sticky strip, on its own category x year terms.
  const [selected, setSelected] = useState<Map<string, SelectedYearCell>>(() => new Map());
  const toggleCell = (key: string, cell: SelectedYearCell) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, cell);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Map());

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
    gridTemplateColumns: `minmax(9.5rem, 1fr) minmax(8rem, 1fr) repeat(${years.length}, minmax(6.25rem, 1fr))`,
  };
  const minW = `${10 + 8 + years.length * 6.25}rem`;

  // What the selection adds up to, per year and overall. `net` only means
  // anything once both sides of the ledger are in play, so it is computed but
  // shown conditionally.
  const pickedByYear: Record<number, number> = {};
  const netPickedByYear: Record<number, number> = {};
  let pickedTotal = 0;
  let netPickedTotal = 0;
  let hasInflow = false;
  let hasOutflow = false;
  for (const cell of selected.values()) {
    pickedByYear[cell.year] = (pickedByYear[cell.year] ?? 0) + cell.amountCents;
    pickedTotal += cell.amountCents;
    const signed = NET_SIGN[cell.kind] * cell.amountCents;
    netPickedByYear[cell.year] = (netPickedByYear[cell.year] ?? 0) + signed;
    netPickedTotal += signed;
    if (NET_SIGN[cell.kind] === 1) hasInflow = true;
    if (NET_SIGN[cell.kind] === -1) hasOutflow = true;
  }
  const showNetPicked = hasInflow && hasOutflow;

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
          {/* Summary strip — the whole panel's totals, and sticky: reading a
              line item nine years across is only worth anything next to the
              category totals it belongs to. The hero cards have released by
              the time this panel is on screen, so top-0 is free. */}
          {/* The solid rule and drop shadow are the point: pinned at top-0
              this strip lands where the hero cards were a moment ago, and
              without a hard edge the two read as one floating thing. */}
          <div
            className="sticky top-0 z-30 rounded-lg bg-surface ring-1 ring-black/10 shadow-[0_3px_0_0_var(--color-line),0_12px_16px_-12px_rgba(0,0,0,0.45)] dark:ring-white/15"
            style={{ overflow: "clip" }}
          >
            <div
              ref={(el) => { if (el) scrollersRef.current.add(el); }}
              onScroll={(e) => syncScrollX(e.currentTarget.scrollLeft)}
              className="scroll-handle overflow-x-auto"
            >
              <div style={{ minWidth: minW }}>
                <div className="grid items-center gap-2 border-b border-line bg-black/[0.05] pr-4 py-2 dark:bg-white/[0.08]" style={gridStyle}>
                  <span className="pl-4 text-[13px] font-bold uppercase tracking-wide">
                    Category
                  </span>
                  <span className="text-center text-[13px] font-bold uppercase tracking-wide text-foreground">Total</span>
                  {years.map((y) => (
                    <span key={y} className="text-center text-[13px] font-medium uppercase tracking-wide text-muted">
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
                  <span className="pl-4 text-[15px] font-bold">Net</span>
                  {(() => { const netTotal = years.reduce((sum, y) => sum + (netByYear[y] ?? 0), 0); return (
                    <span className={`text-center text-[18px] font-bold tabular-nums ${netTotal < 0 ? "text-negative" : "text-positive"}`}>{formatMoney(netTotal, currency)}</span>
                  ); })()}
                  {years.map((y) => {
                    const v = netByYear[y] ?? 0;
                    return (
                      <span
                        key={y}
                        className={`text-center text-[18px] font-bold tabular-nums ${v < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatMoney(v, currency)}
                      </span>
                    );
                  })}
                </div>

                {selected.size > 0 ? (
                  <>
                    <SelectionRow
                      label="Selected"
                      dividerAbove
                      onClear={clearSelection}
                      total={pickedTotal}
                      byYear={pickedByYear}
                      years={years}
                      gridStyle={gridStyle}
                      currency={currency}
                    />
                    {showNetPicked ? (
                      <SelectionRow
                        label="Net of selection"
                        total={netPickedTotal}
                        byYear={netPickedByYear}
                        years={years}
                        gridStyle={gridStyle}
                        currency={currency}
                        signed
                      />
                    ) : null}
                  </>
                ) : null}
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
              selected={selected}
              onToggleCell={toggleCell}
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
      <span className="pl-4 text-[15px] font-semibold">{label}</span>
      <span className={`text-center text-[18px] font-bold tabular-nums ${totalColor}`}>{formatMoney(total, currency)}</span>
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        return (
          <span key={y} className="text-center text-[18px] tabular-nums">
            {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
          </span>
        );
      })}
    </div>
  );
}

function KindBlock({
  kind, years, gridStyle, minW, currency, scrollersRef, syncScrollX,
  selected, onToggleCell,
}: {
  kind: BreakdownKind; years: number[]; gridStyle: CSSProperties; minW: string; currency: string;
  scrollersRef: RefObject<Set<HTMLDivElement>>; syncScrollX: (x: number) => void;
  selected: Map<string, SelectedYearCell>;
  onToggleCell: (key: string, cell: SelectedYearCell) => void;
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
        <span className="text-[13px] font-bold uppercase tracking-wide">{kind.label}</span>
      </button>

      {effectiveOpen ? (
        <>
          {/* Column header — overflow hidden so no scrollbar; JS-synced to
              body scroll. Not sticky itself: the summary strip above holds
              top-0 for the whole panel, and its own header names the same
              year columns. */}
          <div
            ref={headerRef}
            className="border-y border-line bg-surface"
            style={{ overflowX: "hidden" }}
          >
            <div style={{ minWidth: minW }}>
              <div className="grid items-center gap-2 pr-4 py-2" style={gridStyle}>
                <span className="pl-4 text-[13px] font-medium uppercase tracking-wide text-muted">
                  Line item
                </span>
                <span className="text-center text-[13px] font-bold uppercase tracking-wide text-foreground">Total</span>
                {years.map((y) => (
                  <span key={y} className="text-center text-[13px] font-medium uppercase tracking-wide text-muted">
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
                  kindKey={kind.kind}
                  years={years}
                  gridStyle={gridStyle}
                  currency={currency}
                  selected={selected}
                  onToggleCell={onToggleCell}
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
  group, kindKey, years, gridStyle, currency, singleGroup, selected, onToggleCell,
}: {
  group: BreakdownGroup; kindKey: KindKey; years: number[]; gridStyle: CSSProperties;
  currency: string; singleGroup: boolean;
  selected: Map<string, SelectedYearCell>;
  onToggleCell: (key: string, cell: SelectedYearCell) => void;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      {/* Group subtotal header — omitted when the kind is a single group (Income,
          Savings, Investment) whose name would just repeat the section. */}
      {!singleGroup ? (
        <div className="grid items-center gap-2 bg-brand-soft/15 pr-4 py-1.5" style={gridStyle}>
          <span className="pl-4 text-sm font-bold leading-tight truncate">
            {group.label}
          </span>
          <span className="text-center text-[18px] font-bold tabular-nums">
            {formatMoney(group.total, currency)}
          </span>
          {years.map((y) => {
            const v = group.subtotalByYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-[18px] tabular-nums text-muted">
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
            rowKey={`${kindKey}|${group.label}|${l.label}`}
            kindKey={kindKey}
            years={years}
            gridStyle={gridStyle}
            currency={currency}
            indent={singleGroup ? "pl-4" : "pl-7"}
            selected={selected}
            onToggleCell={onToggleCell}
          />
        ))}
      </ul>
    </div>
  );
}

function LineRow({
  line, rowKey, kindKey, years, gridStyle, currency, indent, selected, onToggleCell,
}: {
  line: BreakdownLine; rowKey: string; kindKey: KindKey; years: number[];
  gridStyle: CSSProperties; currency: string; indent: string;
  selected: Map<string, SelectedYearCell>;
  onToggleCell: (key: string, cell: SelectedYearCell) => void;
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
          className={`min-w-0 text-sm leading-tight ${indent} ${hasDetails ? "flex items-center gap-1.5" : "truncate"}`}
        >
          {hasDetails ? <Chevron open={expanded} small /> : null}
          <span className="truncate">{line.label}</span>
        </span>
        <span className="text-center text-[18px] tabular-nums">{formatMoney(line.total, currency)}</span>
        {years.map((y) => {
          const v = line.byYear[y] ?? 0;
          const key = `${rowKey}|${y}`;
          return (
            <MoneyCell
              key={y}
              empty={v === 0}
              color={BREAKDOWN_COLOR[kindKey]}
              active={selected.has(key)}
              // A row with a payee split toggles it on click. A cell click is
              // about the figure, not the row, so it must not also open the
              // split underneath it.
              stopPropagation
              onToggle={() => onToggleCell(key, { year: y, kind: kindKey, amountCents: v })}
            >
              {formatMoney(v, currency)}
            </MoneyCell>
          );
        })}
      </li>
      {hasDetails && expanded ? line.details!.map((d) => (
        <li key={`${line.label}::${d.label}`} className="grid items-center gap-2 pr-4 py-1 bg-brand-soft/10" style={gridStyle}>
          <span className="truncate pl-12 text-[13px] leading-tight text-muted">
            └ {d.label}
          </span>
          <span className="text-center text-[16px] font-medium tabular-nums text-muted">{formatMoney(d.total, currency)}</span>
          {years.map((y) => {
            const v = d.byYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-[16px] tabular-nums text-muted">
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

/**
 * The selection's answer, rendered as one more row of the sticky summary
 * strip: same columns, same reading order, directly above the cells being
 * picked. `signed` rows carry a sign that means something (a net), so they
 * take the positive/negative tint; a plain sum does not.
 */
function SelectionRow({
  label, onClear, total, byYear, years, gridStyle, currency, signed, dividerAbove,
}: {
  label: string;
  onClear?: () => void;
  total: number;
  byYear: Record<number, number>;
  years: number[];
  gridStyle: CSSProperties;
  currency: string;
  signed?: boolean;
  /** Hard rule above the first selection row: the year totals it sits under
   *  are the panel's own figures, and these are the reader's — the two must
   *  not read as one continuous block. */
  dividerAbove?: boolean;
}) {
  const tint = (v: number) => (signed ? (v < 0 ? "text-negative" : "text-positive") : "");
  return (
    <div
      className={`grid items-center gap-2 bg-black/[0.03] pr-4 py-2 dark:bg-white/[0.06] ${
        dividerAbove
          ? "border-t-[3px] border-foreground/80"
          : "border-t border-line"
      }`}
      style={gridStyle}
    >
      <span className="flex items-center gap-2 pl-4">
        <span className="text-[15px] font-bold">{label}</span>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md bg-black/5 px-2 py-0.5 text-[12px] font-semibold transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
          >
            Clear
          </button>
        ) : null}
      </span>
      <span className={`text-center text-[18px] font-bold tabular-nums ${tint(total)}`}>
        {formatMoney(total, currency)}
      </span>
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        return (
          <span
            key={y}
            className={`text-center text-[18px] font-semibold tabular-nums ${v === 0 ? "text-muted" : tint(v)}`}
          >
            {v !== 0 ? formatMoney(v, currency) : "—"}
          </span>
        );
      })}
    </div>
  );
}
