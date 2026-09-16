"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CarModal } from "./car-modal";
import type { SectionHandle } from "./embedded-section";
import { FlightModal } from "./flight-modal";
import { MiscModal } from "./misc-modal";
import { StayModal } from "./stay-modal";
import { TripPicker, useTripChoice } from "./trip-picker";
import type { TravelBrand, TravelCard, TravelTrip, Traveller, TripExpense } from "./types";

type Kind = "stay" | "misc" | "flight" | "car";

const SECTIONS: { kind: Kind; label: string }[] = [
  { kind: "stay", label: "Stay" },
  { kind: "misc", label: "Misc" },
  { kind: "flight", label: "Flight" },
  { kind: "car", label: "Rental" },
];

/**
 * Everything a trip needs, added from one scrolling popup: one Trip picker for
 * all of it, then Stay, Misc, Flight and Rental as sections that open in place.
 * One button saves every open section that has something typed in it.
 */
export function AddTravelLogModal({
  trips,
  cards,
  brands,
  travellers,
  expenses,
  currency,
  defaultTripId,
  onClose,
}: {
  trips: TravelTrip[];
  cards: TravelCard[];
  brands: TravelBrand[];
  travellers: Traveller[];
  expenses: TripExpense[];
  currency: string;
  /** Opened from a trip's own row: every section goes into that trip. */
  defaultTripId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [trip, setTrip] = useTripChoice(defaultTripId);
  // Stay starts open — it's the usual first booking; the rest open on a tap.
  const [open, setOpen] = useState<Record<Kind, boolean>>({ stay: true, misc: false, flight: false, car: false });
  // Sections already saved by an earlier press, when another one failed. They
  // are not saved twice on the retry.
  const [saved, setSaved] = useState<Kind[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const handles = {
    stay: useRef<SectionHandle | null>(null),
    misc: useRef<SectionHandle | null>(null),
    flight: useRef<SectionHandle | null>(null),
    car: useRef<SectionHandle | null>(null),
  };

  function save() {
    start(async () => {
      setErrors({});
      setNotice(null);
      const toSave = SECTIONS.map((s) => s.kind).filter(
        (k) => open[k] && !saved.includes(k) && handles[k].current && !handles[k].current.isEmpty(),
      );
      if (toSave.length === 0) {
        setNotice("Nothing to add yet — fill in at least one section.");
        return;
      }
      // One at a time, in order: a new trip is created by the first section
      // and the rest find it by its name.
      const done: Kind[] = [];
      const failed: Partial<Record<Kind, string>> = {};
      for (const k of toSave) {
        const result = await handles[k].current!.save();
        if (result.error) failed[k] = result.error;
        else done.push(k);
      }
      router.refresh();
      if (Object.keys(failed).length === 0) {
        onClose();
        return;
      }
      setSaved((s) => [...s, ...done]);
      setErrors(failed);
    });
  }

  const label = (k: Kind) => SECTIONS.find((s) => s.kind === k)!.label;

  return (
    <ModalShell title="Add Travel Log" onClose={onClose} className="sm:max-w-4xl">
      <div className="px-5 pt-4">
        <TripPicker trips={trips} value={trip} onChange={setTrip} startNew={!defaultTripId} />
      </div>

      {SECTIONS.map(({ kind, label: name }) => {
        const isSaved = saved.includes(kind);
        const isOpen = open[kind] && !isSaved;
        const embed = {
          trip,
          register: (handle: SectionHandle) => {
            handles[kind].current = handle;
          },
        };
        return (
          <section key={kind} className="mt-4 border-y border-line">
            <button
              type="button"
              onClick={() => !isSaved && setOpen((o) => ({ ...o, [kind]: !o[kind] }))}
              aria-expanded={isOpen}
              disabled={isSaved}
              className="flex w-full cursor-pointer items-center gap-2 bg-black/[0.04] px-5 py-3 text-left transition hover:bg-black/[0.08] disabled:cursor-default disabled:hover:bg-black/[0.04] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:disabled:hover:bg-white/[0.06]"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm font-bold ring-1 ${
                  isOpen ? "ring-line text-muted" : "ring-black/20 text-foreground dark:ring-white/25"
                }`}
                aria-hidden
              >
                {isOpen ? "−" : "+"}
              </span>
              <span className="text-sm font-bold">{name}</span>
              {isSaved ? <span className="text-xs font-semibold text-positive">Saved</span> : null}
            </button>
            {/* Always mounted, only hidden when closed, so closing a section
                doesn't throw away what was typed in it. Only open ones save. */}
            <div className={isOpen ? "border-t border-line px-5 pb-4 pt-3" : "hidden"}>
              {kind === "stay" ? (
                <StayModal stay={null} cards={cards} brands={brands} currency={currency} embed={embed} onClose={onClose} />
              ) : kind === "misc" ? (
                <MiscModal
                  // A different trip loads that trip's own figures.
                  key={trip.tripId || "new"}
                  trips={trips}
                  expenses={expenses}
                  cards={cards}
                  currency={currency}
                  defaultTripId={trip.tripId || null}
                  embed={embed}
                  onClose={onClose}
                />
              ) : kind === "flight" ? (
                <FlightModal flight={null} cards={cards} travellers={travellers} trips={trips} currency={currency} embed={embed} onClose={onClose} />
              ) : (
                <CarModal car={null} cards={cards} trips={trips} currency={currency} embed={embed} onClose={onClose} />
              )}
            </div>
          </section>
        );
      })}

      {/* Pinned to the bottom of the scrolling popup so Save is always in reach. */}
      <div className="sticky bottom-0 border-t border-line bg-surface px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {Object.keys(errors).length > 0 || notice ? (
          <div className="mb-2 space-y-1 rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">
            {notice ? <p>{notice}</p> : null}
            {(Object.keys(errors) as Kind[]).map((k) => (
              <p key={k}>
                <span className="font-bold">{label(k)}:</span> {errors[k]}
              </p>
            ))}
            {saved.length > 0 ? (
              <p className="text-xs text-muted">{saved.map(label).join(", ")} already saved — fix the rest and press again.</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Add Travel Log"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
