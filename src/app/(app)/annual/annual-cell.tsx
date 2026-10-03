"use client";

/** Column header for a month or year. The current one is set bold and dark
 *  so "now" is easy to find across every table on the page. */
export function periodHeaderClass(current: boolean) {
  return `text-center text-[15px] uppercase tracking-wide ${
    current ? "font-bold text-foreground" : "font-semibold text-muted"
  }`;
}

/** A month/year column header. The month still under way gets a "(so far)"
 *  line under it: its figures are partial (pay lands near month end), so they
 *  shouldn't be read against the finished months beside it. Two lines rather
 *  than "OCT (SO FAR)" inline, which would overflow the 7rem month column. */
export function PeriodHeader({ label, current }: { label: string; current: boolean }) {
  return (
    <span className={`flex flex-col items-center ${periodHeaderClass(current)}`}>
      {label}
      {current ? (
        <span className="text-[11px] font-medium normal-case tracking-normal text-muted">(so far)</span>
      ) : null}
    </span>
  );
}

/**
 * One money cell in an Annual table. Clicking it adds the figure to the hero
 * card filter; a cell with nothing in it has nothing to add, so it stays an
 * inert em dash. Selection reads as the column's own color rather than a
 * generic highlight, so a filtered set is legible as "these three are
 * savings" without reading the card.
 */
export function MoneyCell({
  children,
  empty,
  color,
  className,
  active,
  onToggle,
  stopPropagation,
}: {
  children: React.ReactNode;
  empty: boolean;
  color: string;
  className?: string;
  active: boolean;
  onToggle: () => void;
  /** For cells inside a row that is itself clickable (Annual Breakdown's
   *  expandable line items): picking a figure shouldn't also open the row. */
  stopPropagation?: boolean;
}) {
  if (empty) {
    return <span className="text-center text-[18px] tabular-nums text-muted">—</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onToggle();
      }}
      aria-pressed={active}
      className={`mx-auto w-full rounded-md px-1 py-0.5 text-center text-[18px] tabular-nums tracking-[-0.01em] transition hover:bg-black/[0.06] dark:hover:bg-white/[0.10] ${
        // One weight class only: two competing ones resolve by stylesheet
        // order, not by which is listed last. Medium by default (regular reads
        // thin at 18px); a caller's own weight, e.g. the bold Remaining row, wins.
        active ? "font-semibold" : className?.includes("font-") ? "" : "font-medium"
      } ${className ?? ""}`}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${color}`, color } : undefined}
    >
      {children}
    </button>
  );
}
