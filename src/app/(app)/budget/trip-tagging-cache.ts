"use client";

import { useEffect, useSyncExternalStore } from "react";
import { listTripTagging } from "./actions";
import type { TripTagging } from "./types";

// The transaction modal's trips and bookings, kept for the whole session.
// Pages that can open the modal load it as soon as they mount, so the Trip,
// "Pays for" and column pickers are ready the moment the modal opens instead
// of appearing a second later. Each page visit and each save refreshes it.

const EMPTY: TripTagging = { trips: [], bookingsByTrip: {} };
let latest: TripTagging | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function refreshTripTagging(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = listTripTagging()
    .then((next) => {
      latest = next;
      listeners.forEach((l) => l());
    })
    // A failed refresh keeps what was loaded before; the pickers just stay
    // as they were (or hidden, if nothing ever loaded).
    .catch((err) => console.error("[listTripTagging]", err))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Load (or refresh) the trips when a page that can add transactions opens. */
export function usePrefetchTripTagging() {
  useEffect(() => {
    void refreshTripTagging();
  }, []);
}

/** The trips and bookings, updating when a refresh lands. */
export function useTripTagging(): TripTagging {
  const data = useSyncExternalStore(subscribe, () => latest ?? EMPTY, () => EMPTY);
  // Opened from a page that didn't prefetch: load now.
  useEffect(() => {
    if (!latest) void refreshTripTagging();
  }, []);
  return data;
}
