/**
 * A split purchase is one transaction per budget item sharing a
 * split_group_id. Each row carries every part of its split (in the order they
 * were saved) so opening any one of them shows the whole purchase.
 */
export type SplitPart = { subId: string; amountCents: number };

export function attachSplitParts<
  T extends { splitGroupId?: string | null; subId: string | null; amountCents: number; splitParts?: SplitPart[] },
>(txs: T[]): T[] {
  const byGroup = new Map<string, T[]>();
  for (const t of txs) {
    if (!t.splitGroupId) continue;
    byGroup.set(t.splitGroupId, [...(byGroup.get(t.splitGroupId) ?? []), t]);
  }
  for (const rows of byGroup.values()) {
    if (rows.length < 2) continue;
    const parts = rows
      .filter((r): r is T & { subId: string } => Boolean(r.subId))
      .map((r) => ({ subId: r.subId, amountCents: r.amountCents }));
    for (const r of rows) r.splitParts = parts;
  }
  return txs;
}
