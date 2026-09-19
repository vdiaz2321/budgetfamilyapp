"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CarModal } from "./car-modal";
import type { SectionHandle } from "./embedded-section";
import { FlightModal } from "./flight-modal";
import { MiscModal } from "./misc-modal";
import { StayModal } from "./stay-modal";
import { useTripChoice } from "./trip-picker";
import type { TravelBrand, TravelCard, TravelStay, TravelTrip, Traveller, TripExpense } from "./types";

type Kind = "stay" | "misc" | "flight" | "car";

const SECTIONS: { kind: Kind; label: string }[] = [
  { kind: "stay", label: "Stay" },
  { kind: "misc", label: "Spending" },
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
  airlines,
  expenses,
  currency,
  defaultTripId,
  onClose,
}: {
  trips: TravelTrip[];
  cards: TravelCard[];
  brands: TravelBrand[];
  travellers: Traveller[];
  airlines: string[];
  expenses: TripExpense[];
  currency: string;
  /** Opened from a trip's own row: every section goes into that trip. */
  defaultTripId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [trip, setTrip] = useTripChoice(defaultTripId);
  // Every section starts collapsed; each opens on a tap.
  const [open, setOpen] = useState<Record<Kind, boolean>>({ stay: false, misc: false, flight: false, car: false });
  // A family of five books two rooms: each extra room is its own stay form,
  // started as a copy of the first room's hotel, city, dates and brand.
  const [rooms, setRooms] = useState<{ id: number; roomOf: TravelStay | null }[]>([{ id: 0, roomOf: null }]);
  const roomHandles = useRef<Record<number, SectionHandle | null>>({});
  // Units ("stay:0", "stay:1", "misc", …) already saved by an earlier press,
  // when another one failed. They are not saved twice on the retry.
  const [saved, setSaved] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // What is typed in the trip box. It matches a saved trip by name (the way
  // the server would anyway), so adding to one is the same as naming it.
  const [tripName, setTripName] = useState("");
  const normalise = (name: string) => name.trim().replace(/\s+[-–—·]\s+/g, " · ").replace(/\s+/g, " ").toLowerCase();
  const matched = defaultTripId ? null : trips.find((t) => t.id === trip.tripId) ?? null;
  function typeTripName(value: string) {
    setTripName(value);
    const hit = trips.find((t) => normalise(t.name) === normalise(value));
    setTrip(hit ? { tripId: hit.id, newTripName: "" } : { tripId: "", newTripName: value });
  }
  // Closing with something typed asks first — one stray tap on the backdrop
  // would otherwise throw away four sections of a phone's worth of typing.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function requestClose() {
    if (pending) return;
    const typed = tripName.trim() || units().some((u) => u.handle && !u.handle.isEmpty());
    if (typed && saved.length === 0) setConfirmDiscard(true);
    else onClose();
  }
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
      const toSave = units().filter(
        (u) => open[u.kind] && !saved.includes(u.id) && u.handle && !u.handle.isEmpty(),
      );
      // A new trip needs its name before anything can be filed under it.
      if (!defaultTripId && !trip.tripId && !trip.newTripName.trim()) {
        setNotice("Give the trip a name first.");
        return;
      }
      if (toSave.length === 0) {
        setNotice("Nothing to add yet — fill in at least one section.");
        return;
      }
      // One at a time, in order: a new trip is created by the first section
      // and the rest find it by its name.
      const done: string[] = [];
      const failed: Record<string, string> = {};
      for (const u of toSave) {
        const result = await u.handle!.save();
        if (result.error) failed[u.id] = result.error;
        else done.push(u.id);
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

  // Everything the save button can post, in order: each room, then the rest.
  function units() {
    return [
      ...rooms.map((r) => ({ id: `stay:${r.id}`, kind: "stay" as Kind, handle: roomHandles.current[r.id] ?? null })),
      ...SECTIONS.filter((s) => s.kind !== "stay").map((s) => ({ id: s.kind as string, kind: s.kind, handle: handles[s.kind].current })),
    ];
  }
  const roomLabel = (i: number) => (i === 0 ? "Stay" : `Room ${i + 1}`);
  const label = (id: string) => {
    const i = rooms.findIndex((r) => `stay:${r.id}` === id);
    return i >= 0 ? roomLabel(i) : SECTIONS.find((s) => s.kind === id)!.label;
  };

  function addRoom() {
    const copy = roomHandles.current[rooms[0].id]?.copyForRoom?.() ?? null;
    setRooms((rs) => [...rs, { id: Math.max(...rs.map((r) => r.id)) + 1, roomOf: copy }]);
  }

  return (
    <ModalShell
      // From a trip's own row everything goes into that trip; from the page's
      // Add button it is always a new trip, named right in the header — no
      // list of saved trips here. Changing a saved trip is the page's "Edit
      // trip" picker, which opens that trip's own popup.
      title={defaultTripId ? `Add to ${trips.find((t) => t.id === defaultTripId)?.name ?? "trip"}` : "Add Travel Log:"}
      headerActions={
        defaultTripId ? null : (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-72">
              {/* The placeholder shows the naming pattern every trip follows. */}
              <input
                value={tripName}
                onChange={(e) => typeTripName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                autoComplete="off"
                aria-label="Trip name"
                placeholder="Greece - May 2027"
                className="h-8 w-full rounded-md bg-background px-2 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            {/* Says which it is, so a name that happens to match doesn't file
                into a saved trip without saying so. */}
            {tripName.trim() ? (
              <span className={`text-xs font-semibold ${matched ? "text-positive" : "text-muted"}`}>
                {matched ? `Adding to ${matched.name}` : "New trip"}
              </span>
            ) : null}
          </div>
        )
      }
      onClose={requestClose}
      className="sm:max-w-4xl"
    >

      {SECTIONS.map(({ kind, label: name }) => {
        const isSaved =
          kind === "stay" ? rooms.every((r) => saved.includes(`stay:${r.id}`)) : saved.includes(kind);
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
                <div className="space-y-4">
                  {rooms.map((r, i) => {
                    const roomSaved = saved.includes(`stay:${r.id}`);
                    return (
                      <div key={r.id} className={i > 0 ? "border-t border-line pt-3" : ""}>
                        {i > 0 ? (
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-bold">
                              {roomLabel(i)}
                              {roomSaved ? <span className="ml-2 text-xs font-semibold text-positive">Saved</span> : null}
                            </span>
                            {roomSaved ? null : (
                              <button
                                type="button"
                                onClick={() => {
                                  delete roomHandles.current[r.id];
                                  setRooms((rs) => rs.filter((x) => x.id !== r.id));
                                }}
                                className="rounded-md px-2 py-1 text-xs font-semibold text-negative transition hover:bg-negative/10"
                              >
                                Remove room
                              </button>
                            )}
                          </div>
                        ) : null}
                        <div className={roomSaved ? "hidden" : ""}>
                          <StayModal
                            stay={null}
                            roomOf={r.roomOf}
                            cards={cards}
                            brands={brands}
                            trips={trips}
                            currency={currency}
                            embed={{
                              trip,
                              register: (handle: SectionHandle) => {
                                roomHandles.current[r.id] = handle;
                              },
                            }}
                            onClose={onClose}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addRoom}
                    className="rounded-md border border-black/25 bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
                  >
                    + Add another room
                  </button>
                </div>
              ) : kind === "misc" ? (
                <MiscModal
                  // A different trip loads that trip's own figures.
                  key={trip.tripId || "new"}
                  trips={trips}
                  expenses={expenses}
                  currency={currency}
                  defaultTripId={trip.tripId || null}
                  embed={embed}
                  onClose={onClose}
                />
              ) : kind === "flight" ? (
                <FlightModal flight={null} cards={cards} travellers={travellers} airlines={airlines} trips={trips} currency={currency} embed={embed} onClose={onClose} />
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
            {Object.keys(errors).map((k) => (
              <p key={k}>
                <span className="font-bold">{label(k)}:</span> {errors[k]}
              </p>
            ))}
            {saved.length > 0 ? (
              <p className="text-xs text-muted">{saved.map(label).join(", ")} already saved — fix the rest and press again.</p>
            ) : null}
          </div>
        ) : null}
        {confirmDiscard ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
            <span className="font-medium">Throw away what you typed?</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-negative px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
              >
                Discard
              </button>
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Add Travel Log"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
