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
}: {
  trips: TravelTrip[];
  value: TripChoice;
  onChange: (next: TripChoice) => void;
  hiddenInputs?: boolean;
  className?: string;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${className ?? ""}`}>
      <Field label="Trip">
        <select
          value={creating ? NEW : value.tripId}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setCreating(true);
              onChange({ tripId: "", newTripName: value.newTripName });
            } else {
              setCreating(false);
              onChange({ tripId: e.target.value, newTripName: "" });
            }
          }}
          className={inputClass}
        >
          <option value="">No trip</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
          <option value={NEW}>+ New trip…</option>
        </select>
      </Field>
      {creating ? (
        <Field label="New trip name">
          <input
            value={value.newTripName}
            onChange={(e) => onChange({ tripId: "", newTripName: e.target.value })}
            // Enter would submit the whole booking form mid-name.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            autoFocus
            className={inputClass}
          />
        </Field>
      ) : null}
      {hiddenInputs ? (
        <>
          <input type="hidden" name="tripId" value={creating ? "" : value.tripId} />
          <input type="hidden" name="newTripName" value={creating ? value.newTripName : ""} />
        </>
      ) : null}
    </div>
  );
}
