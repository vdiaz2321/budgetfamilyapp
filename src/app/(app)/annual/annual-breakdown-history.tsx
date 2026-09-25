"use client";

import { useEffect, useState, useRef, type CSSProperties, type RefObject } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { MoneyCell, periodHeaderClass } from "./annual-cell";

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

// How many years "Recent" keeps. The panel gains a column every January, so
// without this the table only ever gets wider — by 2031 it is 14 columns and
// 1,860px, and the years you actually compare against are the ones pushed
// furthest from the Category label.
const RECENT_YEARS = 5;
// Bolded in the year headers, the way the other tables bold this month.
const CURRENT_YEAR = new Date().getFullYear();

/**
 * A row's Total, summed over the years currently on screen.
 *
 * The seeded `total` on every line is an all-years figure, so showing it
 * beside five visible columns would print a Total the row visibly doesn't add
 * up to. Everything in this panel totals what it shows.
 */
function sumOverYears(byYear: Record<number, number>, years: number[]): number {
  return years.reduce((sum, y) => sum + (byYear[y] ?? 0), 0);
}

// The Total column, shaded and fenced off with a rule down its right edge —
// the same treatment the Category by Months table gives its Year total, so a
// column of sums is never mistaken for another year.
function TotalBand({ pad, plain, children }: { pad: string; plain?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`${pad} flex items-center justify-center self-stretch border-r-2 border-line px-1 ${
        plain ? "" : "bg-black/[0.035] dark:bg-white/[0.05]"
      }`}
    >
      {children}
    </span>
  );
}

type Props = {
  kinds: BreakdownKind[];
  years: number[]; // newest-first
  netByYear: Record<number, number>; // income − expenses − savings − investment
  currency: string;
};

