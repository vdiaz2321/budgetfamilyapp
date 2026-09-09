"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { deleteTravelStay, saveTravelStay, setTravelStayCancelled } from "./actions";
import { BrandPicker } from "./brand-picker";
import type { TravelBrand, TravelCard, TravelStay } from "./types";

const NO_CARD = "";

// The rate is read at four decimals and stored at six — see the field's own
// note in the form below.
const rateDisplay = (micros: number) => String(Number((micros / 1_000_000).toFixed(4)));
const rateExact = (micros: number) => String(Number((micros / 1_000_000).toFixed(6)));

export function StayModal({
  stay,
  cards,
  brands,
  currency,
  defaultAccountId,
  onClose,
}: {
  stay: TravelStay | null;
  cards: TravelCard[];
  brands: TravelBrand[];
  currency: string;
  // Opened from a card's own panel on Accounts, the card is already known —
  // it starts selected, with the same fill-in a manual pick would do.
  defaultAccountId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(stay?.accountId ?? defaultAccountId ?? NO_CARD);
  const preset = defaultAccountId ? cards.find((c) => c.id === defaultAccountId) ?? null : null;
  const [holder, setHolder] = useState(stay?.holder ?? (stay ? "" : preset?.holder ?? ""));
  const [brand, setBrand] = useState(stay?.brand ?? "");
  const [points, setPoints] = useState(stay?.pointsCost ? String(stay.pointsCost) : "");
  // Whether the points figure is a redemption or a what-if. A new stay that
  // records points is assumed to have spent them; unticking it turns the
  // figure into "this is what it would have cost on points".
  const [pointsUsed, setPointsUsed] = useState(stay ? stay.pointsUsed : true);
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
  // Live totals so the saving is visible while typing, not only after saving.
  const [hotelCost, setHotelCost] = useState(money(stay?.hotelCostCents));
  const [pocketCost, setPocketCost] = useState(money(stay?.pocketCostCents));

  const card = cards.find((c) => c.id === accountId) ?? null;

  // Picking a card fills in what the card already knows — its owner and its
  // cents-per-point valuation — so the same stay isn't typed twice. Fields you
  // have already filled in are left alone.
  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId) ?? null;
    if (!next) return;
    if (!holder.trim() && next.holder) setHolder(next.holder);
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
  const alreadyDrawn = stay && !stay.cancelledAt && stay.accountId === accountId
    ? { points: stay.pointsUsed ? stay.pointsCost : 0, credit: stay.hotelCreditCents }
    : { points: 0, credit: 0 };
  const draw = card
    ? {
        points: (pointsUsed ? pointsTyped : 0) - alreadyDrawn.points,
        credit: creditTyped - alreadyDrawn.credit,
      }
    : null;

  const saved =
    Math.round((Number(hotelCost.replace(/[$,\s]/g, "")) || 0) * 100) -
    Math.round((Number(pocketCost.replace(/[$,\s]/g, "")) || 0) * 100);

  return (
    <ModalShell title={stay ? "Edit stay" : "Add stay"} onClose={onClose}>
      <form
        action={(formData) => start(async () => {
          setError(null);
          const result = await saveTravelStay(formData);
          if (result?.error) setError(result.error);
          else {
            // revalidatePath alone leaves the client router cache in place,
            // so the new row wouldn't appear until a manual reload.
            router.refresh();
            onClose();
          }
        })}
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        {stay ? <input type="hidden" name="id" value={stay.id} /> : null}
        {stay?.cancelledAt ? (
          <p className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 text-xs font-semibold text-muted dark:bg-white/10">
            Cancelled booking — kept in the archive, left out of every total.
          </p>
        ) : null}

        <Field label="Hotel / Apartment Name">
          <input
            name="propertyName"
            defaultValue={stay?.propertyName ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="City, State/Country">
          <input name="city" defaultValue={stay?.city ?? ""} className={inputClass} />
        </Field>

        {/* The two dates and the two counts on one row — none of the four
             needs more than a quarter of the form. Two per row at 375px. */}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
          <Field label="Reservation made">
            <input type="date" name="reservedOn" defaultValue={stay?.reservedOn ?? ""} className={inputClass} />
          </Field>
          <Field label="Check-in date">
            <input type="date" name="checkIn" defaultValue={stay?.checkIn ?? ""} className={inputClass} />
          </Field>
          <Field label="Nights">
            <input type="number" name="nights" min="1" step="1" defaultValue={stay?.nights ?? 1} className={inputClass} />
          </Field>
          <Field label="Total pax">
            <input type="number" name="pax" min="1" step="1" defaultValue={stay?.pax ?? ""} className={inputClass} />
          </Field>
        </div>

        {/* How it was booked and on what: the brand, the card, the card's name
             when it isn't linked, and whose it is. */}
        <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-4">
          <Field label="Booked thru / Brand">
            <BrandPicker brands={brands} value={brand} onChange={setBrand} />
          </Field>
          {/* What the card has left is spelled out in the strip below. */}
          <Field label="Card used">
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
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-semibold">
                <span style={{ color: "var(--viz-savings)" }}>
                  {card.currentPoints.toLocaleString()} pts
                </span>
                {card.freeNightCreditCents ? (
                  <span style={{ color: "var(--viz-bills)" }}>
                    {formatMoney(card.freeNightCreditCents, currency)} night credit
                  </span>
                ) : null}
                {card.freeNightPointsLimit ? (
                  <span className="text-muted">
                    {card.freeNightPointsLimit.toLocaleString()} pt free-night cap
                  </span>
                ) : null}
              </span>
            ) : null}
          </Field>
          <Field label="Card name (if not linked)">
            <input name="cardLabel" defaultValue={stay?.cardLabel ?? ""} className={inputClass} />
          </Field>
          <Field label="Card owner">
            <input
              name="holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        {/* The five figures are all short — points, a rate, three money
             amounts — so they ride on one line instead of eating five rows
             of the form. Two per row at 375px, where five would be unreadable. */}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-5">
          <Field label={pointsUsed ? "Points used" : "Points it would've cost"}>
            <input
              type="number"
              name="pointsCost"
              min="0"
              step="1"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className={inputClass}
            />
            {/* The one switch that says whether those points actually left the
                card. Unticked, the stay was paid in cash and the figure is
                only there to compare the two — it never reaches a total or
                the card's balance. */}
            <label className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold">
              <input
                type="checkbox"
                name="pointsUsed"
                checked={pointsUsed}
                onChange={(e) => setPointsUsed(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              Pts used
            </label>
            {/* Whether the night fits inside the card's yearly certificate. */}
            {overAllotment > 0 ? (
              <span className="mt-0.5 block text-[10px] font-medium text-negative">
                {overAllotment.toLocaleString()} pts over the{" "}
                {card?.freeNightPointsLimit?.toLocaleString()} allotted — you pay the difference
              </span>
            ) : null}
          </Field>
          <Field label={pointsUsed ? "Value per point" : "Value per point (if used)"}>
            <input
              value={pointsValue}
              onChange={(e) => {
                setRateEdited(true);
                setPointsValue(e.target.value);
                setExactRate(null);
              }}
              className={inputClass}
            />
            {/* What actually posts: the rounded display never reaches the row. */}
            <input type="hidden" name="pointsValue" value={exactRate ?? pointsValue} />
            {/* The sum spelled out, in the unit the hobby speaks. Shown even
                once the rate has been typed over, so a hand-entered number can
                be read against what the room actually prices points at. */}
            {showRateHint ? (
              <span className="mt-0.5 block text-[10px] font-medium text-muted">
                <span style={{ color: "var(--viz-savings)" }}>
                  {(impliedMicros / 10_000).toFixed(2)}¢/pt
                </span>{" "}
                = {formatMoney(hotelCentsTyped, currency)} ÷ {pointsTyped.toLocaleString()} pts
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

          <Field label={`Hotel cost (${currencySymbol(currency)})`}>
            <input
              name="hotelCost"
              value={hotelCost}
              onChange={(e) => setHotelCost(e.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
          <Field label={`Pocket cost (${currencySymbol(currency)})`}>
            <input
              name="pocketCost"
              value={pocketCost}
              onChange={(e) => setPocketCost(e.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>

          <Field label={`Hotel credit used (${currencySymbol(currency)})`}>
            <input
              name="hotelCredit"
              value={hotelCredit}
              onChange={(e) => setHotelCredit(e.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
        </div>

        {/* The flag sits beside the note it used to be written inside — the
            log's B'fast column and filter read it instead of the text. */}
        <div className="flex items-end gap-3 sm:col-span-2">
          <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight">
            <input
              type="checkbox"
              name="breakfastIncluded"
              defaultChecked={stay?.breakfastIncluded ?? false}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            {/* Two short lines rather than one long one, so the note beside it
                keeps the width. */}
            <span>
              B&apos;fast
              <br />
              incl
            </span>
          </label>
          <Field label="Remarks" className="min-w-0 flex-1">
            <input name="remarks" defaultValue={stay?.remarks ?? ""} className={inputClass} />
          </Field>
        </div>

        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Saved on this stay{" "}
            <span className="font-bold tabular-nums text-positive">{formatMoney(saved, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
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
            {/* Dismisses the form. Distinct from "Cancel booking" above, which
                cancels the reservation itself. */}
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
              {pending ? "Saving…" : stay ? "Save stay" : "Add stay"}
            </button>
          </div>
        </div>
        {error ? <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p> : null}
        {draw && (draw.points !== 0 || draw.credit !== 0) ? (
          <p className="sm:col-span-2 text-[11px] text-muted">
            Saving {draw.points < 0 || draw.credit < 0 ? "returns" : "takes"}{" "}
            {[
              draw.points ? `${Math.abs(draw.points).toLocaleString()} pts` : null,
              draw.credit ? `${formatMoney(Math.abs(draw.credit), currency)} night credit` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            {draw.points < 0 || draw.credit < 0 ? "to" : "from"} {card?.name} on Accounts.
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

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
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
