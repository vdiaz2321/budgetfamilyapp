"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import { listRecurringCandidates, markSubcategoriesRecurring, type RecurringCandidate } from "./actions";

// Offers the bills that already repeat at the same amount every month but
// aren't marked Recurring. Shows nothing when there are none, so it goes
// away by itself once they've been marked.
export function MarkRecurringButton({ currency }: { currency: string }) {
  const [candidates, setCandidates] = useState<RecurringCandidate[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    listRecurringCandidates()
      .then((rows) => { if (live) setCandidates(rows); })
      .catch(() => { if (live) setCandidates([]); });
    return () => { live = false; };
  }, []);
  if (!candidates || candidates.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-bold text-foreground ring-1 transition sm:h-7 sm:rounded-full"
        style={{
          background: "color-mix(in srgb, var(--viz-bills) 14%, var(--surface))",
          ["--tw-ring-color" as string]: "color-mix(in srgb, var(--viz-bills) 35%, var(--surface))",
        }}
      >
        Mark recurring ({candidates.length})
      </button>
      {open ? (
        <MarkRecurringModal
          candidates={candidates}
          currency={currency}
          onClose={() => setOpen(false)}
          onDone={(ids) => setCandidates((prev) => (prev ?? []).filter((c) => !ids.includes(c.subcategoryId)))}
        />
      ) : null}
    </>
  );
}

function MarkRecurringModal({
  candidates,
  currency,
  onClose,
  onDone,
}: {
  candidates: RecurringCandidate[];
  currency: string;
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState(() => new Set(candidates.map((c) => c.subcategoryId)));

  const save = () => {
    const ids = [...ticked];
    setError(null);
    start(async () => {
      try {
        await markSubcategoriesRecurring(ids);
        onDone(ids);
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <ModalShell title="Mark recurring" onClose={onClose} mobileAlign="top" className="sm:max-w-md">
      <p className="px-5 pt-3 text-[13.5px] italic text-foreground">Same amount every month for 3+ months.</p>
      <ul className="divide-y divide-line">
        {candidates.map((c) => (
          <li key={c.subcategoryId}>
            <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5">
              <input
                type="checkbox"
                checked={ticked.has(c.subcategoryId)}
                onChange={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.subcategoryId)) next.delete(c.subcategoryId);
                    else next.add(c.subcategoryId);
                    return next;
                  })
                }
                className="h-5 w-5 shrink-0 accent-[color:var(--viz-bills)]"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{c.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(c.typicalCents, currency)}/mo</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {error ? <p className="basis-full text-xs font-semibold text-negative">{error}</p> : null}
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-3 text-sm font-bold text-foreground">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || ticked.size === 0}
          className="min-h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? "Saving…" : `Mark ${ticked.size} recurring`}
        </button>
      </div>
    </ModalShell>
  );
}
