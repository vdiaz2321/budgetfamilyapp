"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CurrencyConverter, type ConvertedFrom } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, displayToCents, formatMoney } from "@/lib/money";
import {
  addTraveller,
  deleteTraveller,
  deleteTravelFlight,
  renameTraveller,
  saveTravelFlight,
  setTravelFlightCancelled,
} from "./flight-actions";
import { Field, Section, inputClass } from "./travel-form";
import { TripPicker, useTripChoice } from "./trip-picker";
import type { Embed } from "./embedded-section";
import type { TravelCard, TravelFlight, TravelTrip, Traveller } from "./types";

type LegDraft = {
  key: number;
  flightOn: string;
  flightNumber: string;
  fromPlace: string;
  toPlace: string;
  departsAt: string;
  arrivesAt: string;
};
type PassengerDraft = { key: number; travellerId: string | null; name: string; fare: string; fareEur: string; pointsUsed: boolean; points: string };

let nextKey = 1;
const emptyLeg = (from = "", to = ""): LegDraft => ({
  key: nextKey++, flightOn: "", flightNumber: "", fromPlace: from, toPlace: to, departsAt: "", arrivesAt: "",
});
const emptyPassenger = (): PassengerDraft => ({ key: nextKey++, travellerId: null, name: "", fare: "", fareEur: "", pointsUsed: false, points: "" });

const rateDisplay = (micros: number) => String(Number((micros / 1_000_000).toFixed(4)));

