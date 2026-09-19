"use client";

import { useEffect, useRef, useState } from "react";
import { SearchBox } from "./search-box";
import type { TravelTrip } from "./types";

/**
 * The page's way into a saved trip: pick one and its own popup opens, with
 * every booking and spending line ready to edit or add to. Sits beside "Add
 * Travel Log", which is for new trips only.
 */
export function EditTripPicker({ trips, onPick }: { trips: TravelTrip[]; onPick: (tripId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // This year's and upcoming trips first (newest first), then older ones —
  // a search looks through all of them.
  const thisYear = String(new Date().getFullYear());
  const byNewest = (a: TravelTrip, b: TravelTrip) => (b.startOn ?? "9999").localeCompare(a.startOn ?? "9999");
  const q = query.trim().toLowerCase();
  const matches = trips.filter((t) => !q || t.name.toLowerCase().includes(q));
  const current = matches.filter((t) => !t.startOn || t.startOn.slice(0, 4) >= thisYear).sort(byNewest);
  const past = matches.filter((t) => t.startOn && t.startOn.slice(0, 4) < thisYear).sort(byNewest);

  const row = (t: TravelTrip) => (
    <li key={t.id}>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setQuery("");
          onPick(t.id);
        }}
        className="w-full px-3 py-2 text-left text-sm transition hover:bg-sky-100 dark:hover:bg-sky-900/40"
      >
        {t.name}
      </button>
    </li>
  );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-black/25 bg-background px-4 py-2 text-base font-bold transition hover:border-sky-400 hover:bg-sky-100 sm:text-lg dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
      >
        Edit trip
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>
      {open ? (
        // Right-aligned on a phone, where the button sits near the right edge;
        // left-aligned under it on wider screens.
        <div className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-surface p-2 shadow-lg ring-1 ring-line sm:left-0 sm:right-auto">
          <SearchBox value={query} onChange={setQuery} placeholder="Search trips" label="Search trips" className="w-full" />
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {current.map(row)}
            {past.length > 0 ? (
              <>
                <li className="mt-1 border-t border-line/60 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Earlier trips
                </li>
                {past.map(row)}
              </>
            ) : null}
            {matches.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No trips match.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
