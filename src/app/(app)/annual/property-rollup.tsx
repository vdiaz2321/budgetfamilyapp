"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";

/** One Budget line's share of a property's year. */
export type PropertyLine = {
  subId: string;
  name: string;
  kind: CategoryKind;
  months: number[]; // 12 entries, cents
  total: number;
};

export type PropertyRollup = {
  id: string;
  name: string;
  subtype: string | null;
  lines: PropertyLine[];
  incomeMonths: number[];
  costMonths: number[];
  netMonths: number[];
  incomeTotal: number;
  costTotal: number;
  netTotal: number;
};

type Props = {
  properties: PropertyRollup[];
  monthLabels: string[]; // 12 short labels (Jan…Dec)
  currency: string;
};

// Label + Total + one column per month shown. Wider label track than the
// half-width panels above: this one runs the full page, and Budget line names
// ("Homeowners insurance") are what sits in it.
function gridStyle(monthCount: number) {
  return {
    gridTemplateColumns: `12rem minmax(7rem,1fr) repeat(${monthCount},minmax(6.25rem,1fr))`,
  };
}
function trackMinWidth(monthCount: number) {
  return { minWidth: `${12 + 7 + 6.25 * monthCount}rem` };
}

/**
 * Each property's year as one P&L. Rent lands in Income and repairs land in
 * Expenses, so nothing else on this page shows them against each other — this
 * panel is the join, keyed on the property tag carried by each transaction.
 */
