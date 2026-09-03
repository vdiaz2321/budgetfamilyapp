"use client";

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
}: {
  children: React.ReactNode;
  empty: boolean;
  color: string;
  className?: string;
  active: boolean;
  onToggle: () => void;
}) {
  if (empty) {
    return <span className="text-center text-[18px] tabular-nums text-muted">—</span>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`mx-auto w-full rounded-md px-1 py-0.5 text-center text-[18px] tabular-nums transition hover:bg-black/[0.06] dark:hover:bg-white/[0.10] ${
        active ? "font-semibold" : ""
      } ${className ?? ""}`}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${color}`, color } : undefined}
    >
      {children}
    </button>
  );
}
