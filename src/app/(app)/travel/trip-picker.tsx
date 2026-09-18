"use client";

import { useState } from "react";
import { Field, inputClass } from "./travel-form";
import type { TravelTrip } from "./types";

const NEW = "__new__";

export type TripChoice = { tripId: string; newTripName: string };

export function useTripChoice(tripId: string | null | undefined): [TripChoice, (next: TripChoice) => void] {
  const [choice, setChoice] = useState<TripChoice>({ tripId: tripId ?? "", newTripName: "" });
  return [choice, setChoice];
}

/**
 * Which trip a booking belongs to: none, an existing trip, or a new one typed
 * in place — so the first booking of a trip never means leaving the form.
 * `hiddenInputs` posts the choice with a FormData form (the stay form).
 */
export function TripPicker({
  trips,
  value,
  onChange,
  hiddenInputs,
  className,
  startNew,
  inHeader,
}: {
  trips: TravelTrip[];
  value: TripChoice;
  onChange: (next: TripChoice) => void;
  hiddenInputs?: boolean;
  className?: string;
  // Opened from the page's Add button (not from a trip): start on "New trip"
  // so the name box is ready; an existing trip is still one pick away.
  startNew?: boolean;
  // Editing a booking: the trip is a setting of the booking, not a field to
  // fill in, so it sits beside the modal's title — no "Add to trip" label.
  // The header is outside the form, so the form posts the choice itself.
  inHeader?: boolean;
}) {
  const [creating, setCreating] = useState(!!startNew);
  // No "No trip" choice for new bookings — everything belongs to a trip. It
  // only shows on an old booking that was saved without one, so the box
  // doesn't claim a trip it isn't in.
  const [savedWithoutTrip] = useState(!startNew && !value.tripId);
  // Newest trip first, and only this year's and upcoming ones — older trips
  // are history, not somewhere a new booking goes. The trip already chosen
  // (editing an old booking) always stays in the list.
  const thisYear = String(new Date().getFullYear());
  const shown = trips
    .filter((t) => !t.startOn || t.startOn.slice(0, 4) >= thisYear || t.id === value.tripId)
    .sort((a, b) => (b.startOn ?? "9999").localeCompare(a.startOn ?? "9999"));

  const pick = (next: string) => {
    if (next === NEW) {
      setCreating(true);
      onChange({ tripId: "", newTripName: value.newTripName });
    } else {
      setCreating(false);
      onChange({ tripId: next, newTripName: "" });
    }
  };
  const options = (
    <>
      <option value={NEW}>+ Start a new trip…</option>
      {savedWithoutTrip ? <option value="">No trip</option> : null}
      {shown.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </>
  );
  const nameInput = (className: string) => (
    <input
      value={value.newTripName}
      onChange={(e) => onChange({ tripId: "", newTripName: e.target.value })}
      // Enter would submit the whole booking form mid-name.
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      autoFocus
      placeholder="Greece - May 2027"
      className={className}
    />
  );

  if (inHeader) {
    return (
      <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className ?? ""}`}>
        <select
          aria-label="Trip"
          value={creating ? NEW : value.tripId}
          onChange={(e) => pick(e.target.value)}
          className="min-w-0 max-w-full rounded-md bg-background px-2 py-1 text-sm font-medium ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {options}
        </select>
        {creating
          ? nameInput("min-w-0 w-48 rounded-md bg-background px-2 py-1 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500")
          : null}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${className ?? ""}`}>
      {/* The name comes first: a new trip is the usual case, and the
          dropdown on the right is only for adding to one already saved. */}
      {creating ? <Field label="New trip name">{nameInput(inputClass)}</Field> : null}
      <Field label="Add to trip" className="sm:col-start-2">
        <select value={creating ? NEW : value.tripId} onChange={(e) => pick(e.target.value)} className={inputClass}>
          {options}
        </select>
      </Field>
      {hiddenInputs ? (
        <>
          <input type="hidden" name="tripId" value={creating ? "" : value.tripId} />
          <input type="hidden" name="newTripName" value={creating ? value.newTripName : ""} />
        </>
      ) : null}
    </div>
  );
}
