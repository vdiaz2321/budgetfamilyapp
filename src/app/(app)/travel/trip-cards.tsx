"use client";

import type React from "react";
import { formatMoneyWhole } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { sheetDateRange, type TripSummary } from "./trip-summary";
import { HEAD_FIGURE_COLS, HEAD_TITLE_COL } from "./travel-board";

// Whole days between two plain ISO dates.
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The mockup's forest teal + aqua (Victor, 2026-10-04), with lifted
// versions for dark mode. Full class strings so Tailwind generates them.
const TEAL_TEXT = "text-[#165451] dark:text-[#5fb3ad]";
const AQUA_FILL = "bg-[#adefed] dark:bg-[#4fb8b4]";

const CHIP_ICONS: Record<"flight" | "hotel" | "car", React.ReactNode> = {
  flight: <path d="M2 12l19-7-5 7 5 7-19-7z" />,
  hotel: <path d="M3 18v-8h18v8M3 14h18M7 10V7h10v3" />,
  car: <path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 16v2M17 16v2M5 11h14" />,
};

/** "in 4 days" — aqua once the trip is a week or less away. */
function DaysPill({ days, className }: { days: number; className: string }) {
  const soon = days <= 7;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
        soon ? `${AQUA_FILL} text-[#0e4140] dark:text-[#0e1f1e]` : "bg-black/5 text-muted dark:bg-white/10"
      } ${className}`}
    >
      {days > 0 ? `in ${plural(days, "day")}` : "Now"}
    </span>
  );
}

/** A booking count; dashed and red when that kind isn't booked yet. */
function Chip({ icon, missing, children }: { icon: keyof typeof CHIP_ICONS; missing?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        missing ? "border border-dashed border-line text-negative" :"bg-black/5 text-foreground dark:bg-white/10"
      }`}
    >
      <svg viewBox="0 0 24 24" className={`h-3 w-3 ${missing ? "" : TEAL_TEXT}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {CHIP_ICONS[icon]}
      </svg>
      {children}
    </span>
  );
}

/**
 * The trips still ahead (or under way), soonest first — the first thing on
 * the page, because "what's next" is what the page is opened for. Each card
 * opens the trip's own popup; the full table of every trip sits below.
 */
export function TripCards({
  summaries,
  today,
  currency,
  onOpenTrip,
}: {
  summaries: TripSummary[];
  today: string;
  currency: string;
  onOpenTrip: (tripId: string) => void;
}) {
  const ahead = summaries
    .filter((t) => t.start && (t.end ?? t.start) >= today)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  // Folds to its header, remembered for the session like the page's other
  // sections; opens on a fresh login.
  const [state, setState] = useSessionCollapse("travel-upcoming-trips", () => ({ open: true }));
  const open = state.open !== false;
  const nameCounts = new Map<string, number>();
  for (const t of ahead) {
    const n = t.trip.name.split(" · ")[0];
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  const next = ahead[0];
  const nextDays = next?.start ? daysBetween(today, next.start) : 0;
  const sumOf = (read: (t: TripSummary) => number) => ahead.reduce((n, t) => n + read(t), 0);
  const upcomingPts = sumOf((t) => t.points);
  const upcomingSaved = sumOf((t) => t.saved);
  const upcomingFigures = [
    { label: "Total trips", value: String(ahead.length), tone: "" },
    { label: "Total spent", value: formatMoneyWhole(sumOf((t) => t.spent), currency), tone: "text-negative" },
    { label: "Total planned", value: formatMoneyWhole(sumOf((t) => t.planOnly.total), currency), tone: "text-muted" },
    // Points actually redeemed and the cash they replaced — shown even at 0.
    { label: "Total pts used", value: upcomingPts.toLocaleString(), tone: "" },
    { label: "Total cash saved", value: formatMoneyWhole(upcomingSaved, currency), tone: upcomingSaved > 0 ? "text-positive" : "" },
  ];

  return (
    <section className="rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setState({ open: !open })}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
      >
        {/* Same title and figure columns as All Trips / Bookings Log below. */}
        <span className={`flex items-center gap-2 ${HEAD_TITLE_COL}`}>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-[13px] w-[13px] shrink-0 self-center text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
          <h2 className="text-sm font-bold sm:text-base">Upcoming trips</h2>
        </span>
        {/* The money for every trip still ahead, open or folded, in the
            same label + figure style as the other section headers. */}
        {ahead.length > 0 ? (
          <>
            {upcomingFigures.map((f, i) => (
              <span key={f.label} className={`flex shrink-0 items-baseline gap-1.5 ${HEAD_FIGURE_COLS[i] ?? ""}`}>
                <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">{f.label}:</span>
                <span className={`text-sm font-semibold tabular-nums ${f.tone}`}>{f.value}</span>
              </span>
            ))}
            {/* Folded, the header still says what's next — on wide screens
                only, where it fits on the same line as the totals. */}
            {!open && next ? (
              <span className="hidden min-w-0 items-baseline gap-1.5 2xl:flex">
                <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">Next:</span>
                <span className="text-sm font-semibold">
                  {next.trip.name.split(" · ")[0]}{" "}
                  <span className="font-medium text-muted">{nextDays > 0 ? `in ${plural(nextDays, "day")}` : "now"}</span>
                </span>
              </span>
            ) : null}
          </>
        ) : null}
      </button>
      {!open ? null : ahead.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted sm:px-6">Nothing booked ahead. Add Trip starts a new one.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 sm:px-6">
          {ahead.map((t) => {
            const start = t.start as string;
            const days = daysBetween(today, start);
            const name = t.trip.name.split(" · ")[0];
            // Two upcoming trips to the same place get their month beside
            // the name, so "Greece" and "Greece" can be told apart.
            const sub = nameCounts.get(name)! > 1 ? MONTHS[Number(start.slice(5, 7)) - 1] : null;
            // "Planned" is money not paid yet, so the bar is the share of the
            // trip's whole cost already paid.
            const planned = t.planOnly.total;
            const whole = t.spent + planned;
            const paidPct = whole > 0 ? Math.round((t.spent / whole) * 100) : 0;
            const fullyPaid = t.spent > 0 && planned <= 0;
            const booked = t.counts.flight + t.counts.stay + t.counts.car > 0;
            return (
              <li key={t.trip.id}>
                <button
                  type="button"
                  onClick={() => onOpenTrip(t.trip.id)}
                  className="flex h-full w-full flex-col gap-3 rounded-xl bg-background p-4 text-left ring-1 ring-line transition duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 sm:p-5"
                >
                  <span className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-base font-semibold">{name}</span>
                        {sub ? <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${TEAL_TEXT}`}>· {sub}</span> : null}
                      </span>
                      {/* One line from sm up; under the dates on a phone. */}
                      <span className="block text-xs tabular-nums text-muted">
                        <span className="block sm:inline">{sheetDateRange(start, t.end)}</span>
                        {t.nights ? <span className="block sm:inline"><span className="hidden sm:inline"> · </span>{plural(t.nights, "night")}</span> : null}
                      </span>
                    </span>
                    <DaysPill days={days} className="hidden sm:inline-block" />
                  </span>

                  {/* On a phone the days pill moves down here, so the dates
                      get the full width. */}
                  {booked ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {t.counts.flight ? <Chip icon="flight">{plural(t.counts.flight, "flight")}</Chip> : null}
                      {t.counts.stay ? <Chip icon="hotel">{plural(t.counts.stay, "hotel")}</Chip> : null}
                      {t.counts.car ? <Chip icon="car">{plural(t.counts.car, "rental")}</Chip> : null}
                      {!t.counts.flight ? <Chip icon="flight" missing>No flight</Chip> : null}
                      {!t.counts.stay ? <Chip icon="hotel" missing>No hotel</Chip> : null}
                      <DaysPill days={days} className="ml-auto sm:hidden" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="flex-1 rounded-lg border border-dashed border-line py-1.5 text-center text-xs font-medium text-muted">
                        Nothing booked yet
                      </span>
                      <DaysPill days={days} className="sm:hidden" />
                    </span>
                  )}

                  <span className="mt-auto block">
                    <span
                      className="block h-3 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
                      style={t.spent === 0 ? { backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 5px, rgb(0 0 0 / 0.05) 5px 10px)" } : undefined}
                    >
                      {/* Green once everything is paid. */}
                      <span
                        className={`block h-full rounded-full transition-[width] duration-700 ${fullyPaid ? "" : AQUA_FILL}`}
                        style={{ width: `${paidPct}%`, ...(fullyPaid ? { backgroundColor: "var(--positive)" } : {}) }}
                      />
                    </span>
                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Spent</span>
                        <span className="text-sm font-semibold tabular-nums">{formatMoneyWhole(t.spent, currency)}</span>
                      </span>
                      <span
                        className={`hidden whitespace-nowrap text-sm font-semibold tabular-nums min-[400px]:inline ${fullyPaid ? "" : TEAL_TEXT}`}
                        style={fullyPaid ? { color: "var(--positive)" } : undefined}
                      >{t.spent > 0 && whole > 0 ? `${paidPct}% paid` : ""}</span>
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Planned</span>
                        <span className="text-sm font-semibold tabular-nums">{formatMoneyWhole(planned, currency)}</span>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
