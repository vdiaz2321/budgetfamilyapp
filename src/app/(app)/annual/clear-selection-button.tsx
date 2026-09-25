"use client";

/**
 * "Clear" for the cell selection, shown in a panel's own header right after
 * its title. Both tables select into the same set, so each one carries its own
 * copy — the single button in the Months header was a panel away from the
 * cells it cleared.
 *
 * A <span role="button"> rather than a <button>: the panel header is itself a
 * button (collapse/expand) and a nested button is invalid HTML.
 */
export function ClearSelectionButton({ onClear }: { onClear: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClear();
        }
      }}
      className="cursor-pointer rounded-md border border-sky-400 bg-sky-100 px-2.5 py-1 text-[12px] font-semibold text-foreground transition hover:bg-sky-200 dark:border-sky-500 dark:bg-sky-900/40 dark:hover:bg-sky-900/60"
    >
      Clear
    </span>
  );
}