export function AnnualBreakdownHistory({ kinds, years: allYears, netByYear, currency }: Props) {
  const [collapse, setCollapse] = useSessionCollapse("annual-breakdown-history", () => ({ open: true }));
  const open = collapse.open;
  // Recent by default — the full history is two clicks of scrolling away and
  // is rarely the question. `allYears` is newest-first, so the recent slice is
  // just the head of it.
  const [showAllYears, setShowAllYears] = useState(false);
  const canTrim = allYears.length > RECENT_YEARS;
  const years = showAllYears || !canTrim ? allYears : allYears.slice(0, RECENT_YEARS);
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

  // The panel's own title bar stays pinned while its rows scroll, with the
  // totals strip parked directly under it — the year range and Export were
  // gone the moment you started reading. The strip's offset is measured, not
  // guessed, so the two never overlap.
  const titleBarRef = useRef<HTMLDivElement>(null);
  const [titleBarH, setTitleBarH] = useState(0);
  useEffect(() => {
    const el = titleBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTitleBarH(el.offsetHeight));
    ro.observe(el);
    setTitleBarH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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
    // Columns are sized to the figures they hold, with the widest figure
    // actually measured rather than estimated: a year column has to fit
    // "$133,847.09" (108px) and the Total column "$1,046,113.78" (133px).
    // At the old 6.25rem/8rem those two overflowed their tracks — and
    // because the row is already wider than the panel the `1fr` never
    // stretches, so the overflow landed on top of the neighbouring year.
    gridTemplateColumns: `minmax(9.5rem, 1fr) minmax(9.5rem, 1fr) repeat(${years.length}, minmax(7rem, 1fr))`,
  };
  const minW = `${9.5 + 9.5 + years.length * 7}rem`;

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
      {/* The collapse control and the export sit side by side rather than
          nested — a button inside a button is invalid, and clicking Export
          must not fold the panel shut under it. */}
      <div ref={titleBarRef} className="sticky top-0 z-40 flex items-center gap-2 border-b border-line bg-surface pr-3">
        <button
          type="button"
          onClick={() => setCollapse({ open: !open })}
          aria-expanded={open}
          className="flex min-w-0 shrink items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
        >
          <Chevron open={open} />
          <span className="font-semibold">Annual Breakdown</span>
        </button>
        {/* Only offered once there is something to trim, and only while the
            panel is open — a range control over a folded table is noise. */}
        {open && canTrim ? (
          <button
            type="button"
            onClick={() => setShowAllYears((v) => !v)}
            aria-pressed={showAllYears}
            className="shrink-0 cursor-pointer rounded-lg border border-sky-400 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-sky-200 dark:border-sky-500 dark:bg-sky-900/40 dark:hover:bg-sky-900/60"
          >
            {showAllYears
              ? `Last ${RECENT_YEARS} years`
              : `All ${allYears.length} years`}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => downloadBreakdownCsv(kinds, years, netByYear)}
          className="mr-auto shrink-0 cursor-pointer rounded-lg border border-sky-400 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-sky-200 dark:border-sky-500 dark:bg-sky-900/40 dark:hover:bg-sky-900/60"
        >
          Export CSV
        </button>
      </div>

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
            className="sticky z-30 rounded-lg bg-surface ring-1 ring-black/10 shadow-[0_3px_0_0_var(--color-line),0_12px_16px_-12px_rgba(0,0,0,0.45)] dark:ring-white/15"
            style={{ overflow: "clip", top: titleBarH }}
          >
            <div
              ref={(el) => { if (el) scrollersRef.current.add(el); }}
              onScroll={(e) => syncScrollX(e.currentTarget.scrollLeft)}
              className="scroll-handle overflow-x-auto"
            >
              <div style={{ minWidth: minW }}>
                <div className="grid items-center gap-2 border-b border-line bg-black/[0.05] pr-4 py-2 dark:bg-white/[0.08]" style={gridStyle}>
                  <span className="pl-4 text-[15px] font-bold uppercase tracking-wide text-foreground">
                    Category
                  </span>
                  <TotalBand pad="-my-2" plain><span className="text-center text-[15px] font-bold uppercase tracking-wide text-foreground">Total</span></TotalBand>
                  {years.map((y) => (
                    <span key={y} className={periodHeaderClass(y === CURRENT_YEAR)}>
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
                    total={sumOverYears(k.totalByYear, years)}
                    years={years}
                    gridStyle={gridStyle}
                    currency={currency}
                    selected={selected}
                    onToggleCell={toggleCell}
                  />
                ))}
                {/* Net (unallocated) — Income − Expenses − Savings − Investment */}
                <div className="grid items-center gap-2 border-t border-line pr-4 py-2" style={gridStyle}>
                  <span className="pl-4 text-[15px] font-bold">Net</span>
                  {(() => { const netTotal = years.reduce((sum, y) => sum + (netByYear[y] ?? 0), 0); return (
                    <TotalBand pad="-my-2"><span className={`text-center text-[18px] font-bold tabular-nums ${netTotal < 0 ? "text-negative" : "text-positive"}`}>{formatMoney(netTotal, currency)}</span></TotalBand>
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

/**
 * The panel, flattened for a spreadsheet: one row per figure-bearing line,
 * with Section / Group / Category / Detail naming where it sat in the
 * hierarchy, then Total and one column per year.
 *
 * Values go out as plain numbers, not formatted money — a CSV whose cells
 * can't be summed is a screenshot with extra steps. Headers are plain
 * ("Total", "2026"), with no currency tag.
 */
function downloadBreakdownCsv(
  kinds: BreakdownKind[],
  years: number[],
  netByYear: Record<number, number>,
) {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const money = (cents: number) => (cents / 100).toFixed(2);
  const byYear = (rec: Record<number, number>) => years.map((y) => money(rec[y] ?? 0));

  const rows: string[] = [];
  const push = (section: string, group: string, line: string, detail: string,
                total: number, rec: Record<number, number>) =>
    rows.push([q(section), q(group), q(line), q(detail), money(total), ...byYear(rec)].join(","));

  // Summary block first, in the order the sticky strip shows it.
  const sum = (rec: Record<number, number>) => sumOverYears(rec, years);
  for (const k of kinds) push("Summary", "", k.label, "", sum(k.totalByYear), k.totalByYear);
  const netTotal = years.reduce((sum, y) => sum + (netByYear[y] ?? 0), 0);
  push("Summary", "", "Net", "", netTotal, netByYear);

  for (const k of kinds) {
    for (const g of k.groups) {
      // A kind that is one unnamed group doesn't get a subtotal row of its
      // own on screen either — it would just restate the section.
      if (k.groups.length > 1) {
        push(k.label, g.label, "Subtotal", "", sum(g.subtotalByYear), g.subtotalByYear);
      }
      for (const l of g.lines) {
        push(k.label, k.groups.length > 1 ? g.label : "", l.label, "", sum(l.byYear), l.byYear);
        for (const d of l.details ?? []) {
          push(k.label, k.groups.length > 1 ? g.label : "", l.label, d.label, sum(d.byYear), d.byYear);
        }
      }
    }
  }

  const header = [
    "Section", "Group", "Category", "Detail",
    "Total",
    ...years.map((y) => String(y)),
  ].map(q).join(",");

  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `annual-breakdown-${years[years.length - 1]}-${years[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SummaryRow({
  label, kind, byYear, total, years, gridStyle, currency, selected, onToggleCell,
}: {
  label: string; kind: KindKey; byYear: Record<number, number>; total: number;
  years: number[]; gridStyle: CSSProperties; currency: string;
  selected: Map<string, SelectedYearCell>;
  onToggleCell: (key: string, cell: SelectedYearCell) => void;
}) {
  const totalColor = kind === "income" || kind === "savings" || kind === "investment" ? "text-positive" : kind === "kidsFunding" ? "" : "text-negative";
  return (
    <div className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
      <span className="pl-4 text-[15px] font-semibold">{label}</span>
      <TotalBand pad="-my-1.5"><span className={`text-center text-[18px] font-bold tabular-nums ${totalColor}`}>{formatMoney(total, currency)}</span></TotalBand>
      {/* The summary strip's figures select too — a whole section's year is as
          legitimate a thing to add up as one line item's. */}
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        const key = `summary|${kind}|${y}`;
        return (
          <MoneyCell
            key={y}
            empty={v === 0}
            color={BREAKDOWN_COLOR[kind]}
            active={selected.has(key)}
            onToggle={() => onToggleCell(key, { year: y, kind, amountCents: v })}
          >
            {formatMoney(v, currency)}
          </MoneyCell>
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

  // Biggest first, by the Total column: the question a breakdown answers is
  // "what takes the most", and that shouldn't need a scan of every row.
  // Groups, their line items and a line's split all sort the same way.
  const filteredGroups = [...kind.groups].sort(
    (a, b) => sumOverYears(b.subtotalByYear, years) - sumOverYears(a.subtotalByYear, years),
  );
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
                <span className="pl-4 text-[15px] font-bold uppercase tracking-wide text-foreground">
                  Category
                </span>
                <span className="text-center text-[15px] font-bold uppercase tracking-wide text-foreground">Total</span>
                {years.map((y) => (
                  <span key={y} className={periodHeaderClass(y === CURRENT_YEAR)}>
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
          <TotalBand pad="-my-1.5">
            <span className="text-center text-[18px] font-bold tabular-nums">
              {formatMoney(sumOverYears(group.subtotalByYear, years), currency)}
            </span>
          </TotalBand>
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
        {[...group.lines]
          .sort((a, b) => sumOverYears(b.byYear, years) - sumOverYears(a.byYear, years))
          .map((l) => (
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
        <TotalBand pad="-my-1.5"><span className="text-center text-[18px] tabular-nums">{formatMoney(sumOverYears(line.byYear, years), currency)}</span></TotalBand>
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
      {hasDetails && expanded ? [...line.details!]
        .sort((a, b) => sumOverYears(b.byYear, years) - sumOverYears(a.byYear, years))
        .map((d) => (
        <li key={`${line.label}::${d.label}`} className="grid items-center gap-2 pr-4 py-1 bg-brand-soft/10" style={gridStyle}>
          <span className="truncate pl-12 text-[13px] leading-tight text-muted">
            └ {d.label}
          </span>
          <TotalBand pad="-my-1"><span className="text-center text-[16px] font-medium tabular-nums text-muted">{formatMoney(sumOverYears(d.byYear, years), currency)}</span></TotalBand>
          {/* A split line's own cells select like any other figure — a
              subscription or irregular bill is the level you actually want to
              add up. */}
          {years.map((y) => {
            const v = d.byYear[y] ?? 0;
            const key = `${rowKey}::${d.label}|${y}`;
            return (
              <MoneyCell
                key={y}
                empty={v === 0}
                color={BREAKDOWN_COLOR[kindKey]}
                active={selected.has(key)}
                stopPropagation
                onToggle={() => onToggleCell(key, { year: y, kind: kindKey, amountCents: v })}
              >
                {formatMoney(v, currency)}
              </MoneyCell>
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
      <TotalBand pad="-my-2">
        <span className={`text-center text-[18px] font-bold tabular-nums ${tint(total)}`}>
          {formatMoney(total, currency)}
        </span>
      </TotalBand>
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
