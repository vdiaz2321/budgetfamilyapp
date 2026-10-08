"use client";

import { Fragment, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CurrencyConverter, loadFxRates, type ConvertedFrom } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, displayToCents, foreignSymbol, formatMoney, formatMoneyWhole } from "@/lib/money";
import {
  addTraveller,
  deleteTraveller,
  deleteTravelFlight,
  renameTraveller,
  saveTravelFlight,
  setTravelFlightCancelled,
} from "./flight-actions";
import { CurrencySelect, Field, MoreDetailsToggle, PILL_CONTROL, PaidNote, PlannedPointsNote, Section, inputClass, isPlannedOnly, outsideTripNote } from "./travel-form";
import { TripPicker, useTripChoice } from "./trip-picker";
import { AirlinePicker } from "./airline-picker";
import { CheckPicker } from "./year-picker";
import type { Embed, SectionHandle } from "./embedded-section";
import type { FlightBaggage, TravelCard, TravelFlight, TravelTrip, Traveller } from "./types";
import { formatCentsPerPoint, microsToCentsField } from "./points-value";

type LegDraft = {
  key: number;
  flightOn: string;
  flightNumber: string;
  fromPlace: string;
  toPlace: string;
  departsAt: string;
  arrivesAt: string;
};
// `fare` / `fareEur` are what was spent; `planned` / `plannedForeign` the
// plan beside it. Both foreign figures are in the booking's other currency.
type PassengerDraft = {
  key: number; travellerId: string | null; name: string;
  planned: string; plannedForeign: string; fare: string; fareEur: string;
  pointsUsed: boolean; points: string;
};
type FareSlot = "planned" | "plannedForeign" | "fare" | "fareEur";

type FlightCopy = {
  airline: string;
  reservedOn: string;
  foreignCurrency: string;
  homePlace: string;
  passengers: { travellerId: string | null; name: string }[];
};

let nextKey = 1;
const emptyLeg = (from = "", to = ""): LegDraft => ({
  key: nextKey++, flightOn: "", flightNumber: "", fromPlace: from, toPlace: to, departsAt: "", arrivesAt: "",
});
const emptyPassenger = (): PassengerDraft => ({
  key: nextKey++, travellerId: null, name: "", planned: "", plannedForeign: "", fare: "", fareEur: "", pointsUsed: false, points: "",
});
const money = (cents: number | null | undefined) => (cents ? centsToDisplay(cents) : "");
// Each foreign-currency box and the dollar box it fills beside it.
const FX_PAIR = { plannedForeign: "planned", fareEur: "fare" } as const;

const rateDisplay = (micros: number) => microsToCentsField(micros);

// Passenger rows: ✕, name, Planned $ / other, Spent $ / other, points. On a
// phone the name takes its own line and the figures share the next. With no
// other currency the two foreign columns go.
const PAX_GRID_FX =
  "grid grid-cols-[1.75rem_repeat(4,minmax(0,1fr))] gap-2 sm:grid-cols-[1.75rem_minmax(0,12rem)_repeat(5,6.5rem)]";
const PAX_GRID_USD =
  "grid grid-cols-[1.75rem_repeat(2,minmax(0,1fr))] gap-2 sm:grid-cols-[1.75rem_minmax(0,12rem)_repeat(3,6.5rem)]";

