"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The years a picker is set to, remembered for the session under `key`
 * (sessionStorage is wiped on login — see session-init.tsx), so a fresh login
 * opens on `initial` and a pick survives reloads and page changes after that.
 */
export function useSessionYears(key: string, initial: () => string[]) {
  const [years, setYears] = useState<string[]>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(key);
      // Client-only hydration; the first render uses `initial` to match the
      // server. Anything unreadable (an old single-year string) is ignored.
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setYears(parsed.map(String));
      }
    } catch {
      // sessionStorage unavailable — stays on `initial`.
    }
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(years));
    } catch {
      // sessionStorage unavailable — the pick just won't persist.
    }
  }, [key, years, hydrated]);
  return [years, setYears] as const;
}

/** No years ticked means every year. */
export function inYears(picked: string[], year: string | null | undefined): boolean {
  return picked.length === 0 || (!!year && picked.includes(year));
}

export function yearsLabel(picked: string[]): string {
  if (picked.length === 0) return "All years";
  const sorted = [...picked].sort();
  // Only a single year is spelled out; two or more collapse to a count so the
  // button keeps a fixed, narrow width in the card headers.
  return sorted.length === 1 ? sorted[0] : `${sorted.length} years`;
}

/** The years spelled out — for prose, where "2 years" would read as a duration. */
export function yearsListLabel(picked: string[]): string {
  if (picked.length === 0) return "all years";
  return [...picked].sort().join(", ");
}

/**
 * A button that opens a floating checklist. The list is fixed-positioned so a
 * card's overflow-hidden or a popup's scroll area can't clip it, and it follows
 * the button when ticking something reshapes the page.
 */
export function CheckPicker({
  buttonText,
  label,
  allOption,
  options,
  align = "right",
  className = "",
}: {
  buttonText: React.ReactNode;
  label: string;
  /** An optional first row above a divider — "All years", "Everyone". */
  allOption?: { label: string; checked: boolean; onClick: () => void };
  options: { key: string; label: string; checked: boolean; onToggle: () => void }[];
  /** Which edge of the button the list lines up with. */
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const place = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos(
      align === "left"
        ? { top: r.bottom + 4, left: Math.max(8, r.left) }
        : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) },
    );
  };
  const checkedKeys = options.filter((o) => o.checked).map((o) => o.key).join();
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkedKeys]);

  useEffect(() => {
    if (!open) return;
    // Resize and window scrolls target the window, which isn't a Node.
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!listRef.current?.contains(t) || !!buttonRef.current?.contains(t));
    const close = (e: Event) => {
      if (inside(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Closes the list, not the popup it sits in: window capture runs before
        // the popup's own document-level Escape listener.
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500 ${className}`}
      >
        {buttonText}
        <svg aria-hidden viewBox="0 0 20 20" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>
      {open && pos ? (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable
          aria-label={label}
          style={pos}
          className="fixed z-[60] max-h-72 min-w-36 overflow-y-auto rounded-lg bg-surface py-1 text-xs shadow-lg ring-1 ring-line"
        >
          {allOption ? (
            <>
              <Option checked={allOption.checked} onClick={allOption.onClick}>
                {allOption.label}
              </Option>
              <div className="my-1 border-t border-line" />
            </>
          ) : null}
          {options.map((o) => (
            <Option key={o.key} checked={o.checked} onClick={o.onToggle}>
              {o.label}
            </Option>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Pick one or more years to read side by side. Ticking none — or "All years" —
 * shows every year.
 */
export function YearPicker({
  years,
  value,
  onChange,
  label,
  align,
  className = "",
}: {
  years: string[];
  value: string[];
  onChange: (years: string[]) => void;
  label: string;
  align?: "left" | "right";
  className?: string;
}) {
  const toggle = (y: string) =>
    onChange(value.includes(y) ? value.filter((v) => v !== y) : [...value, y].sort().reverse());
  return (
    <CheckPicker
      buttonText={yearsLabel(value)}
      label={label}
      align={align}
      className={className}
      allOption={{
        label: "All years",
        checked: value.length === 0,
        // A second click on "All years" un-ticks it back to just the current
        // year (or the newest listed one, if this year has nothing yet).
        onClick: () => {
          if (value.length > 0) return onChange([]);
          const thisYear = String(new Date().getFullYear());
          const fallback = [...years].sort().reverse()[0];
          const pick = years.includes(thisYear) ? thisYear : fallback;
          if (pick) onChange([pick]);
        },
      }}
      options={years.map((y) => ({ key: y, label: y, checked: value.includes(y), onToggle: () => toggle(y) }))}
    />
  );
}

function Option({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-semibold tabular-nums transition hover:bg-sky-100 dark:hover:bg-sky-900/40"
    >
      <span
        aria-hidden
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded ring-1 ${
          checked ? "bg-sky-600 text-white ring-sky-600" : "bg-background ring-black/30 dark:ring-white/30"
        }`}
      >
        {checked ? (
          <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 10 3.5 3.5L15 7" />
          </svg>
        ) : null}
      </span>
      {children}
    </button>
  );
}
