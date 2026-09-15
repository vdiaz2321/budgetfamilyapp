"use client";

export type TravelKind = "stay" | "flight" | "car" | "misc";

const KINDS: { kind: TravelKind; label: string }[] = [
  { kind: "stay", label: "Stay" },
  { kind: "flight", label: "Flight" },
  { kind: "car", label: "Rental" },
  { kind: "misc", label: "Misc" },
];

// One Add button for the whole Travel Log: the form opens on this switch and
// swaps between the stay, flight, rental and spending forms. Only shown when adding — an
// existing booking opens straight into its own form.
export function KindSwitch({ value, onChange }: { value: TravelKind; onChange: (kind: TravelKind) => void }) {
  return (
    <div role="tablist" aria-label="What are you adding?" className="flex w-full gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/10">
      {KINDS.map(({ kind, label }) => {
        const active = kind === value;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(kind)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              active ? "bg-surface text-foreground shadow-sm ring-1 ring-black/10 dark:ring-white/15" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
