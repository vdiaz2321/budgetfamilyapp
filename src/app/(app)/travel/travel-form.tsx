// Field pieces shared by the Travel Log's flight, stay and car forms.

import type { TravelTrip } from "./types";

/**
 * A date typed outside the trip it is being filed under — nearly always the
 * wrong year. The server refuses it too (tripDateError); this says so sooner.
 */
export function outsideTripNote(trips: TravelTrip[] | undefined, tripId: string, dates: string[]): string | null {
  const trip = trips?.find((t) => t.id === tripId);
  if (!trip || (!trip.startOn && !trip.endOn)) return null;
  const typed = dates.filter(Boolean);
  const outside = typed.some((d) => (trip.startOn && d < trip.startOn) || (trip.endOn && d > trip.endOn));
  if (!outside) return null;
  const short = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "…";
  return `Outside ${trip.name} (${short(trip.startOn)} – ${short(trip.endOn)}) — won't save; check the year`;
}

/**
 * Shown while a booking is still Planned and its points are ticked as used:
 * nothing leaves the card until it is switched to Booked, and that is easy to
 * miss when Planned is the starting state.
 */
export function PlannedPointsNote({ show, what = "points" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <p className="text-[11px] font-medium text-negative">
      Still Planned — no {what} come off the card until this is switched to Booked.
    </p>
  );
}

/**
 * Booked, or still a planned price. A planned booking counts in the trip as
 * planned and takes nothing from a card until it is switched to booked.
 */
export function PlannedSwitch({
  value,
  onChange,
  bookedLabel = "Booked",
  plannedLabel = "Planned",
}: {
  value: boolean;
  onChange: (planned: boolean) => void;
  bookedLabel?: string;
  plannedLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Booking status" className="inline-flex h-7 items-stretch rounded-lg bg-background p-0.5 ring-1 ring-line">
      {[
        { planned: true, label: plannedLabel },
        { planned: false, label: bookedLabel },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.planned}
          onClick={() => onChange(o.planned)}
          className={`rounded-md px-3 text-xs font-semibold transition ${
            value === o.planned ? "bg-sky-600 text-white" : "text-muted hover:bg-sky-100 hover:text-foreground dark:hover:bg-sky-900/40"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500";

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
        {/* An opened currency converter takes the whole line under the title. */}
        {action ? <div className="has-[.rounded-xl]:basis-full">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
