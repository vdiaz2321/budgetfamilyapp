"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import { centsPerPointLabel, type PointsSuggestion } from "@/lib/points-value";
import { applyPointsValues } from "./actions";

export type PointsValueRow = {
  accountId: string;
  cardName: string;
  currentPoints: number;
  storedMicros: number | null;
  suggestion: PointsSuggestion | null;
};

const worth = (points: number, micros: number) => Math.round((points * micros) / 10_000);

export function PointsValueModal({
  rows,
  currency,
  onClose,
}: {
  rows: PointsValueRow[];
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Everything with evidence starts ticked: the whole point is that these
  // numbers are measured, not guessed.
  const withSuggestion = useMemo(() => rows.filter((r) => r.suggestion), [rows]);
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(withSuggestion.map((r) => [r.accountId, true])),
  );

  const chosen = withSuggestion.filter((r) => picked[r.accountId]);
  const before = rows.reduce((sum, r) => sum + worth(r.currentPoints, r.storedMicros ?? 0), 0);
  const after = rows.reduce((sum, r) => {
    const use = picked[r.accountId] && r.suggestion ? r.suggestion.micros : r.storedMicros ?? 0;
    return sum + worth(r.currentPoints, use);
  }, 0);

  const unevidenced = rows.filter((r) => !r.suggestion && r.currentPoints > 0);

  function save() {
    start(async () => {
      const result = await applyPointsValues(
        chosen.map((r) => ({ accountId: r.accountId, micros: r.suggestion!.micros })),
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
    <ModalShell title="Points values from your stays" onClose={onClose}>
      <div className="px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <p className="text-xs text-muted">
          Every stay in the Travel Log records what its points redeemed at. These are
          those rates, per card — measured, not estimated. A card with no stays behind
          it is left alone.
        </p>

        <ul className="mt-3 divide-y divide-line">
          {withSuggestion.map((row) => {
            const s = row.suggestion!;
            const on = picked[row.accountId];
            return (
              // At 375px the name and the rates each need a full line;
              // side by side they squeeze the name down to one character.
              <li
                key={row.accountId}
                className="flex flex-col gap-1 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [row.accountId]: e.target.checked }))
                    }
                    className="h-4 w-4 shrink-0 rounded accent-[var(--brand)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{row.cardName}</span>
                    <span className="text-[11px] text-muted">
                      {s.source === "card"
                        ? `${s.stays} stay${s.stays === 1 ? "" : "s"} on this card`
                        : `${s.brand} stays (${s.stays})`}{" "}
                      · {row.currentPoints.toLocaleString()} pts
                    </span>
                  </span>
                </label>
                <span className="flex shrink-0 items-baseline justify-between gap-2 pl-6 text-sm tabular-nums sm:justify-end sm:pl-0">
                  <span className="text-muted">
                    {row.storedMicros ? centsPerPointLabel(row.storedMicros) : "unvalued"}
                  </span>
                  <span aria-hidden className="text-muted">→</span>
                  <span className="font-bold" style={{ color: "var(--viz-savings)" }}>
                    {centsPerPointLabel(s.micros)}
                  </span>
                  <span className="text-right font-semibold text-positive sm:w-24">
                    {formatMoney(worth(row.currentPoints, s.micros), currency)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {unevidenced.length > 0 ? (
          <p className="mt-3 rounded-md bg-black/5 px-3 py-2 text-[11px] text-muted dark:bg-white/10">
            No stays yet for {unevidenced.map((r) => r.cardName).join(", ")} — book one on
            the card, or set its value by hand on the card row.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Total card value{" "}
            <span className="font-semibold tabular-nums">{formatMoney(before, currency)}</span>{" "}
            <span aria-hidden>→</span>{" "}
            <span className="font-bold tabular-nums text-positive">
              {formatMoney(after, currency)}
            </span>
          </p>
          <button
            type="button"
            disabled={pending || chosen.length === 0}
            onClick={save}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : `Apply ${chosen.length}`}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm font-medium text-negative">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
