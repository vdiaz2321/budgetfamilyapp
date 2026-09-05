/**
 * What a card's points are actually worth, measured from the Travel Log
 * instead of guessed.
 *
 * Every stay records the points it cost and the rate they redeemed at
 * (the sheet's "Cash value" column), so the log already knows that Hyatt
 * points went out at 1.64¢ and Hilton points at 0.33¢. The card's own
 * `points_value_micros` was typed in once and drifts from reality — and on
 * most cards was never typed at all, which silently values those points at
 * zero on the Accounts page.
 *
 * Evidence is preferred in this order:
 *   1. stays booked on that exact card (the card is linked to the stay)
 *   2. stays on the card's own hotel programme (matched by brand name)
 * A card with neither gets no suggestion — a wrong number is worse than a
 * visibly missing one.
 */

export type StayEvidence = {
  accountId: string | null;
  brand: string | null;
  pointsCost: number;
  /** Dollars per point, in micros, as recorded on the stay. */
  pointsValueMicros: number | null;
};

export type PointsSuggestion = {
  accountId: string;
  /** Dollars per point in micros, e.g. 0.0164/pt -> 16400. */
  micros: number;
  /** Points behind the average, so a one-stay sample is visible as one. */
  points: number;
  stays: number;
  source: "card" | "brand";
  /** The brand the rate came from, when it isn't the card's own stays. */
  brand?: string;
};

type Tally = { points: number; valueMicros: number; stays: number };

const add = (map: Map<string, Tally>, key: string, stay: StayEvidence) => {
  const row = map.get(key) ?? { points: 0, valueMicros: 0, stays: 0 };
  row.points += stay.pointsCost;
  // points × dollars-per-point, kept in micros until the final divide.
  row.valueMicros += stay.pointsCost * (stay.pointsValueMicros ?? 0);
  row.stays += 1;
  map.set(key, row);
};

const rate = (t: Tally) => (t.points > 0 ? Math.round(t.valueMicros / t.points) : 0);

/**
 * A card name says which programme it earns in: "1002 Hilton Aspire Amex V"
 * is a Hilton card. Matching is on the brand name appearing in the card name,
 * and a card matching two brands is left alone.
 */
function brandForCard(cardName: string, brands: string[]): string | null {
  const name = cardName.toLowerCase();
  const hits = brands.filter((b) => b.length > 2 && name.includes(b.toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}

export function suggestPointsValues(
  cards: { id: string; name: string; currentPoints: number; pointsValueMicros: number | null }[],
  stays: StayEvidence[],
): PointsSuggestion[] {
  // Only stays that spent points AND recorded a rate can price anything.
  const priced = stays.filter((s) => s.pointsCost > 0 && (s.pointsValueMicros ?? 0) > 0);

  const byCard = new Map<string, Tally>();
  const byBrand = new Map<string, Tally>();
  for (const stay of priced) {
    if (stay.accountId) add(byCard, stay.accountId, stay);
    const brand = stay.brand?.trim();
    if (brand) add(byBrand, brand, stay);
  }

  const brands = [...byBrand.keys()];
  const out: PointsSuggestion[] = [];

  for (const card of cards) {
    // A card holding no points has nothing to value.
    if (card.currentPoints <= 0) continue;

    const own = byCard.get(card.id);
    if (own && own.points > 0) {
      out.push({
        accountId: card.id,
        micros: rate(own),
        points: own.points,
        stays: own.stays,
        source: "card",
      });
      continue;
    }

    const brand = brandForCard(card.name, brands);
    const fromBrand = brand ? byBrand.get(brand) : null;
    if (brand && fromBrand && fromBrand.points > 0) {
      out.push({
        accountId: card.id,
        micros: rate(fromBrand),
        points: fromBrand.points,
        stays: fromBrand.stays,
        source: "brand",
        brand,
      });
    }
  }

  return out.filter((s) => s.micros > 0);
}

/** "1.64¢/pt" — the unit everyone in this hobby actually speaks. */
export function centsPerPointLabel(micros: number): string {
  return `${(micros / 10_000).toFixed(2)}¢/pt`;
}