export function PropertyRollupPanel({ properties, monthLabels, currency }: Props) {
  const [collapse, setCollapse] = useSessionCollapse("annual-properties", () => ({ open: true }));
  const open = collapse.open;

  // Stop at the last month anything was tagged, across every property, rather
  // than running out to December with empty columns.
  const lastActive = properties.reduce(
    (last, p) =>
      Math.max(
        last,
        p.incomeMonths.reduce((acc, v, i) => (v !== 0 ? i : acc), -1),
        p.costMonths.reduce((acc, v, i) => (v !== 0 ? i : acc), -1),
      ),
    -1,
  );
  const monthCount = lastActive >= 0 ? lastActive + 1 : monthLabels.length;

  return (
    <section className="overflow-clip rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
      >
        <Chevron open={open} />
        <span className="font-semibold">Properties</span>
        <span className="ml-auto text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
          Income vs costs
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line p-3">
          {properties.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              monthLabels={monthLabels.slice(0, monthCount)}
              monthCount={monthCount}
              currency={currency}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PropertyCard({
  property,
  monthLabels,
  monthCount,
  currency,
}: {
  property: PropertyRollup;
  monthLabels: string[];
  monthCount: number;
  currency: string;
}) {
  const [collapse, setCollapse] = useSessionCollapse(
    `annual-property-${property.id}`,
    () => ({ open: true }),
  );
  const open = collapse.open;
  const empty = property.lines.length === 0;
  const incomeLines = property.lines.filter((l) => l.kind === "income");
  const costLines = property.lines.filter((l) => l.kind !== "income");

  return (
    <div className="overflow-clip rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 bg-black/[0.03] px-3 py-2 text-left transition hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
      >
        <Chevron open={open} small />
        <span
          className="size-2 shrink-0 rounded-full bg-[color:var(--viz-bills)]"
          aria-hidden
        />
        <span className="text-[15px] 2xl:text-[21px] font-bold">{property.name}</span>
        {property.subtype ? (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[12px] 2xl:text-[16px] font-semibold uppercase tracking-wide text-muted dark:bg-white/10">
            {property.subtype}
          </span>
        ) : null}
        {/* Wraps to its own line on a phone rather than squeezing the name. */}
        <span className="ml-auto flex items-center gap-3 tabular-nums">
          <Figure label="In" value={property.incomeTotal} color="var(--positive)" currency={currency} />
          <Figure label="Out" value={property.costTotal} color="var(--negative)" currency={currency} />
          <Figure
            label="Net"
            value={property.netTotal}
            color={property.netTotal >= 0 ? "var(--positive)" : "var(--negative)"}
            currency={currency}
            strong
          />
        </span>
      </button>

      {open ? (
        empty ? (
          <p className="border-t border-line px-3 py-3 text-sm 2xl:text-lg text-muted">
            Nothing tagged to this property yet. Set{" "}
            <span className="font-medium text-foreground">Property</span> on a transaction — in the
            Log or on the Transactions page — and its rent and costs collect here.
          </p>
        ) : (
          <div className="scroll-handle overflow-x-auto border-t border-line">
            <div style={trackMinWidth(monthCount)}>
              <div
                className="grid items-center gap-2 border-b border-line py-2 pr-3"
                style={gridStyle(monthCount)}
              >
                <span className="sticky left-0 z-10 bg-surface pl-3 text-[12px] 2xl:text-[16px] font-medium uppercase tracking-wide text-muted">
                  Line
                </span>
                <span className="text-center text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide text-foreground">
                  Total
                </span>
                {monthLabels.map((m) => (
                  <span
                    key={m}
                    className="text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>

              <div className="divide-y divide-line">
                <SummaryRow
                  label="Income"
                  total={property.incomeTotal}
                  months={property.incomeMonths}
                  monthCount={monthCount}
                  color="var(--positive)"
                  currency={currency}
                />
                {incomeLines.map((l) => (
                  <LineRow key={l.subId} line={l} monthCount={monthCount} currency={currency} />
                ))}
                <SummaryRow
                  label="Costs"
                  total={property.costTotal}
                  months={property.costMonths}
                  monthCount={monthCount}
                  color="var(--negative)"
                  currency={currency}
                />
                {costLines.map((l) => (
                  <LineRow key={l.subId} line={l} monthCount={monthCount} currency={currency} />
                ))}
              </div>

              {/* `bg-background`, not a translucent tint: the label cell is
                  sticky and has to stay opaque as the months scroll under it,
                  so the band and that cell must be the same solid colour. */}
              <div
                className="grid items-center gap-2 border-t border-line bg-background py-2.5 pr-3"
                style={gridStyle(monthCount)}
              >
                <span className="sticky left-0 z-10 bg-background pl-3 text-[15px] 2xl:text-[21px] font-bold">Net</span>
                <span
                  className="text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums"
                  style={{ color: property.netTotal >= 0 ? "var(--positive)" : "var(--negative)" }}
                >
                  {formatMoney(property.netTotal, currency)}
                </span>
                {property.netMonths.slice(0, monthCount).map((v, i) => (
                  <span
                    key={i}
                    className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums"
                    style={v === 0 ? undefined : { color: v > 0 ? "var(--positive)" : "var(--negative)" }}
                  >
                    {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  total,
  months,
  monthCount,
  color,
  currency,
}: {
  label: string;
  total: number;
  months: number[];
  monthCount: number;
  color: string;
  currency: string;
}) {
  return (
    <div className="grid items-center gap-2 py-2 pr-3" style={gridStyle(monthCount)}>
      <span
        className="sticky left-0 z-10 bg-surface pl-3 text-[13px] 2xl:text-[18px] font-bold uppercase tracking-wide"
        style={{ color }}
      >
        {label}
      </span>
      <span className="text-center text-[13px] 2xl:text-[18px] font-bold tabular-nums" style={{ color }}>
        {total !== 0 ? formatMoney(total, currency) : <span className="text-muted">—</span>}
      </span>
      {months.slice(0, monthCount).map((v, i) => (
        <span key={i} className="text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums">
          {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
        </span>
      ))}
    </div>
  );
}

function LineRow({
  line,
  monthCount,
  currency,
}: {
  line: PropertyLine;
  monthCount: number;
  currency: string;
}) {
  return (
    <div className="grid items-center gap-2 py-1.5 pr-3" style={gridStyle(monthCount)}>
      <span className="sticky left-0 z-10 truncate bg-surface pl-6 text-[13px] 2xl:text-[18px] text-muted">
        {line.name}
      </span>
      <span className="text-center text-[13px] 2xl:text-[18px] font-medium tabular-nums">
        {line.total !== 0 ? formatMoney(line.total, currency) : <span className="text-muted">—</span>}
      </span>
      {line.months.slice(0, monthCount).map((v, i) => (
        <span key={i} className="text-center text-[13px] 2xl:text-[18px] tabular-nums text-muted">
          {v !== 0 ? formatMoney(v, currency) : "—"}
        </span>
      ))}
    </div>
  );
}

function Figure({
  label,
  value,
  color,
  currency,
  strong,
}: {
  label: string;
  value: number;
  color: string;
  currency: string;
  strong?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[12px] 2xl:text-[16px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className={`text-[13px] 2xl:text-[18px] ${strong ? "font-bold" : "font-semibold"}`} style={{ color }}>
        {formatMoney(value, currency)}
      </span>
    </span>
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
