import type { CSSProperties, ReactElement } from "react";
import type { CategoryKind } from "@/lib/categories";

// Tailwind's scanner needs literal class strings, not runtime
// `bg-${accent}` interpolation — so the icon-tint classes per kind are
// spelled out in full here rather than built from ACCENT at render time.
export const ROW_CLASSES: Record<CategoryKind, { iconBg: string; iconText: string }> = {
  income: { iconBg: "bg-positive/12", iconText: "text-positive" },
  savings: { iconBg: "bg-chart-1/12", iconText: "text-chart-1" },
  bills: { iconBg: "bg-warning/12", iconText: "text-warning" },
  expenses: { iconBg: "bg-negative/12", iconText: "text-negative" },
  debt: { iconBg: "bg-negative/12", iconText: "text-negative" },
};

// Solid category dot — matches the group-header dot color used on the
// Budget page and the register page, so a category reads as the same color
// everywhere. (Deliberately not the same palette as ROW_CLASSES above: those
// tints are semantic — good/warning/danger — while this is the category's
// own identity color.)
//
// Drawn from the --viz-* palette, NOT --brand/--accent: a category dot is
// data, and the Budget hero card's progress bars use these same tokens, so
// Bills reads teal and Savings blue in both places instead of clashing.
export const DOT: Record<CategoryKind, string> = {
  income: "bg-[color:var(--positive)]",
  savings: "bg-[color:var(--viz-savings)]",
  bills: "bg-[color:var(--viz-bills)]",
  expenses: "bg-[color:var(--viz-expenses)]",
  debt: "bg-[color:var(--viz-debt)]",
};

// Budget group cards (and the Subscriptions / Irregular Bills cards) each
// carry their kind colour as --acc: it drives the 3px left edge, the header
// wash, the count chip, the + button and the tile hovers.
export const ACC: Record<CategoryKind, string> = {
  income: "var(--positive)",
  savings: "var(--viz-savings)",
  bills: "var(--viz-bills)",
  expenses: "var(--viz-expenses)",
  debt: "var(--viz-debt)",
};
// Header wash: a flat accent tint faded left→right (the rows are wide and
// short), a little deeper while the card is open.
export const headerWash = (open: boolean): CSSProperties => ({
  backgroundColor: `color-mix(in srgb, var(--acc) ${open ? 16 : 10}%, var(--surface))`,
  maskImage: "linear-gradient(90deg, #000 0%, transparent 60%)",
  WebkitMaskImage: "linear-gradient(90deg, #000 0%, transparent 60%)",
});
export const DOT_HALO: CSSProperties = { boxShadow: "0 0 0 3px color-mix(in srgb, var(--acc) 22%, transparent)" };
export const SECTION_CLS =
  "@container relative isolate -mx-4 overflow-hidden bg-surface shadow-sm ring-1 ring-[color-mix(in_srgb,var(--acc)_22%,var(--border))] sm:mx-0 sm:rounded-xl";
export const ACC_CHIP =
  "shrink-0 whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--acc)_14%,var(--surface))] px-1.5 py-0.5 text-[10px] font-semibold text-foreground ring-1 ring-[color-mix(in_srgb,var(--acc)_30%,var(--border))]";
export const ACC_HOVER = "hover:bg-[color-mix(in_srgb,var(--acc)_14%,var(--surface))]";
// 3px left edge in the card's colour, running down the header and open rows.
export function AccentEdge() {
  return <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-[3px] bg-[color:var(--acc)]" />;
}

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function IncomeIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function SavingsIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 6h6v6" />
    </svg>
  );
}

function BillsIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function ExpensesIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </svg>
  );
}

function DebtIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_PROPS} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

const CATEGORY_ICON: Record<CategoryKind, (props: { className?: string }) => ReactElement> = {
  income: IncomeIcon,
  savings: SavingsIcon,
  bills: BillsIcon,
  expenses: ExpensesIcon,
  debt: DebtIcon,
};

export function CategoryIcon({ kind, className }: { kind: CategoryKind; className?: string }) {
  const Icon = CATEGORY_ICON[kind];
  return <Icon className={className} />;
}

// Tiny trend line for a row's last-N-months actuals. Renders nothing below 2
// points — a single dot or empty history isn't a trend worth drawing.
export function Sparkline({ values, accent }: { values: number[]; accent: string }) {
  if (values.length < 2) return null;

  const width = 60;
  const height = 24;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={path} stroke={`var(--${accent})`} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2} fill={`var(--${accent})`} />
    </svg>
  );
}
