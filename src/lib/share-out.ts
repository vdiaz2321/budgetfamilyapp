// Splitting one payment across a flight's passengers. Shared by the
// transaction form (its starting split) and the server (each passenger's
// Spent figure), so the two always agree to the cent.

/** One passenger's part of a flight payment, as saved on the transaction. */
export type PassengerShare = { name: string; cents: number; foreignCents?: number | null };

/**
 * `total` shared out in proportion to `weights`, in whole cents that add up to
 * exactly `total` (the rounding left over goes to the largest shares). Works
 * for a negative total too — a refund comes off in the same proportion. No
 * usable weights shares it evenly.
 */
export function shareOut(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const base = sum > 0 ? w : w.map(() => 1);
  const baseSum = sum > 0 ? sum : base.length;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = base.map((x) => (abs * x) / baseSum);
  const parts = exact.map(Math.floor);
  let left = abs - parts.reduce((a, b) => a + b, 0);
  // Hand the leftover cents to the biggest remainders first.
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map((p) => sign * p);
}

/** The shares saved on a transaction, read back safely (null when unusable). */
export function parseShares(raw: unknown): PassengerShare[] | null {
  if (!Array.isArray(raw)) return null;
  const shares = raw
    .map((s) => {
      const foreign = s?.foreignCents == null ? null : Math.trunc(Number(s.foreignCents));
      return {
        name: String(s?.name ?? "").trim(),
        cents: Math.trunc(Number(s?.cents)),
        foreignCents: foreign != null && Number.isFinite(foreign) && foreign >= 0 ? foreign : null,
      };
    })
    .filter((s) => s.name && Number.isFinite(s.cents) && s.cents >= 0);
  return shares.length && shares.some((s) => s.cents > 0) ? shares : null;
}
