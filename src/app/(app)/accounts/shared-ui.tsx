"use client";

// Controls shared by the Accounts board and the Travel & Credit Card Rewards
// board on /travel. Nothing here knows about either page — it is the handful
// of pieces both needed once the rewards section moved off Accounts.

import { useRef, useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { payCard } from "./actions";
import type { AccountData, BucketData, NonCardAccount } from "./types";

export function LabeledInput({
  label,
  prefix,
  hint,
  ...inputProps
}: { label: string; prefix?: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const isDate = inputProps.type === "date";
  const { defaultValue: initialDefaultValue, ...dateInputProps } = inputProps;
  const [dateVal, setDateVal] = useState(isDate ? (typeof initialDefaultValue === "string" ? initialDefaultValue : "") : "");
  const dateRef = useRef<HTMLInputElement | null>(null);

  if (isDate) {
    return (
      // A <div>, not a <label>: the label wrapper needed an onClick
      // preventDefault to stop it re-forwarding the click to the input, and
      // that same preventDefault also cancelled the browser's own "open the
      // date picker" default — so clicking the field did nothing. Plain div +
      // explicit showPicker() means a click anywhere in the field opens the
      // calendar, including on the value text rather than only the icon.
      <div className="block">
        <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <input
            {...dateInputProps}
            ref={dateRef}
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            onClick={() => {
              // showPicker throws if the browser doesn't support it or the
              // call isn't tied to a user gesture; the native click-the-icon
              // path still works in that case.
              try {
                dateRef.current?.showPicker?.();
              } catch {
                /* no-op */
              }
            }}
            className="w-full cursor-pointer rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {dateVal ? (
            <button
              type="button"
              onClick={() => { setDateVal(""); if (dateRef.current) { dateRef.current.value = ""; dateRef.current.dispatchEvent(new Event("change", { bubbles: true })); } }}
              className="shrink-0 rounded p-1 text-muted hover:text-foreground"
              aria-label="Clear date"
            >
              ✕
            </button>
          ) : null}
        </div>
        {hint ? <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">{hint}</span> : null}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {prefix ? (
        <div className="flex items-center rounded-md ring-1 ring-line focus-within:ring-2 focus-within:ring-brand bg-background">
          <span className="pl-2 text-sm text-muted select-none">{prefix}</span>
          <input
            {...inputProps}
            className="min-w-0 flex-1 rounded-md bg-background px-1.5 py-1.5 text-sm focus:outline-none"
          />
        </div>
      ) : (
        <input
          {...inputProps}
          className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      )}
      {hint ? <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted">{hint}</span> : null}
    </label>
  );
}

// No amber/orange: stat tiles are a data surface, and those two are
// off-limits there (see AGENTS.md).
export type StatTone = "emerald" | "sky" | "teal" | "rose" | "slate";
const STAT_TONES: Record<StatTone, { bg: string; ring: string; label: string; value: string; activeBg: string }> = {
  slate: {
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/30",
    label: "text-slate-700 dark:text-slate-400",
    value: "text-slate-700 dark:text-slate-300",
    activeBg: "bg-slate-500/25",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30",
    label: "text-emerald-700 dark:text-emerald-400",
    value: "text-emerald-700 dark:text-emerald-300",
    activeBg: "bg-emerald-500/25",
  },
  sky: {
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/30",
    label: "text-sky-700 dark:text-sky-400",
    value: "text-sky-700 dark:text-sky-300",
    activeBg: "bg-sky-500/25",
  },
  teal: {
    bg: "bg-teal-500/10",
    ring: "ring-teal-500/30",
    label: "text-teal-700 dark:text-teal-400",
    value: "text-teal-700 dark:text-teal-300",
    activeBg: "bg-teal-500/25",
  },
  rose: {
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/30",
    label: "text-rose-700 dark:text-rose-400",
    value: "text-rose-700 dark:text-rose-300",
    activeBg: "bg-rose-500/25",
  },
};

export function StatTile({
  label,
  value,
  sub,
  subColor,
  tone,
  onClick,
  active,
  title,
}: {
  label: string;
  value: string;
  // Optional smaller breakdown line under the value (e.g. "T 300k · H 1.1M").
  sub?: string;
  // Overrides the sub-line colour — used where the sub-line carries its own
  // good/bad meaning (credit utilisation) rather than echoing the tile's tone.
  subColor?: string;
  tone: StatTone;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const t = STAT_TONES[tone];
  const base = `rounded-lg px-2 py-2 text-center ring-1 ${active ? `${t.activeBg} ${t.ring}` : "bg-background ring-line"}`;
  const inner = (
    <>
      <div className={`text-[10px] sm:text-[10px] font-semibold uppercase tracking-wide ${t.label}`}>{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums sm:text-sm ${t.value}`}>{value}</div>
      {sub ? (
        <div
          className={`mt-0.5 text-[10px] font-medium tabular-nums ${subColor ? "" : t.label}`}
          style={subColor ? { color: subColor } : undefined}
        >
          {sub}
        </div>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${base} transition hover:brightness-105`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

export function PayCardModal({
  card,
  currency,
  nonCardAccounts,
  allBuckets,
  onClose,
}: {
  card: AccountData;
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string>(nonCardAccounts[0]?.id ?? "");
  const source = nonCardAccounts.find((a) => a.id === sourceId) ?? null;
  const sourceBuckets = allBuckets.filter((b) => b.accountId === sourceId);
  // Try to pre-pick a bucket whose name references this card (fuzzy match on
  // card name words, case-insensitive).
  const cardWords = card.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const defaultBucket =
    source?.hasBuckets
      ? sourceBuckets.find((b) => cardWords.some((w) => b.name.toLowerCase().includes(w)))?.id ?? ""
      : "";
  const [bucketId, setBucketId] = useState(defaultBucket);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-4 shadow-lg ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Pay {card.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {(card.owedCents ?? 0) > 0 ? (
          <p className="text-xs text-muted">
            Currently owed: <span className="font-semibold text-negative">{formatMoney(card.owedCents ?? 0, currency)}</span>
          </p>
        ) : null}

        <form
          action={(fd) =>
            start(async () => {
              setErrorMsg(null);
              const r = await payCard(fd);
              if (r?.error) setErrorMsg(r.error);
              else onClose();
            })
          }
          className="space-y-2"
        >
          <input type="hidden" name="cardId" value={card.id} />
          <LabeledInput
            label="Payment amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={card.owedCents && card.owedCents > 0 ? centsToDisplay(card.owedCents) : ""}
            required
            autoFocus
          />
          {card.owedCents && card.owedCents > 0 ? (
            <p className="text-[10px] text-muted">
              The full balance is prefilled. Recording this payment will bring the card to {formatMoney(0, currency)} while keeping the imported charges.
            </p>
          ) : null}
          <LabeledInput label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              From account
            </span>
            <select
              name="sourceAccountId"
              value={sourceId}
              onChange={(e) => { setSourceId(e.target.value); setBucketId(""); }}
              required
              className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {nonCardAccounts.length === 0 ? (
                <option value="">No accounts available</option>
              ) : null}
              {nonCardAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {source?.hasBuckets && sourceBuckets.length > 0 ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                From bucket
              </span>
              <select
                name="bucketId"
                value={bucketId}
                onChange={(e) => setBucketId(e.target.value)}
                required
                className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">Choose a bucket…</option>
                {sourceBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] text-muted">
                Required because {source.name} has buckets — the bucket total drives the account total.
              </p>
            </label>
          ) : null}
          <LabeledInput label="Notes" name="notes" defaultValue={`Payment to ${card.name}`} />
          {errorMsg ? <p className="text-xs text-negative">{errorMsg}</p> : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Paying…" : "Pay Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// Pointer-based row reordering shared by both drag contexts on this page
// (accounts within a section, buckets within an account). Rows carry a
// data-drop-key="<kind>:<id>"; grabbing a handle starts the drag, releasing
// over another row of the same kind fires onReorder(fromId, toId). Same
// approach as the Net Worth grid.
export function GripHandle({ onMouseDown, size = "md" }: { onMouseDown: () => void; size?: "sm" | "md" }) {
  const px = size === "sm" ? 11 : 13;
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}
      aria-label="Drag to reorder"
      className="flex shrink-0 cursor-grab items-center rounded p-0.5 text-muted/60 transition hover:bg-brand-soft/50 hover:text-muted active:cursor-grabbing"
    >
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </span>
  );
}

export function usePointerReorder(kind: string, onReorder: (fromId: string, toId: string) => void) {
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const keyUnder = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>("[data-drop-key]");
    const key = rowEl?.getAttribute("data-drop-key");
    return key && key.startsWith(`${kind}:`) ? key.slice(kind.length + 1) : null;
  };

  const startDrag = (id: string) => {
    dragId.current = id;
    document.body.style.cursor = "grabbing";
    const onMove = (e: MouseEvent) => setDragOverId(keyUnder(e.clientX, e.clientY));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverId(null);
      const from = dragId.current;
      dragId.current = null;
      const to = keyUnder(e.clientX, e.clientY);
      if (from && to && from !== to) onReorder(from, to);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { dragOverId, startDrag };
}