export function FlightModal({
  flight,
  cards,
  travellers,
  airlines = [],
  trips,
  defaultTripId,
  currency,
  embed,
  copyOf,
  onClose,
}: {
  flight: TravelFlight | null;
  trips: TravelTrip[];
  /** Adding from a trip's own row starts in that trip. */
  defaultTripId?: string | null;
  cards: TravelCard[];
  travellers: Traveller[];
  /** Every airline already on a saved flight, offered as you type. */
  airlines?: string[];
  currency: string;
  /** Shown as a section of the Add Travel Log popup — see embedded-section. */
  embed?: Embed;
  /** A second one-way booking started from this one: same airline, booking
   *  date, status and passengers (fares left blank), flying back home. */
  copyOf?: FlightCopy;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [ownTrip, setTrip] = useTripChoice(flight ? flight.tripId : defaultTripId);
  const trip = embed ? embed.trip : ownTrip;
  const [airline, setAirline] = useState(flight?.airline ?? copyOf?.airline ?? "");
  // Not editable here any more; kept so saving leaves an existing code alone.
  const [bookingCode] = useState(flight?.bookingCode ?? "");
  const [reservedOn, setReservedOn] = useState(flight?.reservedOn ?? copyOf?.reservedOn ?? "");
  // Blank is None: dollars only, no second-currency columns.
  const [foreignCurrency, setForeignCurrency] = useState(flight?.foreignCurrency ?? copyOf?.foreignCurrency ?? "");
  const fx = foreignSymbol(foreignCurrency);
  const showFx = Boolean(foreignCurrency);
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    flight?.legs.length
      ? flight.legs.map((l) => ({
          key: nextKey++,
          flightOn: l.flightOn,
          flightNumber: l.flightNumber ?? "",
          fromPlace: l.fromPlace ?? "",
          toPlace: l.toPlace ?? "",
          departsAt: l.departsAt?.slice(0, 5) ?? "",
          arrivesAt: l.arrivesAt?.slice(0, 5) ?? "",
        }))
      : [emptyLeg("", copyOf?.homePlace ?? "")],
  );
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() =>
    flight?.passengers.length
      ? flight.passengers.map((p) => ({
          key: nextKey++,
          travellerId: p.travellerId,
          name: p.name,
          // A flight still planned keeps its plan in the fare columns too;
          // here it shows only under Planned.
          // A bought points seat: Planned is what it would have cost (its
          // fare, if no plan was typed) and Spent is the cash paid on top.
          planned: money(flight.isEstimate ? p.fareCents : p.pointsUsed ? (p.plannedFareCents ?? p.fareCents) : p.plannedFareCents),
          plannedForeign: money(flight.isEstimate ? p.fareEurCents : p.plannedFareForeignCents),
          fare: flight.isEstimate ? "" : money(p.pointsUsed ? p.cashPaidCents : p.fareCents),
          fareEur: flight.isEstimate ? "" : money(p.fareEurCents),
          pointsUsed: p.pointsUsed,
          points: p.pointsCost ? String(p.pointsCost) : "",
        }))
      : copyOf?.passengers.length
        ? copyOf.passengers.map((p) => ({ ...emptyPassenger(), travellerId: p.travellerId, name: p.name }))
        : [emptyPassenger()],
  );
  const [accountId, setAccountId] = useState(flight?.accountId ?? "");
  const [cardLabel, setCardLabel] = useState(flight?.cardLabel ?? "");
  const [holder, setHolder] = useState(flight?.holder ?? "");
  // Blank means "worked out from the points tickets" — see the server action.
  const [pointsValue, setPointsValue] = useState(() => {
    if (!flight?.pointsValueMicros) return "";
    const fares = flight.passengers.reduce((sum, p) => sum + (p.pointsUsed ? p.fareCents : 0), 0);
    const implied = flight.pointsCost > 0 && fares > 0 ? Math.round((fares / flight.pointsCost) * 10_000) : null;
    return flight.pointsValueMicros !== implied ? rateDisplay(flight.pointsValueMicros) : "";
  });
  const [remarks, setRemarks] = useState(flight?.remarks ?? "");
  const [baggage, setBaggage] = useState<FlightBaggage>(
    () => flight?.baggage ?? { fare: "", personalItem: false, carryOn: false, checkedBags: 0 },
  );
  const [editingNames, setEditingNames] = useState(false);
  // The short form: points seats, card owner and
  // remarks fold away; a saved flight already using any of them opens with
  // them showing.
  const [showMore, setShowMore] = useState(
    () =>
      !!flight &&
      !!(flight.cardLabel?.trim() || flight.holder?.trim() || flight.pointsUsed || flight.pointsCost > 0 ||
        flight.remarks?.trim() || flight.passengers.some((p) => p.pointsUsed)),
  );

  // The fare the currency converter fills: the one last clicked into, or else
  // the first one still empty.
  const lastFare = useRef<{ key: number; slot: FareSlot } | null>(null);

  // Typing a fare in the foreign column fills the dollar box on that same row
  // — only that row, since the kids' fares differ. Spent converts at the
  // booking date's rate (what the card charged); Planned at today's. The
  // rates load the first time a foreign box is clicked into.
  const fxRates = useRef<{ planned: Record<string, number> | null; spent: Record<string, number> | null; spentOn: string }>({
    planned: null, spent: null, spentOn: "",
  });
  const toUsd = (raw: string, slot: FareSlot): string | null => {
    const rate = (slot === "fareEur" ? fxRates.current.spent : fxRates.current.planned)?.[foreignCurrency];
    if (!rate) return null;
    if (!raw.trim()) return "";
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? centsToDisplay(Math.round((n / rate) * 100)) : null;
  };
  function typeFare(key: number, slot: FareSlot, value: string) {
    if (slot !== "plannedForeign" && slot !== "fareEur") return updatePassenger(key, { [slot]: value });
    const usd = toUsd(value, slot);
    // Spent $ follows the linked payments; a foreign figure doesn't change it.
    const locked = slot === "fareEur" && flight?.paidCents != null;
    updatePassenger(key, usd == null || locked ? { [slot]: value } : { [slot]: value, [FX_PAIR[slot]]: usd });
  }
  function loadRatesFor(key: number, slot: FareSlot) {
    if (slot !== "plannedForeign" && slot !== "fareEur") return;
    const spent = slot === "fareEur";
    if (spent ? fxRates.current.spent && fxRates.current.spentOn === reservedOn : fxRates.current.planned) return;
    loadFxRates(spent ? reservedOn : undefined).then((rates) => {
      if (spent) fxRates.current = { ...fxRates.current, spent: rates, spentOn: reservedOn };
      else fxRates.current = { ...fxRates.current, planned: rates };
      // A figure typed before the rates arrived gets its dollars now.
      setPassengers((all) =>
        all.map((p) => {
          if (p.key !== key || !p[slot].trim() || p[FX_PAIR[slot]].trim()) return p;
          if (slot === "fareEur" && flight?.paidCents != null) return p;
          const usd = toUsd(p[slot], slot);
          return usd ? { ...p, [FX_PAIR[slot]]: usd } : p;
        }),
      );
    });
  }

  // Payments linked from the Budget fill each passenger's Spent $ — their
  // share of the payments — so those boxes can't be typed over here.
  const spentLinked = flight?.paidCents != null;
  const PAX_GRID = showFx ? PAX_GRID_FX : PAX_GRID_USD;
  // The money boxes on each row: with a currency, dollars and that currency
  // under Planned and under Spent; without, dollars only.
  const SLOTS = (showFx ? ["planned", "plannedForeign", "fare", "fareEur"] : ["planned", "fare"]) as FareSlot[];

  const passengerPoints = (p: PassengerDraft) => (p.pointsUsed ? Number(p.points.replace(/,/g, "")) || 0 : 0);
  // Bought once a Spent fare or the booking date is in; a plan until then.
  const isEstimate = isPlannedOnly(passengers.some((p) => p.fare.trim() || p.fareEur.trim()), reservedOn);
  const total = (slot: FareSlot) => passengers.reduce((sum, p) => sum + Math.max(0, displayToCents(p[slot])), 0);
  // What the seat costs now: the plan until it is bought. A bought points
  // seat's cost is its Planned fare (what the points stood in for); its
  // Spent boxes are the cash paid on top of the points.
  const effective = (p: PassengerDraft) => (isEstimate || passengerPoints(p) > 0 ? p.planned : p.fare);

  const card = cards.find((c) => c.id === accountId) ?? null;
  const fareCents = passengers.reduce((sum, p) => sum + Math.max(0, displayToCents(effective(p))), 0);
  // Points on the booking are its points tickets added up; the fares of those
  // tickets are what the points bought, which is how they are valued.
  const pointsTyped = passengers.reduce((sum, p) => sum + passengerPoints(p), 0);
  const pointsFareCents = passengers.reduce(
    (sum, p) => sum + (passengerPoints(p) > 0 ? Math.max(0, displayToCents(effective(p))) : 0),
    0,
  );
  const pointsUsed = pointsTyped > 0;
  const impliedMicros = pointsTyped > 0 && pointsFareCents > 0 ? Math.round((pointsFareCents / pointsTyped) * 10_000) : null;
  const datesOutOfOrder = Boolean(reservedOn && legs[0]?.flightOn && legs.some((l) => l.flightOn && l.flightOn < reservedOn));
  const tripNote = outsideTripNote(trips, trip.tripId, legs.map((l) => l.flightOn));
  // Names each flight from the route: the first leg back to where the trip
  // began is the Return; a leg picking up where the last one landed, before
  // or after it, is a Layover.
  const samePlace = (a: string, b: string) => Boolean(a.trim()) && a.trim().toLowerCase() === b.trim().toLowerCase();
  const returnStart = (() => {
    const home = legs[0]?.fromPlace ?? "";
    const back = legs.findIndex((l, i) => i > 0 && samePlace(l.toPlace, home));
    if (back < 0) return -1;
    // The return begins at the first leg of that homeward chain.
    let start = back;
    while (start > 1 && samePlace(legs[start - 1].toPlace, legs[start].fromPlace) && legs[start - 1].flightOn === legs[start].flightOn) start--;
    return start;
  })();
  const legLabel = (i: number) => {
    if (legs.length === 1) return "Flight";
    if (i === 0) return "Outbound";
    if (i === returnStart) return "Return";
    return "Layover";
  };

  // What saving moves on the card, same preview the stay form gives. An
  // estimate has drawn nothing and draws nothing.
  const alreadyDrawn = flight && !flight.cancelledAt && !flight.isEstimate && flight.pointsUsed && flight.accountId === accountId ? flight.pointsCost : 0;
  // A flight imported from the sheet never moves a card, so it previews nothing.
  const draw = card && (!flight || flight.movesCardPoints) ? (pointsUsed && !isEstimate ? pointsTyped : 0) - alreadyDrawn : 0;

  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId);
    if (!next) return;
    if (!holder.trim() && next.holder) setHolder(next.holder);
  }

  const onPoints = passengers.filter((p) => p.pointsUsed);
  const pointsSummary =
    onPoints.length === 0
      ? "None"
      : onPoints.length === passengers.length && passengers.length > 1
        ? "Everyone"
        : onPoints.length <= 2
          ? onPoints.map((p) => p.name || `Passenger ${passengers.indexOf(p) + 1}`).join(", ")
          : `${onPoints.length} of ${passengers.length}`;

  const updateLeg = (key: number, patch: Partial<LegDraft>) =>
    setLegs((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updatePassenger = (key: number, patch: Partial<PassengerDraft>) =>
    setPassengers((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  // What's in the Total box while typing. It can be blank for a moment so the
  // "1" can be cleared and replaced; blank never shrinks the list.
  const [countDraft, setCountDraft] = useState<string | null>(null);
  function setPassengerCount(raw: string) {
    setCountDraft(raw);
    if (!raw.trim()) return;
    const count = Math.min(12, Math.max(1, Math.trunc(Number(raw)) || 1));
    setPassengers((all) =>
      count > all.length
        ? [...all, ...Array.from({ length: count - all.length }, emptyPassenger)]
        : all.slice(0, count),
    );
  }

  // A receipt in the booking's other currency keeps that figure beside the
  // dollars it converted to, under Planned or Spent — whichever was clicked.
  function applyConverted(cents: number, from: ConvertedFrom) {
    const last = lastFare.current;
    const planned = last ? last.slot.startsWith("planned") : isEstimate;
    const usdSlot = planned ? "planned" : "fare";
    const target =
      passengers.find((p) => p.key === last?.key) ?? passengers.find((p) => !p[usdSlot].trim()) ?? passengers[0];
    if (target) {
      updatePassenger(target.key, {
        [usdSlot]: centsToDisplay(cents),
        ...(from.currency === foreignCurrency
          ? { [planned ? "plannedForeign" : "fareEur"]: centsToDisplay(from.amountCents) }
          : {}),
      });
    }
  }

  // A name already given to another passenger isn't offered twice. A saved
  // passenger whose name has since left the list keeps it as an option.
  function nameOptions(current: PassengerDraft) {
    const taken = new Set(passengers.filter((p) => p.key !== current.key).map((p) => p.name.toLowerCase()));
    const names = travellers.map((t) => ({ id: t.id as string | null, name: t.name }));
    if (current.name && !names.some((n) => n.name.toLowerCase() === current.name.toLowerCase())) {
      names.push({ id: current.travellerId, name: current.name });
    }
    return names.filter((n) => !taken.has(n.name.toLowerCase()));
  }

  const payload = () => ({
        id: flight?.id ?? null,
        ...trip,
        airline,
        bookingCode,
        reservedOn,
        accountId,
        cardLabel,
        holder,
        pointsValueCents: pointsValue,
        remarks,
        baggage,
        foreignCurrency,
        legs: legs.map((l) => ({
          flightOn: l.flightOn, flightNumber: l.flightNumber, fromPlace: l.fromPlace,
          toPlace: l.toPlace, departsAt: l.departsAt, arrivesAt: l.arrivesAt,
        })),
        passengers: passengers.map((p) => ({
          travellerId: p.travellerId, name: p.name, planned: p.planned, plannedForeign: p.plannedForeign,
          fare: p.fare, fareEur: p.fareEur, pointsUsed: p.pointsUsed, points: p.points,
        })),
  });

  const ownEmpty = () =>
    ![airline, bookingCode, reservedOn, accountId, cardLabel, holder, remarks].some((v) => v.trim()) &&
    legs.every((l) => ![l.flightOn, l.flightNumber, l.fromPlace, l.toPlace, l.departsAt, l.arrivesAt].some((v) => v.trim())) &&
    passengers.every((p) => !p.name && ![p.planned, p.plannedForeign, p.fare, p.fareEur, p.points].some((v) => v.trim()));

  // Separate one-way bookings added under this one ("Booking 2", ...), each
  // its own embedded flight form, saved right after this one.
  const formId = useId();
  const [extras, setExtras] = useState<{ id: number; copy: FlightCopy }[]>([]);
  const extraHandles = useRef<Record<number, SectionHandle | null>>({});
  // A new booking already saved by an earlier press, when a later one
  // failed. It is not saved a second time on the retry.
  const ownSaved = useRef(false);

  async function saveAll(): Promise<string | null> {
    if (!ownSaved.current && !(embed && ownEmpty())) {
      const result = await saveTravelFlight(payload());
      if (result?.error) return result.error;
      if (!flight) ownSaved.current = true;
    }
    const failed: string[] = [];
    for (const [i, x] of extras.entries()) {
      const handle = extraHandles.current[x.id];
      if (!handle || handle.isEmpty()) continue;
      const result = await handle.save();
      if (result.error) failed.push(`Flight #${i + 2}: ${result.error}`);
      else setExtras((all) => all.filter((e) => e.id !== x.id));
    }
    return failed.length ? failed.join(" · ") : null;
  }

  function addBooking() {
    setExtras((all) => [
      ...all,
      {
        id: (all.at(-1)?.id ?? 0) + 1,
        copy: {
          airline,
          reservedOn,
          foreignCurrency,
          homePlace: legs[0]?.fromPlace ?? "",
          passengers: passengers.filter((p) => p.name).map((p) => ({ travellerId: p.travellerId, name: p.name })),
        },
      },
    ]);
  }

  useEffect(() => {
    if (!embed) return;
    embed.register({
      isEmpty: () => ownEmpty() && extras.every((x) => extraHandles.current[x.id]?.isEmpty() ?? true),
      save: async () => ({ error: await saveAll() }),
    });
  });

  function submit() {
    start(async () => {
      setError(null);
      const failure = await saveAll();
      router.refresh();
      if (failure) setError(failure);
      else onClose();
    });
  }

  function act(run: () => Promise<{ error: string | null }>) {
    start(async () => {
      const result = await run();
      if (result?.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  }

  const body = (
    <div className={embed ? "" : "px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"}>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!embed) submit();
        }}
        className="grid grid-cols-1 gap-3"
      >
        {flight?.cancelledAt ? (
          <p className="rounded-md bg-black/5 px-3 py-2 text-xs font-semibold text-muted dark:bg-white/10">
            Cancelled booking — kept on record, left out of every total.
          </p>
        ) : null}

        {/* Trip, airline and booking date on one line. The booking code is
            no longer typed here; one saved earlier is kept as it was. */}
        <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem]">
          {embed || flight ? null : (
            <TripPicker
              trips={trips}
              value={trip}
              onChange={setTrip}
              startNew={!defaultTripId}
              className="col-span-2 sm:col-span-1 sm:grid-cols-1!"
            />
          )}
          <Field label="Airline">
            <AirlinePicker airlines={airlines} value={airline} onChange={setAirline} />
          </Field>
          <Field label="Booking made">
            <input
              type="date"
              value={reservedOn}
              onChange={(e) => setReservedOn(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        {/* ---- Flights. A round trip is one booking with two of these. */}
        <Section title="Flights">
          <div className="space-y-3">
            {legs.map((leg, i) => (
              <Fragment key={leg.key}>
              {i > 0 && connectionMinutes(legs[i - 1], leg) != null ? (
                // Time on the ground between two connecting flights, worked
                // out from the arrival and departure typed above and below.
                <div className="flex items-center gap-2 px-2" aria-label="Layover">
                  <span className="h-px flex-1 border-t border-dashed border-sky-300 dark:border-sky-700" />
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-800">
                    <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></svg>
                    Layover{leg.fromPlace.trim() ? ` in ${leg.fromPlace.trim()}` : ""} · {formatDuration(connectionMinutes(legs[i - 1], leg)!)}
                  </span>
                  <span className="h-px flex-1 border-t border-dashed border-sky-300 dark:border-sky-700" />
                </div>
              ) : null}
              {/* One line per flight: the date carries the flight's name
                  ("Outbound date", "Return date"), so there is no heading row. */}
              <div
                className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_8rem_8rem_auto]"
              >
                <Field label={`${legLabel(i)} date`}>
                  <input
                    type="date"
                    value={leg.flightOn}
                    onChange={(e) => updateLeg(leg.key, { flightOn: e.target.value })}
                    className={`${inputClass} ${reservedOn && leg.flightOn && leg.flightOn < reservedOn ? "ring-2 ring-negative" : ""}`}
                  />
                </Field>
                <Field label="Booking Ref">
                  <input
                    value={leg.flightNumber}
                    onChange={(e) => updateLeg(leg.key, { flightNumber: e.target.value })}
                    autoComplete="off"
                    className={`${inputClass} uppercase`}
                  />
                </Field>
                <Field label="From">
                  <input value={leg.fromPlace} onChange={(e) => updateLeg(leg.key, { fromPlace: e.target.value })} className={inputClass} />
                </Field>
                <Field label="To">
                  <input value={leg.toPlace} onChange={(e) => updateLeg(leg.key, { toPlace: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Departs">
                  <input
                    type="time"
                    value={leg.departsAt}
                    onChange={(e) => updateLeg(leg.key, { departsAt: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Arrives">
                  <input
                    type="time"
                    value={leg.arrivesAt}
                    onChange={(e) => updateLeg(leg.key, { arrivesAt: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                {legs.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLegs((all) => all.filter((l) => l.key !== leg.key))}
                    aria-label={`Remove flight ${i + 1}`}
                    className="col-span-2 mb-0.5 justify-self-end rounded-md px-2 py-1.5 text-sm font-semibold text-muted transition hover:bg-negative/10 hover:text-negative sm:col-span-1"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              </Fragment>
            ))}
            {datesOutOfOrder ? (
              <p className="text-xs font-medium text-negative">A flight is dated before the booking — check the year.</p>
            ) : tripNote ? (
              <p className="text-xs font-medium text-negative">{tripNote}</p>
            ) : null}
            <div className="flex flex-wrap items-start gap-2 pt-1">
              {/* A layover carries on from where the last flight landed, on
                  the same day and booking ref. */}
              <button
                type="button"
                onClick={() => {
                  const last = legs[legs.length - 1];
                  setLegs((all) => [
                    ...all,
                    { ...emptyLeg(last?.toPlace ?? "", ""), flightOn: last?.flightOn ?? "", flightNumber: last?.flightNumber ?? "" },
                  ]);
                }}
                className={FLIGHT_ACTION}
              >
                Add layover flight
              </button>
              {/* The return flies from where the last flight landed back to
                  where the trip began. An added booking (Booking 2, …) is a
                  one-way ticket: no return. */}
              {copyOf || returnStart >= 0 ? null : (
                <button
                  type="button"
                  onClick={() => {
                    const last = legs[legs.length - 1];
                    setLegs((all) => [...all, emptyLeg(last?.toPlace ?? "", legs[0]?.fromPlace ?? "")]);
                  }}
                  className={FLIGHT_ACTION}
                >
                  Add return flight
                </button>
              )}
              <FeaturesButton value={baggage} onChange={setBaggage} />
            </div>
          </div>
        </Section>

        {/* ---- Who flew, each person's own fare, and whether their seat
             was paid with points. The fare stays on a points ticket: it is
             what the points bought, which is how they are valued. */}
        <section className="border-t border-line pt-3">
          {/* Heading, head count and the converter on one line. The converter
              takes the whole next line once it is opened. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide">Passengers</h3>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Total
              <input
                type="number"
                min="1"
                max="12"
                step="1"
                value={countDraft ?? passengers.length}
                onChange={(e) => setPassengerCount(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => setCountDraft(null)}
                // Compact, to sit level with the currency and points pickers
                // beside it.
                className="h-7 w-14 rounded-md bg-background px-2 text-center text-sm font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </label>
            {/* Beside Total: the names are who the passenger rows pick from. */}
            <button
              type="button"
              onClick={() => setEditingNames((v) => !v)}
              className="rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              {editingNames ? "Done editing names" : "Edit family names"}
            </button>
            {/* The currency the second column of Planned and Spent is in. */}
            <CurrencySelect value={foreignCurrency} onChange={setForeignCurrency} />
            {/* Which seats were paid with points, picked in one place; each
                ticked passenger gets a Points box on their row. */}
            {showMore ? <CheckPicker
              label="Paid with points"
              align="left"
              className={`h-7 ${PILL_CONTROL}`}
              buttonText={
                <>
                  <span className="text-foreground/80">Paid with points:</span>
                  {pointsSummary}
                </>
              }
              allOption={{
                label: "Everyone",
                checked: passengers.every((p) => p.pointsUsed),
                onClick: () => {
                  const all = passengers.every((p) => p.pointsUsed);
                  setPassengers((list) => list.map((p) => ({ ...p, pointsUsed: !all })));
                },
              }}
              options={passengers.map((p, i) => ({
                key: String(p.key),
                label: p.name || `Passenger ${i + 1}`,
                checked: p.pointsUsed,
                onToggle: () => updatePassenger(p.key, { pointsUsed: !p.pointsUsed }),
              }))}
            /> : null}
            <div className="has-[.rounded-xl]:order-last has-[.rounded-xl]:basis-full">
              <CurrencyConverter onUse={applyConverted} blue defaultFrom={foreignCurrency} date={isEstimate ? undefined : reservedOn} />
            </div>
          </div>

          {editingNames ? <TravellerEditor travellers={travellers} /> : null}

          {/* A two-level header, like a spreadsheet's: Planned and Spent each
              span their two money columns, with the currency under each. It
              stands in for the per-row labels, so the rows sit straight under
              it. On a phone the four figures share the line under each name. */}
          <div className="relative">
          {/* A blue frame round the Spent columns, from their heading down
              through the Total, so they read apart from Planned. The rows are
              separate grids, so the frame is one more grid laid over them,
              its box in the same columns. Wide screens only: on a phone the
              figures sit under each name instead. */}
          <div aria-hidden className={`${PAX_GRID} pointer-events-none absolute -inset-y-1.5 inset-x-0 hidden sm:grid`}>
            <span
              className="-mx-1 rounded-lg ring-2 ring-sky-400 dark:ring-sky-500"
              style={{ gridColumn: showFx ? "5 / span 2" : "4 / span 1" }}
            />
          </div>
          <div className={`${PAX_GRID} mb-1.5 items-end text-center`}>
            <span aria-hidden className="hidden sm:block" />
            <span className="hidden self-end pb-0.5 text-left text-xs font-bold uppercase tracking-wide text-muted sm:row-span-2 sm:block">
              Passenger
            </span>
            <span className={`${showFx ? "col-span-2" : ""} col-start-2 border-b-2 border-line pb-0.5 text-xs font-bold uppercase tracking-wide text-muted sm:col-start-auto`}>
              Planned
            </span>
            <span className={`${showFx ? "col-span-2" : ""} border-b-2 border-sky-400 pb-0.5 text-xs font-bold uppercase tracking-wide text-foreground dark:border-sky-500`}>
              Spent
            </span>
            <span aria-hidden className="hidden sm:block" />
            <span aria-hidden className="hidden sm:block" />
            {[
              { code: currency, sign: currencySymbol(currency), spent: false },
              ...(showFx ? [{ code: foreignCurrency, sign: fx, spent: false }] : []),
              { code: currency, sign: currencySymbol(currency), spent: true },
              ...(showFx ? [{ code: foreignCurrency, sign: fx, spent: true }] : []),
            ].map((c, n) => (
              <span
                key={n}
                className={`text-xs font-semibold ${c.spent ? "text-foreground" : "text-muted"} ${n === 0 ? "col-start-2 sm:col-start-auto" : ""}`}
              >
                {c.sign === c.code ? c.code : `${c.code} ${c.sign}`}
              </span>
            ))}
            <span aria-hidden className="hidden sm:block" />
          </div>
          <ul className="space-y-2">
            {passengers.map((p, i) => (
              <li key={p.key} className={`${PAX_GRID} items-end`}>
                {/* Remove sits first, so the ✕ lines up down the left edge. */}
                <button
                  type="button"
                  disabled={passengers.length === 1}
                  onClick={() => setPassengers((all) => all.filter((x) => x.key !== p.key))}
                  aria-label={`Remove passenger ${i + 1}`}
                  className="mb-0.5 w-7 rounded-md py-1.5 text-sm font-semibold text-muted transition hover:bg-negative/10 hover:text-negative disabled:invisible"
                >
                  ✕
                </button>
                <label className={`${showFx ? "col-span-4" : "col-span-2"} block min-w-0 sm:col-span-1`}>
                  <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted sm:hidden">
                    Passenger {i + 1}
                  </span>
                  <select
                    value={p.name}
                    onChange={(e) => {
                      const picked = travellers.find((t) => t.name === e.target.value);
                      updatePassenger(p.key, { name: e.target.value, travellerId: picked?.id ?? p.travellerId });
                    }}
                    className={inputClass}
                  >
                    <option value="">Pick a name</option>
                    {nameOptions(p).map((n) => (
                      <option key={n.name} value={n.name}>{n.name}</option>
                    ))}
                  </select>
                </label>
                {SLOTS.map((slot, n) => {
                  const spent = slot === "fare" || slot === "fareEur";
                  return (
                  <input
                    key={slot}
                    readOnly={spentLinked && spent}
                    tabIndex={spentLinked && spent ? -1 : undefined}
                    aria-label={`Passenger ${i + 1} ${spent ? "spent" : "planned"} ${slot.endsWith("Foreign") || slot === "fareEur" ? foreignCurrency : currency}`}
                    value={p[slot]}
                    onChange={(e) => typeFare(p.key, slot, e.target.value)}
                    onFocus={() => {
                      lastFare.current = { key: p.key, slot };
                      loadRatesFor(p.key, slot);
                    }}
                    // On a points seat the Spent boxes take the cash paid on
                    // top of the points (taxes, fees, a points + cash fare).
                    placeholder={p.pointsUsed && spent ? "Cash paid" : undefined}
                    inputMode="decimal"
                    className={`${inputClass} text-center ${n === 0 ? "col-start-2 sm:col-start-auto" : ""} ${spentLinked && spent ? "opacity-70" : ""}`}
                  />
                  );
                })}
                {/* Points: under the figures on a phone, on the same line on a
                    wide screen — only for the seats ticked in "Paid with points". */}
                {p.pointsUsed ? (
                  <Field label="Points" className={`${showFx ? "col-span-2" : ""} col-start-2 text-center sm:col-span-1 sm:col-start-auto`}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={p.points}
                      onChange={(e) => updatePassenger(p.key, { points: e.target.value })}
                      className={`${inputClass} text-center`}
                    />
                  </Field>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </li>
            ))}
          </ul>

          {/* Every seat added up, Planned beside Spent. */}
          <div className={`${PAX_GRID} mt-2 items-baseline border-t border-line pt-2 text-sm font-bold tabular-nums`}>
            <span aria-hidden />
            <span className={`${showFx ? "col-span-4" : "col-span-2"} sm:col-span-1`}>Total</span>
            <span className="col-start-2 text-center sm:col-start-auto">{formatMoney(total("planned"), currency)}</span>
            {showFx ? <span className="text-center">{fx}{centsToDisplay(total("plannedForeign"))}</span> : null}
            <span className="text-center">{formatMoney(total("fare"), currency)}</span>
            {showFx ? <span className="text-center">{fx}{centsToDisplay(total("fareEur"))}</span> : null}
            <span className="hidden text-center sm:block">{pointsTyped ? pointsTyped.toLocaleString() : ""}</span>
          </div>
          </div>
        </section>

        {/* ---- How it was paid: the card, and points if any. */}
        <Section title="Payment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Card used">
            <select value={accountId} onChange={(e) => pickCard(e.target.value)} className={inputClass}>
              <option value="">Not linked to a card</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className={showMore ? "contents" : "hidden"}>
          <Field label="Card used (if not linked)">
            <input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Card owner">
            <input value={holder} onChange={(e) => setHolder(e.target.value)} className={inputClass} />
          </Field>
          </div>
        </div>

        <MoreDetailsToggle open={showMore} onToggle={() => setShowMore((v) => !v)} className="mt-3" />

        <div className={showMore ? "contents" : "hidden"}>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Points used">
            {/* The points tickets above, added up. */}
            <input value={pointsTyped ? pointsTyped.toLocaleString() : ""} readOnly tabIndex={-1} className={`${inputClass} opacity-70`} />
          </Field>
          <Field label="Value per pt (¢)">
            <input
              value={pointsValue}
              onChange={(e) => setPointsValue(e.target.value)}
              placeholder={impliedMicros ? rateDisplay(impliedMicros) : ""}
              inputMode="decimal"
              className={inputClass}
            />
            {impliedMicros ? (
              <span className="mt-0.5 block text-[11px] font-medium text-muted">
                <span style={{ color: "var(--viz-savings)" }}>{formatCentsPerPoint(impliedMicros / 10_000)}/pt</span> ={" "}
                {formatMoneyWhole(pointsFareCents, currency)} ÷ {pointsTyped.toLocaleString()} pts
              </span>
            ) : null}
          </Field>
          <Field label={`${isEstimate ? "Planned flight cost" : "Flight cost"} (${currencySymbol(currency)})`}>
            {/* The fares added up — change a fare above to change it. */}
            <input value={fareCents ? centsToDisplay(fareCents) : ""} readOnly tabIndex={-1} className={`${inputClass} opacity-70`} />
          </Field>
          <Field label={`Pocket cost (${currencySymbol(currency)})`}>
            <input
              // Only ever the linked payments — blank until one is linked,
              // so it never shows a plan or a guess as money paid.
              value={flight?.paidCents != null ? centsToDisplay(flight.paidCents) : ""}
              placeholder="—"
              readOnly
              tabIndex={-1}
              className={`${inputClass} opacity-70`}
            />
            <PaidNote linked={flight?.paidCents != null} />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3 sm:flex-nowrap">
          <Field label="Remarks" className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
          </Field>
        </div>
        </div>
        </Section>

        {error && !embed ? (
          <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p>
        ) : null}

        <PlannedPointsNote show={isEstimate && pointsUsed} />
        {draw !== 0 ? (
          <p className="text-xs text-muted">
            Saving {draw < 0 ? "returns" : "takes"} {Math.abs(draw).toLocaleString()} pts {draw < 0 ? "to" : "from"} {card?.name} on Accounts.
          </p>
        ) : null}
      </form>
      {extras.map((x, i) => (
        <div key={x.id} className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">Flight #{i + 2}</span>
            <button
              type="button"
              onClick={() => {
                delete extraHandles.current[x.id];
                setExtras((all) => all.filter((e) => e.id !== x.id));
              }}
              className="rounded-md px-2 py-1 text-xs font-semibold text-negative transition hover:bg-negative/10"
            >
              Remove flight
            </button>
          </div>
          <FlightModal
            flight={null}
            copyOf={x.copy}
            cards={cards}
            travellers={travellers}
            airlines={airlines}
            trips={trips}
            currency={currency}
            embed={{
              trip,
              register: (handle) => {
                extraHandles.current[x.id] = handle;
              },
            }}
            onClose={onClose}
          />
        </div>
      ))}
      {/* Two one-way tickets bought separately, each its own booking with
          its own fares, without a second popup. An added booking does not
          offer it again; the button under the first one keeps adding. */}
      {copyOf ? null : (
        <button
          type="button"
          onClick={addBooking}
          className="mt-3 rounded-md border border-black/25 bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
        >
          + Add another flight booking
        </button>
      )}
        {embed ? null : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {passengers.length} passenger{passengers.length === 1 ? "" : "s"} · {isEstimate ? "Planned flight cost" : "Flight cost"}{" "}
            <span className="font-bold tabular-nums text-foreground">{formatMoney(fareCents, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {flight ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => setTravelFlightCancelled(flight.id, !flight.cancelledAt))}
                // Red while it would cancel, so it is not clicked by mistake;
                // restoring a cancelled booking is harmless and stays neutral.
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                  flight.cancelledAt
                    ? "ring-line hover:bg-black/5 dark:hover:bg-white/10"
                    : "text-negative ring-negative/60 hover:bg-negative/10"
                }`}
              >
                {flight.cancelledAt ? "Restore booking" : "Cancel booking"}
              </button>
            ) : null}
            {flight ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => deleteTravelFlight(flight.id))}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
              >
                Delete
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={pending}
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
            >
              {pending ? "Saving…" : flight ? "Save flight" : "Add flight"}
            </button>
          </div>
        </div>
        )}
    </div>
  );
  return embed ? body : (
    <ModalShell
      title={flight ? "Edit flight" : "Add flight"}
      onClose={onClose}
      className="sm:max-w-5xl"
      headerActions={flight ? <TripPicker trips={trips} value={trip} onChange={setTrip} inHeader /> : undefined}
    >
      {body}
    </ModalShell>
  );
}

// Add, rename and remove first names. Each change saves on its own; a
// passenger already saved keeps the name it was saved with.
function TravellerEditor({ travellers }: { travellers: Traveller[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    start(async () => {
      setError(null);
      const result = await action();
      if (result.error) setError(result.error);
      else {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="mb-3 rounded-lg bg-background/60 p-3 ring-1 ring-line">
      <ul className="space-y-1.5">
        {travellers.map((t) => {
          const draft = drafts[t.id] ?? t.name;
          const changed = draft.trim() && draft.trim() !== t.name;
          return (
            <li key={t.id} className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                className={`${inputClass} max-w-48`}
              />
              {changed ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => renameTraveller(t.id, draft))}
                  className="rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Save
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteTraveller(t.id))}
                className="rounded-md px-2 py-1 text-xs font-semibold text-negative hover:bg-negative/10"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the name instead of submitting the whole flight form.
            if (e.key === "Enter") {
              e.preventDefault();
              if (newName.trim()) run(() => addTraveller(newName), () => setNewName(""));
            }
          }}
          placeholder="First name"
          className={`${inputClass} max-w-48`}
        />
        <button
          type="button"
          disabled={pending || !newName.trim()}
          onClick={() => run(() => addTraveller(newName), () => setNewName(""))}
          className="rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Add name
        </button>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-negative">{error}</p> : null}
    </div>
  );
}

// Minutes between one flight landing and the next taking off, when the second
// leaves from where the first landed within a day — a connection, not a
// return days later. Both times are at the same airport, so no time zones.
function connectionMinutes(prev: { flightOn: string; arrivesAt: string; toPlace: string }, next: { flightOn: string; departsAt: string; fromPlace: string }): number | null {
  if (!prev.flightOn || !next.flightOn || !prev.arrivesAt || !next.departsAt) return null;
  if (prev.toPlace.trim() && next.fromPlace.trim() && prev.toPlace.trim().toLowerCase() !== next.fromPlace.trim().toLowerCase()) return null;
  const at = (date: string, time: string) => {
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) / 60000;
  };
  const gap = at(next.flightOn, next.departsAt) - at(prev.flightOn, prev.arrivesAt);
  return gap >= 0 && gap <= 24 * 60 ? gap : null;
}

const formatDuration = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;

// "Features": what the fare includes. The button names what is set, so the
// row reads without opening it; a click opens a small panel to change it.
function FeaturesButton({ value, onChange }: { value: FlightBaggage; onChange: (v: FlightBaggage) => void }) {
  const [open, setOpen] = useState(false);
  const parts = [
    value.fare.trim(),
    value.personalItem ? "Personal item" : "",
    value.carryOn ? "Carry-on" : "",
    value.checkedBags ? `${value.checkedBags} checked bag${value.checkedBags === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const set = (patch: Partial<FlightBaggage>) => onChange({ ...value, ...patch });
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={parts.length ? FLIGHT_ACTION_ON : FLIGHT_ACTION}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="6" width="12" height="11" rx="2" /><path d="M7.5 6V4.5A1.5 1.5 0 0 1 9 3h2a1.5 1.5 0 0 1 1.5 1.5V6M8 10v3M12 10v3" />
        </svg>
        Features{parts.length ? `: ${parts.join(" · ")}` : ""}
        <svg aria-hidden viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7.5 10 12.5 15 7.5" /></svg>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-3rem)] space-y-2.5 rounded-lg bg-surface p-3 text-sm shadow-lg ring-1 ring-line">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide">Features</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative hover:bg-negative/15"
            >
              Close
            </button>
          </div>
          <Field label="Fare">
            <input value={value.fare} onChange={(e) => set({ fare: e.target.value })} placeholder="Economy Basic" className={inputClass} />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.personalItem} onChange={(e) => set({ personalItem: e.target.checked })} className="h-4 w-4" />
            Personal item
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.carryOn} onChange={(e) => set({ carryOn: e.target.checked })} className="h-4 w-4" />
            Carry-on bag
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Checked bags (total)</span>
            <input
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              value={value.checkedBags || ""}
              placeholder="0"
              onChange={(e) => set({ checkedBags: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
              className={`${inputClass} w-16! text-center`}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

// The Flights section's own buttons: light blue so they read as clickable,
// with the same sky-100 / sky-400 hover as the rest of the app's outlined buttons.
const FLIGHT_ACTION =
  "inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-sky-800 shadow-sm ring-1 ring-sky-300 transition hover:bg-sky-100 hover:ring-sky-400 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-700 dark:hover:bg-sky-900/50";
const FLIGHT_ACTION_ON =
  "inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-3 py-1.5 text-sm font-semibold text-sky-900 shadow-sm ring-1 ring-sky-400 transition hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-100 dark:ring-sky-600 dark:hover:bg-sky-900/70";
