"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { linkTravelCardLabels } from "./actions";
import type { TravelCard } from "./types";

export type CardLabelRow = {
  label: string;
  stays: number;
  // The card these stays already point at, if they agree on one.
  accountId: string | null;
};

// A label matches a card when one name contains the other's distinctive words:
// "Hilton Aspire" -> "1002 Hilton Aspire Amex V". The leading digits on the
// account are the last four of the card, so they never help and are dropped.
// Longer words count for more, so "Amex Bonvoy" lands on the Bonvoy card
// rather than on the first card that happens to say Amex. A tie means the
// label is genuinely ambiguous ("Amex" alone), and a wrong guess there is
// worse than none — so it suggests nothing.
function suggest(label: string, cards: TravelCard[]): string {
  const words = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return "";

  const scored = cards
    .map((card) => {
      const name = card.name.toLowerCase().replace(/^\d+\s*/, "");
      const weight = words
        .filter((w) => name.includes(w))
        .reduce((sum, w) => sum + w.length, 0);
      return { id: card.id, weight };
    })
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (scored.length === 0) return "";
  if (scored.length > 1 && scored[0].weight === scored[1].weight) return "";
  return scored[0].id;
}

export function CardLinkModal({
  rows,
  cards,
  onClose,
}: {
  rows: CardLabelRow[];
  cards: TravelCard[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Start from what's already linked, and fall back to a suggestion so the
  // obvious ones are one click away instead of thirty.
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows) map[row.label] = row.accountId ?? suggest(row.label, cards);
    return map;
  }, [rows, cards]);
  const [picked, setPicked] = useState<Record<string, string>>(initial);

  const changes = rows.filter((r) => (picked[r.label] ?? "") !== (r.accountId ?? ""));
  const affected = changes.reduce((sum, r) => sum + r.stays, 0);

  function save() {
    start(async () => {
      const result = await linkTravelCardLabels(
        changes.map((r) => ({ label: r.label, accountId: picked[r.label] || null })),
      );
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <ModalShell title="Link cards" onClose={onClose}>
      <div className="px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.label} className="grid grid-cols-1 gap-1.5 py-2 sm:grid-cols-2 sm:items-center sm:gap-3">
              <span className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{row.label}</span>
                <span className="text-[11px] tabular-nums text-muted">
                  {row.stays} stay{row.stays === 1 ? "" : "s"}
                </span>
              </span>
              <select
                value={picked[row.label] ?? ""}
                onChange={(e) => setPicked((p) => ({ ...p, [row.label]: e.target.value }))}
                className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Not linked</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {changes.length === 0
              ? "Nothing to change yet."
              : `${changes.length} label${changes.length === 1 ? "" : "s"} · ${affected} stay${affected === 1 ? "" : "s"}`}
          </p>
          <button
            type="button"
            disabled={pending || changes.length === 0}
            onClick={save}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Linking…" : "Link cards"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm font-medium text-negative">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