export function FlightModal({
  flight,
  cards,
  travellers,
  trips,
  defaultTripId,
  currency,
  embed,
  onClose,
}: {
  flight: TravelFlight | null;
  trips: TravelTrip[];
  /** Adding from a trip's own row starts in that trip. */
  defaultTripId?: string | null;
  cards: TravelCard[];
  travellers: Traveller[];
  currency: string;
  /** Shown as a section of the Add Travel Log popup — see embedded-section. */
  embed?: Embed;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [ownTrip, setTrip] = useTripChoice(flight ? flight.tripId : defaultTripId);
  const trip = embed ? embed.trip : ownTrip;
  const [airline, setAirline] = useState(flight?.airline ?? "");
  const [bookingCode, setBookingCode] = useState(flight?.bookingCode ?? "");
  const [reservedOn, setReservedOn] = useState(flight?.reservedOn ?? "");
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
      : [emptyLeg()],
  );
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() =>
    flight?.passengers.length
      ? flight.passengers.map((p) => ({
          key: nextKey++,
          travellerId: p.travellerId,
          name: p.name,
          fare: p.fareCents ? centsToDisplay(p.fareCents) : "",
          fareEur: p.fareEurCents != null ? centsToDisplay(p.fareEurCents) : "",
          pointsUsed: p.pointsUsed,
          points: p.pointsCost ? String(p.pointsCost) : "",
        }))
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
  // Blank means "the cash tickets' fares". A saved figure that differs from
  // that (taxes added on an award ticket) shows.
  const [pocketCost, setPocketCost] = useState(() => {
    if (!flight) return "";
    const cashFares = flight.passengers.reduce((sum, p) => sum + (p.pointsUsed ? 0 : p.fareCents), 0);
    return flight.pocketCostCents !== cashFares ? centsToDisplay(flight.pocketCostCents) : "";
  });
  const [remarks, setRemarks] = useState(flight?.remarks ?? "");
  const [editingNames, setEditingNames] = useState(false);

  // The fare the currency converter fills: the one last clicked into, or else
  // the first one still empty.
  const lastFareKey = useRef<number | null>(null);

  const card = cards.find((c) => c.id === accountId) ?? null;
  const fareCents = passengers.reduce((sum, p) => sum + Math.max(0, displayToCents(p.fare)), 0);
  const passengerPoints = (p: PassengerDraft) => (p.pointsUsed ? Number(p.points.replace(/,/g, "")) || 0 : 0);
  // Points on the booking are its points tickets added up; the fares of those
  // tickets are what the points bought, which is how they are valued.
  const pointsTyped = passengers.reduce((sum, p) => sum + passengerPoints(p), 0);
  const pointsFareCents = passengers.reduce(
    (sum, p) => sum + (passengerPoints(p) > 0 ? Math.max(0, displayToCents(p.fare)) : 0),
    0,
  );
  const pointsUsed = pointsTyped > 0;
  const impliedMicros = pointsTyped > 0 && pointsFareCents > 0 ? Math.round((pointsFareCents / pointsTyped) * 10_000) : null;
  const pocketCents = pocketCost.trim() ? displayToCents(pocketCost) : fareCents - pointsFareCents;
  const datesOutOfOrder = Boolean(reservedOn && legs[0]?.flightOn && legs.some((l) => l.flightOn && l.flightOn < reservedOn));

  // What saving moves on the card, same preview the stay form gives.
  const alreadyDrawn = flight && !flight.cancelledAt && flight.pointsUsed && flight.accountId === accountId ? flight.pointsCost : 0;
  // A flight imported from the sheet never moves a card, so it previews nothing.
  const draw = card && (!flight || flight.movesCardPoints) ? (pointsUsed ? pointsTyped : 0) - alreadyDrawn : 0;

  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId);
    if (!next) return;
    if (!holder.trim() && next.holder) setHolder(next.holder);
  }

  const updateLeg = (key: number, patch: Partial<LegDraft>) =>
    setLegs((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updatePassenger = (key: number, patch: Partial<PassengerDraft>) =>
    setPassengers((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function setPassengerCount(raw: string) {
    const count = Math.min(12, Math.max(1, Math.trunc(Number(raw)) || 1));
    setPassengers((all) =>
      count > all.length
        ? [...all, ...Array.from({ length: count - all.length }, emptyPassenger)]
        : all.slice(0, count),
    );
  }

  // A euro receipt keeps its euros beside the dollars it converted to.
  function applyConverted(cents: number, from: ConvertedFrom) {
    const target =
      passengers.find((p) => p.key === lastFareKey.current) ?? passengers.find((p) => !p.fare.trim()) ?? passengers[0];
    if (target) {
      updatePassenger(target.key, {
        fare: centsToDisplay(cents),
        ...(from.currency === "EUR" ? { fareEur: centsToDisplay(from.amountCents) } : {}),
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
        pointsValue,
        pocketCost,
        remarks,
        legs: legs.map((l) => ({
          flightOn: l.flightOn, flightNumber: l.flightNumber, fromPlace: l.fromPlace,
          toPlace: l.toPlace, departsAt: l.departsAt, arrivesAt: l.arrivesAt,
        })),
        passengers: passengers.map((p) => ({
          travellerId: p.travellerId, name: p.name, fare: p.fare, fareEur: p.fareEur, pointsUsed: p.pointsUsed, points: p.points,
        })),
  });

  useEffect(() => {
    if (!embed) return;
    embed.register({
      isEmpty: () =>
        ![airline, bookingCode, reservedOn, cardLabel, pocketCost, remarks].some((v) => v.trim()) &&
        legs.every((l) => ![l.flightOn, l.flightNumber, l.fromPlace, l.toPlace, l.departsAt, l.arrivesAt].some((v) => v.trim())) &&
        passengers.every((p) => !p.name && !p.fare.trim() && !p.fareEur.trim() && !p.points.trim()),
      save: async () => {
        const result = await saveTravelFlight(payload());
        return { error: result?.error ?? null };
      },
    });
  });

  function submit() {
    start(async () => {
      setError(null);
      const result = await saveTravelFlight(payload());
      if (result?.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!embed) submit();
        }}
        className={`grid grid-cols-1 gap-3 ${embed ? "" : "px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"}`}
      >
        {embed ? null : <TripPicker trips={trips} value={trip} onChange={setTrip} startNew={!flight && !defaultTripId} />}
        {flight?.cancelledAt ? (
          <p className="rounded-md bg-black/5 px-3 py-2 text-xs font-semibold text-muted dark:bg-white/10">
            Cancelled booking — kept on record, left out of every total.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Airline" className="col-span-2 sm:col-span-1">
            <input value={airline} onChange={(e) => setAirline(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Booking code">
            <input
              value={bookingCode}
              onChange={(e) => setBookingCode(e.target.value)}
              autoComplete="off"
              className={`${inputClass} uppercase`}
            />
          </Field>
          <Field label="Booking made">
            <input type="date" value={reservedOn} onChange={(e) => setReservedOn(e.target.value)} className={inputClass} />
          </Field>
        </div>

        {/* ---- Flights. A round trip is one booking with two of these. */}
        <Section title="Flights">
          <div className="space-y-3">
            {legs.map((leg, i) => (
              // One line per flight: the date carries the flight's name
              // ("Outbound date", "Return date"), so there is no heading row.
              <div
                key={leg.key}
                className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[9rem_5.5rem_1fr_1fr_6.5rem_6.5rem_auto]"
              >
                <Field label={`${legs.length === 1 ? "Flight" : i === 0 ? "Outbound" : legs.length === 2 ? "Return" : `Flight ${i + 1}`} date`}>
                  <input
                    type="date"
                    value={leg.flightOn}
                    onChange={(e) => updateLeg(leg.key, { flightOn: e.target.value })}
                    className={`${inputClass} ${reservedOn && leg.flightOn && leg.flightOn < reservedOn ? "ring-2 ring-negative" : ""}`}
                  />
                </Field>
                <Field label="Flight no.">
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
            ))}
            {datesOutOfOrder ? (
              <p className="text-[11px] font-medium text-negative">A flight is dated before the booking — check the year.</p>
            ) : null}
            {/* The return starts where the last flight landed. */}
            <button
              type="button"
              onClick={() => {
                const last = legs[legs.length - 1];
                setLegs((all) => [...all, emptyLeg(last?.toPlace ?? "", last?.fromPlace ?? "")]);
              }}
              className="rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              + {legs.length === 1 ? "Add return flight" : "Add another flight"}
            </button>
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
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Total
              <input
                type="number"
                min="1"
                max="12"
                step="1"
                value={passengers.length}
                onChange={(e) => setPassengerCount(e.target.value)}
                className={`${inputClass} w-16`}
              />
            </label>
            <div className="has-[.rounded-xl]:order-last has-[.rounded-xl]:basis-full">
              <CurrencyConverter onUse={applyConverted} />
            </div>
            <button
              type="button"
              onClick={() => setEditingNames((v) => !v)}
              className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              {editingNames ? "Done editing names" : "Edit family names"}
            </button>
          </div>

          {editingNames ? <TravellerEditor travellers={travellers} /> : null}

          <ul className="space-y-2">
            {passengers.map((p, i) => (
              <li
                key={p.key}
                className="grid grid-cols-[minmax(0,1fr)_5.25rem_5.25rem_auto] items-end gap-2 sm:grid-cols-[minmax(0,12rem)_6.5rem_6.5rem_auto_6.5rem_auto]"
              >
                <Field label={`Passenger ${i + 1}`}>
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
                </Field>
                <Field label={`Fare (${currencySymbol(currency)})`}>
                  <input
                    value={p.fare}
                    onChange={(e) => updatePassenger(p.key, { fare: e.target.value })}
                    onFocus={() => (lastFareKey.current = p.key)}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </Field>
                <Field label="Fare (€)">
                  <input
                    value={p.fareEur}
                    onChange={(e) => updatePassenger(p.key, { fareEur: e.target.value })}
                    onFocus={() => (lastFareKey.current = p.key)}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </Field>
                <button
                  type="button"
                  disabled={passengers.length === 1}
                  onClick={() => setPassengers((all) => all.filter((x) => x.key !== p.key))}
                  aria-label={`Remove passenger ${i + 1}`}
                  className="mb-0.5 justify-self-end rounded-md px-2 py-1.5 text-sm font-semibold text-muted transition hover:bg-negative/10 hover:text-negative disabled:invisible sm:order-last sm:justify-self-start"
                >
                  ✕
                </button>
                {/* Points: under the name on a phone, on the same line on a
                    wide screen. The box only appears once it is ticked. */}
                <label className="col-span-2 mb-1.5 flex items-center gap-1.5 text-xs font-semibold sm:col-span-1">
                  <input
                    type="checkbox"
                    checked={p.pointsUsed}
                    onChange={(e) => updatePassenger(p.key, { pointsUsed: e.target.checked })}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  Paid with points
                </label>
                {p.pointsUsed ? (
                  <Field label="Points" className="col-span-2 sm:col-span-1">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={p.points}
                      onChange={(e) => updatePassenger(p.key, { points: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </li>
            ))}
          </ul>
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
            {card ? (
              <span className="mt-1 block text-[10px] font-semibold" style={{ color: "var(--viz-savings)" }}>
                {card.currentPoints.toLocaleString()} pts
              </span>
            ) : null}
          </Field>
          <Field label="Card used (if not linked)">
            <input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Card owner">
            <input value={holder} onChange={(e) => setHolder(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Points used">
            {/* The points tickets above, added up. */}
            <input value={pointsTyped ? pointsTyped.toLocaleString() : ""} readOnly tabIndex={-1} className={`${inputClass} opacity-70`} />
          </Field>
          <Field label="Value per pt">
            <input
              value={pointsValue}
              onChange={(e) => setPointsValue(e.target.value)}
              placeholder={impliedMicros ? rateDisplay(impliedMicros) : ""}
              inputMode="decimal"
              className={inputClass}
            />
            {impliedMicros ? (
              <span className="mt-0.5 block text-[10px] font-medium text-muted">
                <span style={{ color: "var(--viz-savings)" }}>{(impliedMicros / 10_000).toFixed(2)}¢/pt</span> ={" "}
                {formatMoney(pointsFareCents, currency)} ÷ {pointsTyped.toLocaleString()} pts
              </span>
            ) : null}
          </Field>
          <Field label={`Flight cost (${currencySymbol(currency)})`}>
            {/* The fares added up — change a fare above to change it. */}
            <input value={fareCents ? centsToDisplay(fareCents) : ""} readOnly tabIndex={-1} className={`${inputClass} opacity-70`} />
          </Field>
          <Field label={`Pocket cost (${currencySymbol(currency)})`}>
            <input
              value={pocketCost}
              onChange={(e) => setPocketCost(e.target.value)}
              placeholder={centsToDisplay(pocketCents)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3 sm:flex-nowrap">
          <Field label="Remarks" className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
          </Field>
        </div>
        </Section>

        {error && !embed ? (
          <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p>
        ) : null}

        {embed ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {passengers.length} passenger{passengers.length === 1 ? "" : "s"} · Flight cost{" "}
            <span className="font-bold tabular-nums text-foreground">{formatMoney(fareCents, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {flight ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => setTravelFlightCancelled(flight.id, !flight.cancelledAt))}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
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
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : flight ? "Save flight" : "Add flight"}
            </button>
          </div>
        </div>
        )}
        {draw !== 0 ? (
          <p className="text-[11px] text-muted">
            Saving {draw < 0 ? "returns" : "takes"} {Math.abs(draw).toLocaleString()} pts {draw < 0 ? "to" : "from"} {card?.name} on Accounts.
          </p>
        ) : null}
      </form>
  );
  return embed ? body : (
    <ModalShell title={flight ? "Edit flight" : "Add flight"} onClose={onClose} className="sm:max-w-3xl">
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
                  className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  Save
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteTraveller(t.id))}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-negative hover:bg-negative/10"
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
          className="rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 ring-line transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Add name
        </button>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-negative">{error}</p> : null}
    </div>
  );
}
