"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { centsToDisplay, currencySymbol, formatMoneyWhole } from "@/lib/money";
import { deleteTravelStay, saveTravelStay, setTravelStayCancelled } from "./actions";
import { BrandPicker } from "./brand-picker";
import { TripPicker, useTripChoice } from "./trip-picker";
import {
  CurrencySelect, PlanSpentFields, PlannedPointsNote, isPlannedOnly, outsideTripNote, spentMissingError,
  type PlanSpent,
} from "./travel-form";
import type { Embed, SectionHandle } from "./embedded-section";
import { addDays } from "./trip-summary";
import type { TravelBrand, TravelCard, TravelStay, TravelTrip } from "./types";
import { formatCentsPerPoint, microsToCentsField } from "./points-value";
import { PaymentPrompt, useAddPayment, useLinkedPayments } from "./linked-payments";
import { spentTypedByHand, stayCashToPay, type PaymentPrefill } from "./payment-due";

const NO_CARD = "";

// The rate is read at four decimals and stored at six — see the field's own
// note in the form below.
const rateDisplay = (micros: number) => microsToCentsField(micros);
const rateExact = (micros: number) => microsToCentsField(micros, 4);

export function StayModal({
  stay,
  cards,
  brands,
  currency,
  defaultAccountId,
  trips,
  defaultTripId,
  embed,
  roomOf,
  allowRooms,
  siblings,
  roomNo,
  onBack,
  onClose,
}: {
  stay: TravelStay | null;
  /** The hotel's other reservations (its other rooms, or other nights of a
   *  room), shown as sections under this one so the hotel is edited as a whole. */
  siblings?: TravelStay[];
  /** Embedded as one of a hotel's rooms: the room the section above it picked. */
  roomNo?: number | null;
  /** A new stay started as another room of this one: same hotel, city, dates,
   *  trip and brand; cost, points, card and pax left for the new room. */
  roomOf?: TravelStay | null;
  /** Offers "+ Add another room" on a saved stay: each room opens as its own
   *  section under this one and saves with it. */
  allowRooms?: boolean;
  /** Returns to the stay this form was opened from, instead of closing. */
  onBack?: () => void;
  /** Omitted where the form opens outside the Travel Log (a card's panel):
   *  no picker is shown and saving leaves the stay's trip as it was. */
  trips?: TravelTrip[];
  defaultTripId?: string | null;
  cards: TravelCard[];
  brands: TravelBrand[];
  currency: string;
  // Opened from a card's own panel on Accounts, the card is already known —
  // it starts selected, with the same fill-in a manual pick would do.
  defaultAccountId?: string;
  /** Shown as a section of the Add Travel Log popup — see embedded-section. */
  embed?: Embed;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Clicking the locked Spent box opens the payment behind it.
  const linked = useLinkedPayments(stay?.payments, currency);
  const [ownTrip, setTrip] = useTripChoice(stay ? stay.tripId : roomOf ? roomOf.tripId : defaultTripId);
  const trip = embed ? embed.trip : ownTrip;
  const formRef = useRef<HTMLFormElement>(null);
  // The popup's save button reads the form as it stands and posts it.
  useEffect(() => {
    if (!embed) return;
    embed.register({
      isEmpty: () => {
        if (!formRef.current) return true;
        const fd = new FormData(formRef.current);
        // Anything picked or typed counts, so a card chosen without a hotel
        // name gets "Enter the hotel name" rather than "nothing to add".
        return [
          "propertyName", "city", "reservedOn", "checkIn", "pax", "brand", "accountId", "cardLabel", "holder",
          "freeNightPoints", "pointsCost", "pointsValueCents", "hotelCost", "pocketCost", "plannedCost", "plannedCostForeign", "spentForeign", "hotelCredit", "remarks",
        ].every((k) => !String(fd.get(k) ?? "").trim());
      },
      save: async () => {
        if (!formRef.current) return { error: null };
        if (spentError) return { error: spentError };
        const result = await saveTravelStay(new FormData(formRef.current));
        return { error: result?.error ?? null, payments: result?.payment ? [result.payment] : [] };
      },
      copyForRoom: () => currentAsRoom(),
    });
  });
  function currentAsRoom(): TravelStay {
        const fd = formRef.current ? new FormData(formRef.current) : new FormData();
        const text = (k: string) => String(fd.get(k) ?? "").trim();
        return {
          id: "", tripId: null, accountId: null, cardLabel: null, holder: null,
          propertyName: text("propertyName"),
          city: text("city") || null,
          brand: brand || null,
          bookingChannel: null,
          reservedOn: reservedOn || null,
          checkIn,
          nights: Number(text("nights")) || 1,
          pax: null, pointsCost: 0, pointsUsed: false, pointsValueMicros: null,
          hotelCreditCents: 0, hotelCostCents: 0, pocketCostCents: 0, pocketPaidWith: "card",
          remarks: null, breakfastIncluded: false, cancelledAt: null, rewardActivityId: null,
          freeNightUsed: false, isEstimate, plannedCostCents: null, freeNightPoints: null,
          plannedCostForeignCents: null, costForeignCents: null, foreignCurrency,
          movesCardPoints: true,
          // A second room is often paid a different way (points, a free
          // night), so how it's paid and its cancel date start fresh.
          payAtProperty: false, freeCancelUntil: null, roomNo: null,
        };
  }
  // Extra rooms added under a saved stay, each its own embedded stay form.
  const formId = useId();
  const [rooms, setRooms] = useState<{ id: number; roomOf: TravelStay | null; stay: TravelStay | null; roomNo: number }[]>(() =>
    (siblings ?? []).map((s, i) => ({ id: i + 1, roomOf: null, stay: s, roomNo: s.roomNo ?? 2 })),
  );
  // This reservation's room, picked in its band once the hotel has more than one.
  const [mainRoom, setMainRoom] = useState(stay?.roomNo ?? 1);
  const roomHandles = useRef<Record<number, SectionHandle | null>>({});
  const [accountId, setAccountId] = useState(stay?.accountId ?? defaultAccountId ?? NO_CARD);
  const preset = defaultAccountId ? cards.find((c) => c.id === defaultAccountId) ?? null : null;
  const [holder, setHolder] = useState(stay?.holder ?? (stay ? "" : preset?.holder ?? ""));
  // What a second room shares with the first; everything else starts empty.
  const base = stay ?? roomOf ?? null;
  const [brand, setBrand] = useState(base?.brand ?? "");
  const [points, setPoints] = useState(stay?.pointsCost ? String(stay.pointsCost) : "");
  // Whether the points figure is a redemption or a what-if. A new stay starts
  // unticked — nothing leaves a card until "Pts used" is ticked on purpose.
  const [pointsUsed, setPointsUsed] = useState(stay ? stay.pointsUsed : false);
  // Paid with the card's free-night certificate instead. The two are
  // exclusive: ticking one unticks the other.
  const [freeNightUsed, setFreeNightUsed] = useState(stay?.freeNightUsed ?? false);
  const [freeNightPoints, setFreeNightPoints] = useState(
    stay?.freeNightPoints ? String(stay.freeNightPoints) : preset?.freeNightPointsLimit ? String(preset.freeNightPointsLimit) : "",
  );
  const storedMicros = stay?.pointsValueMicros ?? (stay ? null : preset?.pointsValueMicros ?? null);
  const [pointsValue, setPointsValue] = useState(() =>
    storedMicros ? rateDisplay(storedMicros) : "",
  );
  // A rate typed by hand wins over the calculated one and is never overwritten.
  // A rate that only came from the card's stored valuation is a placeholder:
  // the room in front of you prices its own points better than the card's
  // average does.
  const [rateEdited, setRateEdited] = useState(Boolean(stay?.pointsValueMicros));
  // A zero reads as a real number you have to clear before typing, so an
  // unset amount stays blank and only a saved non-zero value is filled in.
  const money = (cents: number | undefined) => (cents ? centsToDisplay(cents) : "");
  const [hotelCredit, setHotelCredit] = useState(money(stay?.hotelCreditCents));
  // The two dates are held so the form can say, while you type, that the
  // check-in lands before the booking — almost always last year's year typed
  // by mistake. The server refuses it too; this just catches it sooner.
  const [reservedOn, setReservedOn] = useState(base?.reservedOn ?? "");
  const [checkIn, setCheckIn] = useState(base?.checkIn ?? "");
  const datesOutOfOrder = Boolean(reservedOn && checkIn && checkIn < reservedOn);
  // Nights is what's saved; Check-out is worked out from it, and picking a
  // check-out date sets the nights. A new check-in keeps the nights, so the
  // check-out moves with it.
  const [nights, setNights] = useState(String(base?.nights ?? 1));
  const nightsCount = Number(nights) >= 1 ? Math.floor(Number(nights)) : null;
  const checkOut = checkIn && nightsCount ? addDays(checkIn, nightsCount) : "";
  function pickCheckOut(value: string) {
    if (!value || !checkIn) return;
    const count = Math.round((Date.parse(value) - Date.parse(checkIn)) / 86_400_000);
    if (count >= 1) setNights(String(count));
  }
  // Live totals so the saving is visible while typing, not only after saving.
  const [hotelCost, setHotelCost] = useState(money(stay?.hotelCostCents));
  // Planned and Spent side by side. Spent is what left the wallet (the
  // pocket cost). A stay still planned keeps its plan in the pocket column
  // too; here it shows only under Planned.
  const [fig, setFig] = useState<PlanSpent>(() => ({
    planned: money((stay?.isEstimate ? stay.pocketCostCents : stay?.plannedCostCents) ?? undefined),
    plannedForeign: money((stay?.isEstimate ? stay.costForeignCents : stay?.plannedCostForeignCents) ?? undefined),
    // Linked transactions are the spent figure once there are any.
    spent: stay?.paidCents != null ? money(stay.paidCents) : stay?.isEstimate ? "" : money(stay?.pocketCostCents),
    spentForeign: stay?.isEstimate ? "" : money(stay?.costForeignCents ?? undefined),
  }));
  // Blank is None: dollars only.
  const [foreignCurrency, setForeignCurrency] = useState(base?.foreignCurrency ?? "");
  // The hotel takes the card at check-in, and the last day to cancel free.
  const [payAtProperty, setPayAtProperty] = useState(stay?.payAtProperty ?? false);
  const [freeCancelUntil, setFreeCancelUntil] = useState(stay?.freeCancelUntil ?? "");
  // Spent is the linked transactions only, except on a sheet import or a
  // stay booked before the app — see payment-due.
  const hasPaid = stay?.paidCents != null;
  const typedSpent = spentTypedByHand(stay ? !stay.movesCardPoints : false, reservedOn);
  const spentLocked = hasPaid || !typedSpent;
  // Locked with nothing linked, Spent is empty: a figure typed before the
  // lock is no payment.
  const shownFig = spentLocked && !hasPaid ? { ...fig, spent: "" } : fig;
  // Booked once a Spent figure or the booking date is in; a plan until then.
  const isEstimate = isPlannedOnly(Boolean(shownFig.spent.trim() || (typedSpent && shownFig.spentForeign.trim())), reservedOn);
  const pocketCost = isEstimate ? fig.planned : shownFig.spent;
  // Booked with cash to pay and no transaction yet: said in red under Spent.
  const due = !isEstimate && !stay?.cancelledAt && !hasPaid && !typedSpent &&
    stayCashToPay({ pointsUsed, freeNightUsed, payAtProperty, checkIn });
  const pay = useAddPayment();
  const tripNote = outsideTripNote(trips, trip.tripId, [checkIn]);
  const spentError = spentMissingError({
    reservedOn,
    spentTyped: Boolean(fig.spent.trim() || fig.spentForeign.trim()),
    exempt: pointsUsed || freeNightUsed || payAtProperty || spentLocked,
    dateLabel: "Reservation Made",
    alsoTry: "Paying at the hotel? Select Pay at check-in.",
  });

  const card = cards.find((c) => c.id === accountId) ?? null;

  // Picking a card fills in what the card already knows — its owner and its
  // cents-per-point valuation — so the same stay isn't typed twice. Fields you
  // have already filled in are left alone.
  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId) ?? null;
    if (!next) return;
    if (!holder.trim() && next.holder) setHolder(next.holder);
    if (!freeNightPoints.trim() && next.freeNightPointsLimit) setFreeNightPoints(String(next.freeNightPointsLimit));
    if (!pointsValue.trim() && next.pointsValueMicros) {
      setPointsValue(rateDisplay(next.pointsValueMicros));
      setExactRate(rateExact(next.pointsValueMicros));
    }
  }
  const pointsTyped = Number(points) || 0;
  // What this room prices its points at: cash rate / points. The same sum the
  // redemption calculators do — it answers "is this a good use of points"
  // whether or not the points were actually spent.
  const hotelCentsTyped = Math.round((Number(hotelCost.replace(/[$,\s]/g, "")) || 0) * 100);
  const impliedMicros =
    pointsTyped > 0 && hotelCentsTyped > 0
      ? Math.round((hotelCentsTyped / pointsTyped) * 10_000)
      : null;
  // Four decimals is as fine as the rate is ever *read* — $0.0062/pt, i.e.
  // 0.62¢ — so that is what the field shows. What gets saved keeps the full
  // six, because the rounding is worth $3.60 on a 78,000-point stay and every
  // cash value downstream is computed from the stored figure.
  const microsToField = rateDisplay;
  const microsToExact = rateExact;
  useEffect(() => {
    if (rateEdited || impliedMicros == null) return;
    setPointsValue(microsToField(impliedMicros));
    setExactRate(microsToExact(impliedMicros));
  }, [rateEdited, impliedMicros]);
  // The sum stays on screen until it has been taken. Once "use it" applies a
  // figure, the note has said everything it had to say — it comes back only if
  // the points or the room rate move and there is a new sum to show.
  const [rateTakenAt, setRateTakenAt] = useState<number | null>(null);
  const showRateHint = impliedMicros != null && rateTakenAt !== impliedMicros;
  // The unrounded figure behind a calculated rate. Null once the rate is typed
  // by hand — then what was typed is exactly what is meant, and is saved as-is.
  const [exactRate, setExactRate] = useState<string | null>(
    storedMicros ? rateExact(storedMicros) : null,
  );
  const overAllotment =
    card?.freeNightPointsLimit && pointsTyped > card.freeNightPointsLimit
      ? pointsTyped - card.freeNightPointsLimit
      : 0;
  // What saving will move on the linked card: the difference between what the
  // stay already draws and what the form now says. Negative = comes off the
  // card, positive = handed back.
  const creditTyped = Math.round((Number(hotelCredit.replace(/[$,\s]/g, "")) || 0) * 100);
  // Points the card has actually lent this stay — none of them, on a stay
  // whose points figure is a what-if, so the preview matches what saving does.
  // An imported stay never took points off a card, so saving it moves none.
  // A planned stay has drawn nothing and draws nothing.
  const alreadyDrawn = stay && !stay.cancelledAt && !stay.isEstimate && stay.accountId === accountId
    ? { points: stay.pointsUsed ? stay.pointsCost : 0, credit: stay.hotelCreditCents }
    : { points: 0, credit: 0 };
  // A cancelled stay draws nothing until it is restored.
  const draw = card && (!stay || stay.movesCardPoints) && !stay?.cancelledAt
    ? {
        points: (pointsUsed && !isEstimate ? pointsTyped : 0) - alreadyDrawn.points,
        credit: (isEstimate ? 0 : creditTyped) - alreadyDrawn.credit,
      }
    : null;

  // No hotel cost typed: the room cost what was paid, so nothing was saved
  // (see hotelCents in types).
  const pocketCents = Math.round((Number(pocketCost.replace(/[$,\s]/g, "")) || 0) * 100);
  const saved = (Math.round((Number(hotelCost.replace(/[$,\s]/g, "")) || 0) * 100) || pocketCents) - pocketCents;

  // Saves the stay, then each added room. A saved room leaves the list, so a
  // retry after a failed one doesn't save it twice. False when anything
  // failed (the error is shown); otherwise what its payment form needs.
  async function saveAll(): Promise<PaymentPrefill | null | false> {
    if (spentError) {
      setError(spentError);
      return false;
    }
    if (!formRef.current) return false;
    setError(null);
    const result = await saveTravelStay(new FormData(formRef.current));
    if (result?.error) {
      setError(result.error);
      return false;
    }
    const failed: string[] = [];
    for (const r of rooms) {
      const handle = roomHandles.current[r.id];
      if (!handle || (!r.stay && handle.isEmpty())) continue;
      const roomResult = await handle.save();
      if (roomResult.error) failed.push(`Room ${r.roomNo}: ${roomResult.error}`);
      else setRooms((rs) => rs.filter((x) => x.id !== r.id));
    }
    // revalidatePath alone leaves the client router cache in place,
    // so the new row wouldn't appear until a manual reload.
    router.refresh();
    if (failed.length) {
      setError(failed.join(" · "));
      return false;
    }
    return result.payment ?? null;
  }

  // "Save & add transaction": the stay saves, then its payment form opens
  // on top, filled in from it. Done either way, the stay form closes —
  // what it showed is out of date.
  function saveAndPay() {
    start(async () => {
      const payment = await saveAll();
      if (payment === false) return;
      if (!payment) {
        setError("Put the stay on a trip first — its payment is linked through the trip.");
        return;
      }
      await pay.open(payment, () => {
        router.refresh();
        onClose();
      });
    });
  }

  // Pinned in the popup header (in place of the X) so they are reachable
  // without scrolling to the bottom of a long form.
  const headerButtons = (
    <>
      {/* A booking that falls through is cancelled, not deleted: it keeps
          its place in the archive and drops out of every total. */}
      {stay ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            const result = await setTravelStayCancelled(stay.id, !stay.cancelledAt);
            if (result?.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          })}
          // Red while it would cancel, so it is not clicked by mistake;
          // restoring a cancelled booking is harmless and stays neutral.
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ring-1 transition ${
            stay.cancelledAt
              ? "ring-line hover:bg-sky-50 dark:hover:bg-sky-950/40"
              : "text-negative ring-negative/60 hover:bg-negative/10"
          }`}
        >
          {stay.cancelledAt ? "Restore booking" : "Cancel booking"}
        </button>
      ) : null}
      {stay ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.set("id", stay.id);
            const result = await deleteTravelStay(fd);
            if (result?.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          })}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
        >
          Delete
        </button>
      ) : null}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="rounded-md border border-black/25 bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 disabled:opacity-60 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
        >
          ← Back
        </button>
      ) : null}
      {/* Dismisses the form. Distinct from "Cancel booking" above, which
          cancels the reservation itself. */}
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-sky-50 disabled:opacity-60 dark:hover:bg-sky-950/40"
      >
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        disabled={pending}
        className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : stay ? "Save stay" : "Add stay"}
      </button>
    
    </>
  );
  const body = (
    <div className={embed ? "" : "px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"}>
      <form
        ref={formRef}
        id={formId}
        // onSubmit, not `action` — React resets a form with an `action` prop
        // once the action returns, so a rejected save wiped every uncontrolled
        // field (hotel name, city, nights, pax, card name, remarks) and left
        // the error pointing at a form you had to retype.
        onSubmit={(e) => {
          e.preventDefault();
          if (embed) return;
          start(async () => {
            if ((await saveAll()) !== false) onClose();
          });
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {embed || stay ? (
          // Embedded, the popup owns the trip; editing, the picker is in the
          // modal header (outside this form) — either way the form posts it.
          <>
            <input type="hidden" name="tripId" value={trip.newTripName.trim() ? "" : trip.tripId} />
            <input type="hidden" name="newTripName" value={trip.newTripName} />
          </>
        ) : trips ? (
          <TripPicker trips={trips} value={trip} onChange={setTrip} startNew={!stay && !roomOf && !defaultTripId} hiddenInputs className="sm:col-span-2" />
        ) : null}
        {stay ? <input type="hidden" name="id" value={stay.id} /> : null}
        {/* With the hotel's other reservations below, this one is a room too:
            its band says which, picked by hand. Alone, it saves no room. */}
        {!embed && rooms.length > 0 ? <RoomBand room={mainRoom} onRoom={setMainRoom} className="sm:col-span-2" /> : null}
        {embed ? (
          roomNo !== undefined ? <input type="hidden" name="roomNo" value={roomNo ?? ""} /> : null
        ) : (
          <input type="hidden" name="roomNo" value={rooms.length > 0 ? mainRoom : ""} />
        )}
        {stay?.cancelledAt ? (
          <p className="sm:col-span-2 rounded-md bg-sky-100 px-3 py-2 text-xs font-semibold text-muted dark:bg-sky-900/50">
            Cancelled booking — kept in the archive, left out of every total.
          </p>
        ) : null}

        {/* Where and who it was booked through, on one row. */}
        <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
          <Field label="Hotel / Apartment Name">
            <input
              name="propertyName"
              defaultValue={base?.propertyName ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="City, State/Country">
            <input name="city" defaultValue={base?.city ?? ""} className={inputClass} />
          </Field>
          <Field label="Booked thru / Brand">
            <BrandPicker brands={brands} value={brand} onChange={setBrand} />
          </Field>
        </div>

        {/* The three dates, the two counts and the card on one row. The dates
            get the width — at a fifth each, "03/28/2027" was cut off (worse in
            Room 2's inset box); nights and pax are a number or two. Two to a
            row on a phone, the card across both. */}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-[minmax(9.5rem,1fr)_minmax(9.5rem,1fr)_minmax(9.5rem,1fr)_4rem_4.5rem_minmax(0,1.5fr)]">
          <Field label="Reservation made">
            <input
              type="date"
              name="reservedOn"
              value={reservedOn}
              onChange={(e) => setReservedOn(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Check-in date">
            <input
              type="date"
              name="checkIn"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className={`${inputClass} ${datesOutOfOrder ? "ring-2 ring-negative" : ""}`}
            />
            {datesOutOfOrder ? (
              <span className="mt-0.5 block text-[11px] font-medium text-negative">
                Before the reservation date — check the year
              </span>
            ) : tripNote ? (
              <span className="mt-0.5 block text-[11px] font-medium text-negative">{tripNote}</span>
            ) : null}
          </Field>
          <Field label="Check-out date">
            <input
              type="date"
              value={checkOut}
              min={checkIn ? addDays(checkIn, 1) : undefined}
              disabled={!checkIn}
              onChange={(e) => pickCheckOut(e.target.value)}
              aria-label="Check-out date"
              className={`${inputClass} disabled:opacity-50`}
            />
          </Field>
          <Field label="Nights" className="text-center">
            <input
              type="number"
              name="nights"
              min="1"
              step="1"
              value={nights}
              onChange={(e) => setNights(e.target.value)}
              className={`${inputClass} text-center`}
            />
          </Field>
          <Field label="Total pax" className="text-center">
            <input type="number" name="pax" min="1" step="1" defaultValue={stay?.pax ?? ""} className={`${inputClass} text-center`} />
          </Field>
          {/* What the card has left is spelled out in the strip below. */}
          <Field label="Card used" className="col-span-2 sm:col-span-1">
            <select
              name="accountId"
              value={accountId}
              onChange={(e) => pickCard(e.target.value)}
              className={inputClass}
            >
              <option value={NO_CARD}>Not linked to a card</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {/* What this card still has to spend, the moment you pick it. */}
            {card ? (
              // One line under the picker: the field is ~173px wide on desktop,
              // so the caps are short ("35k pt night cap") and anything that
              // still doesn't fit is cut with an ellipsis rather than wrapped.
              <span className="mt-1 flex min-w-0 flex-nowrap gap-x-2 overflow-hidden whitespace-nowrap text-[11px] font-semibold">
                <span className="shrink-0" style={{ color: "var(--viz-savings)" }}>
                  {card.currentPoints.toLocaleString()} pts
                </span>
                {card.freeNightCreditCents ? (
                  <span className="min-w-0 truncate" style={{ color: "var(--viz-bills)" }}>
                    {formatMoneyWhole(card.freeNightCreditCents, currency)} night credit
                  </span>
                ) : null}
                {card.freeNightPointsLimit ? (
                  <span className="min-w-0 truncate text-muted">
                    {card.freeNightPointsLimit % 1000 === 0
                      ? `${card.freeNightPointsLimit / 1000}k`
                      : card.freeNightPointsLimit.toLocaleString()}{" "}
                    pt night cap
                  </span>
                ) : card.freeNightCategoryMax ? (
                  <span className="min-w-0 truncate text-muted">
                    Cat 1&ndash;{card.freeNightCategoryMax} night
                  </span>
                ) : null}
              </span>
            ) : null}
          </Field>
        </div>

        {/* Planned beside Spent, each in dollars and the stay's other
            currency. Spent is what left the wallet. */}
        <div className="space-y-2 sm:col-span-2">
          <PlanSpentFields
            picker={<CurrencySelect value={foreignCurrency} onChange={setForeignCurrency} />}
            value={shownFig}
            onChange={setFig}
            currency={currency}
            foreignCurrency={foreignCurrency}
            spentRateDate={isEstimate ? undefined : reservedOn}
            spentLocked={spentLocked}
            onOpenSpent={linked.canOpen ? linked.open : undefined}
            spentNote={hasPaid ? undefined : null}
            showForeign={Boolean(foreignCurrency)}
          />
          {/* Nothing linked yet: log the payment from here. Inside the Add
              Trip popup it is offered once the popup has saved. Not on a
              stay paid with points or a free night — nothing is owed (cash
              taxes still go through + Transaction). */}
          {spentLocked && !hasPaid && !embed && !stay?.cancelledAt && !pointsUsed && !freeNightUsed ? (
            <PaymentPrompt due={due} busy={pending || pay.opening} error={pay.error} onAdd={saveAndPay} />
          ) : null}
          {linked.error ? <p className="text-[11px] text-negative">{linked.error}</p> : null}
          {linked.overlay}
          {pay.overlay}
          <input type="hidden" name="plannedCost" value={fig.planned} />
          <input type="hidden" name="plannedCostForeign" value={fig.plannedForeign} />
          <input type="hidden" name="pocketCost" value={shownFig.spent} />
          <input type="hidden" name="spentForeign" value={fig.spentForeign} />
          <input type="hidden" name="foreignCurrency" value={foreignCurrency} />
        </div>

        {/* Always open (Victor, 2026-10-21): a heading, not a fold. */}
        <h3 className="border-t border-line pt-3 text-xs font-bold uppercase tracking-wide sm:col-span-2">
          More details: points, credits, remarks
        </h3>

        <div className="contents">
        {/* The five figures are all short — the free-night cap, points, a
             rate, two money amounts — so they ride on one line instead of
             eating five rows of the form. Two per row at 375px. */}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-5">
          {/* A category-capped certificate (World of Hyatt) has no points
              ceiling to type — the field shows the category instead, read-only,
              and the stay saves no free-night points. */}
          {card?.freeNightCategoryMax && !card.freeNightPointsLimit && !freeNightPoints.trim() ? (
            <Field label="Free-night max" className="text-center">
              <input
                value={`Cat 1\u2013${card.freeNightCategoryMax}`}
                readOnly
                tabIndex={-1}
                className={`${inputClass} text-center ${freeNightUsed ? "" : "opacity-50"}`}
              />
            </Field>
          ) : (
          <Field label="Free-night max" className="text-center">
            <input
              type="number"
              name="freeNightPoints"
              min="0"
              step="1"
              value={freeNightPoints}
              onChange={(e) => setFreeNightPoints(e.target.value)}
              disabled={!freeNightUsed}
              // Out of the Tab order: Card owner tabs straight to Points used.
              // Still reachable by click when a free night is ticked.
              tabIndex={-1}
              placeholder={freeNightUsed ? "0" : ""}
              className={`${inputClass} text-center disabled:opacity-50`}
            />
          </Field>
          )}
          {/* Unticked labels stay as short as the ticked ones: the longer
              "Points it would've cost" wrapped to two lines and pushed its box
              below Hotel cost and Pocket cost in the same row. */}
          <Field label={pointsUsed ? "Points used" : "Pts if used"} className="text-center">
            <input
              type="number"
              name="pointsCost"
              min="0"
              step="1"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className={`${inputClass} text-center`}
            />
            {/* Whether the night fits inside the card's yearly certificate. */}
            {overAllotment > 0 ? (
              <span className="mt-0.5 block text-[11px] font-medium text-negative">
                {overAllotment.toLocaleString()} pts over the{" "}
                {card?.freeNightPointsLimit?.toLocaleString()} allotted — you pay the difference
              </span>
            ) : null}
          </Field>
          <Field label="Value per pt (¢)" className="text-center">
            <input
              value={pointsValue}
              onChange={(e) => {
                setRateEdited(true);
                setPointsValue(e.target.value);
                setExactRate(null);
              }}
              className={`${inputClass} text-center`}
            />
            {/* What actually posts: the rounded display never reaches the row. */}
            <input type="hidden" name="pointsValueCents" value={exactRate ?? pointsValue} />
            {/* The sum spelled out, in the unit the hobby speaks. Shown even
                once the rate has been typed over, so a hand-entered number can
                be read against what the room actually prices points at. */}
            {showRateHint ? (
              <span className="mt-0.5 block text-[11px] font-medium text-muted">
                <span style={{ color: "var(--viz-savings)" }}>
                  {formatCentsPerPoint(impliedMicros / 10_000)}/pt
                </span>{" "}
                = {formatMoneyWhole(hotelCentsTyped, currency)} ÷ {pointsTyped.toLocaleString()} pts
                {rateEdited && microsToField(impliedMicros) !== pointsValue.trim() ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        setRateEdited(false);
                        setPointsValue(microsToField(impliedMicros));
                        setExactRate(microsToExact(impliedMicros));
                        setRateTakenAt(impliedMicros);
                      }}
                      className="font-semibold underline"
                    >
                      use it
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </Field>

          <Field label={`Hotel cost (${currencySymbol(currency)})`} className="text-center">
            <input
              name="hotelCost"
              value={hotelCost}
              onChange={(e) => setHotelCost(e.target.value)}
              inputMode="decimal"
              className={`${inputClass} text-center`}
            />
          </Field>

          <Field label={`Hotel credit (${currencySymbol(currency)})`} className="text-center">
            <input
              name="hotelCredit"
              value={hotelCredit}
              onChange={(e) => setHotelCredit(e.target.value)}
              inputMode="decimal"
              className={`${inputClass} text-center`}
            />
          </Field>
          {/* The unlinked card's name and the card's owner are no longer typed
              here (Victor, 2026-10-21); a saved stay keeps what it had, and the
              owner still fills in from the card picked above. */}
          <input type="hidden" name="cardLabel" value={stay?.cardLabel ?? ""} />
          <input type="hidden" name="holder" value={holder} />
          <Field label="Remarks" className="col-span-2 sm:col-span-5">
            <input name="remarks" defaultValue={stay?.remarks ?? ""} className={inputClass} />
          </Field>
        </div>

        {/* How it was paid, in one row (each label on one line): free night, points, breakfast, pay at
            the hotel (Spent stays empty until the check-in charge is linked),
            and the last day to cancel without a charge. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:col-span-2">
          {/* Free night and points are either/or: ticking one clears the
              other. Ticking free night stamps the card's Booked date with this
              stay's check-in and takes no points. */}
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight sm:text-sm">
            <input
              type="checkbox"
              name="freeNightUsed"
              checked={freeNightUsed}
              onChange={(e) => {
                setFreeNightUsed(e.target.checked);
                if (e.target.checked) setPointsUsed(false);
              }}
              className="h-4 w-4 accent-sky-700"
            />
            <span className="whitespace-nowrap">Free night used</span>
          </label>
          {/* The one switch that says whether those points actually left the
              card. Unticked, the stay was paid in cash and the figure is
              only there to compare the two — it never reaches a total or
              the card's balance. */}
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight sm:text-sm">
            <input
              type="checkbox"
              name="pointsUsed"
              checked={pointsUsed}
              onChange={(e) => {
                setPointsUsed(e.target.checked);
                if (e.target.checked) setFreeNightUsed(false);
              }}
              className="h-4 w-4 accent-sky-700"
            />
            <span className="whitespace-nowrap">Pts used</span>
          </label>
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight sm:text-sm">
            <input
              type="checkbox"
              name="breakfastIncluded"
              defaultChecked={stay?.breakfastIncluded ?? false}
              className="h-4 w-4 accent-sky-700"
            />
            <span className="whitespace-nowrap">B&apos;fast incl</span>
          </label>
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight sm:text-sm">
            <input type="hidden" name="payAtPropertySent" value="1" />
            <input
              type="checkbox"
              name="payAtProperty"
              checked={payAtProperty}
              onChange={(e) => setPayAtProperty(e.target.checked)}
              className="h-4 w-4 accent-sky-700"
            />
            <span className="whitespace-nowrap">Pay at check-in</span>
          </label>
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold sm:text-sm">
            <span className="whitespace-nowrap">Cancel by</span>
            <input
              type="date"
              name="freeCancelUntil"
              value={freeCancelUntil}
              onChange={(e) => setFreeCancelUntil(e.target.value)}
              className={`${inputClass} w-40 font-normal`}
            />
          </label>
        </div>
        </div>

        <div className="sm:col-span-2 empty:hidden">
          <PlannedPointsNote
            show={isEstimate && ((pointsUsed && pointsTyped > 0) || freeNightUsed)}
            what={freeNightUsed && !(pointsUsed && pointsTyped > 0) ? "free night" : pointsUsed && freeNightUsed ? "points or free night" : "points"}
          />
        </div>
        {freeNightUsed && (card || (Number(freeNightPoints) > 0 && pointsTyped > Number(freeNightPoints))) ? (
          <p className="sm:col-span-2 -mt-1 text-xs font-medium text-muted">
            {card ? (
              <>Free night: uses <span className="font-semibold text-foreground">{card.name}</span>&apos;s night credit</>
            ) : null}
            {Number(freeNightPoints) > 0 && pointsTyped > Number(freeNightPoints) ? (
              <span className="mt-0.5 block text-negative">
                The room ({pointsTyped.toLocaleString()} pts) is over the free-night max.
              </span>
            ) : null}
          </p>
        ) : null}

        {/* Above the buttons, not below them. Rendered after the footer row
            it sat ~4px under the fold on a 375x812 phone, so a blocked save
            looked like a dead button. */}

        {draw && (draw.points !== 0 || draw.credit !== 0) ? (
          <p className="sm:col-span-2 text-xs font-medium text-foreground">
            {draw.points ? "Points" : "Night credit"}:{" "}
            {[
              draw.points ? `${Math.abs(draw.points).toLocaleString()} pts` : null,
              draw.credit ? `${formatMoneyWhole(Math.abs(draw.credit), currency)} night credit` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            {draw.points < 0 || draw.credit < 0 ? "back to" : "off"} <span className="font-semibold">{card?.name}</span>
          </p>
        ) : null}
      </form>
      {rooms.map((r) => (
        // Each added room is its own boxed section with a heading band — as a
        // bold "Room 2" over a thin line it was easy to miss in the form.
        <div key={r.id} className="mt-5 overflow-hidden rounded-xl ring-1 ring-line">
          <RoomBand
            room={r.roomNo}
            onRoom={(n) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, roomNo: n } : x)))}
            action={
            // A saved reservation is cancelled or deleted from its own form;
            // only one being added here can be dropped.
            r.stay ? null : (
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
            )
            }
          />
          <div className="px-4 py-3">
          <StayModal
            stay={r.stay}
            roomOf={r.roomOf}
            roomNo={r.roomNo}
            cards={cards}
            brands={brands}
            currency={currency}
            embed={{
              trip,
              register: (handle) => {
                roomHandles.current[r.id] = handle;
              },
            }}
            onClose={onClose}
          />
          </div>
        </div>
      ))}
        {embed ? null : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {/* Hotel cost less pocket cost: what points, credits and free
                nights took off the bill — not Planned less Spent, which a bare
                "Saved" was read as. */}
            Saved with points & credits{" "}
            <span className="font-bold tabular-nums text-positive">{formatMoneyWhole(saved, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* A family of five books two rooms: the second starts as a copy of
                this one's hotel, dates and trip, saved as its own stay so it
                can go on a different card, points or a free night. */}
            {stay && allowRooms ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  setRooms((rs) => [
                    ...rs,
                    {
                      id: Math.max(0, ...rs.map((x) => x.id)) + 1,
                      roomOf: currentAsRoom(),
                      stay: null,
                      // The next room up; a further night of a room already
                      // here is set back to that room in its band.
                      roomNo: Math.min(9, Math.max(mainRoom, ...rs.map((x) => x.roomNo)) + 1),
                    },
                  ])
                }
                className="rounded-md border border-black/25 bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
              >
                + Add another room
              </button>
            ) : null}
          </div>
        </div>
        )}
    </div>
  );
  return embed ? body : (
    <ModalShell
      title={stay ? "Edit stay" : roomOf ? `Add another room · ${roomOf.propertyName}` : "Add stay"}
      onClose={onClose}
      // Wider than the default, so the date boxes show their full dates.
      className="sm:max-w-4xl"
      headerEnd={headerButtons}
      headerNotice={error && !embed ? <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p> : null}
      headerActions={stay && trips ? <TripPicker trips={trips} value={trip} onChange={setTrip} inHeader /> : undefined}
    >
      {body}
    </ModalShell>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500";

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

// A room's heading inside the stay form: the white band with a teal bar used
// for group headings on Travel, so Room 1, Room 2… stand out from the fields.
// The room is picked here, by hand: a room booked night by night (a free night,
// then a points night) is several reservations with the same room number.
export function RoomBand({
  room,
  onRoom,
  action,
  className = "",
}: {
  room: number;
  onRoom: (room: number) => void;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    // A soft teal fill under the teal bar, so each room's section stands
    // apart from the fields around it.
    <div className={`flex items-center justify-between gap-2 border-l-[6px] border-l-teal-600 bg-teal-50 px-4 py-2 ring-1 ring-teal-200 dark:border-l-teal-400 dark:bg-teal-950/40 dark:ring-teal-800 ${className}`}>
      <label className="flex items-center gap-2 text-base font-extrabold text-foreground">
        Room
        <select
          value={room}
          onChange={(e) => onRoom(Number(e.target.value))}
          aria-label="Room"
          className="rounded-md bg-background px-2 py-0.5 text-base font-extrabold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      {action}
    </div>
  );
}
