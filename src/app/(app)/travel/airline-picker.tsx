"use client";

import { useEffect, useRef, useState } from "react";

// The flight form's airline box, styled like the stay form's Brand picker.
// The list is every airline already on a saved flight, so a name is picked
// rather than retyped. Typing narrows it; a name that isn't there is used as
// typed and joins the list once the flight is saved.
export function AirlinePicker({
  airlines,
  value,
  onChange,
}: {
  airlines: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const typed = query.trim();
  const matches = typed ? airlines.filter((a) => a.toLowerCase().includes(typed.toLowerCase())) : airlines;
  const exact = airlines.find((a) => a.toLowerCase() === typed.toLowerCase());

  function pick(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  // Leaving the box keeps what was typed — snapped to the saved spelling when
  // it matches one, so "eurowings" is stored as "Eurowings".
  function commit() {
    if (typed) onChange(exact ?? typed);
    setQuery("");
    setOpen(false);
  }

  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) latest.current();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-1 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus-within:ring-2 focus-within:ring-sky-500">
        <input
          ref={input}
          value={open ? query : value}
          placeholder={value || "Type to search"}
          onFocus={() => setOpen(true)}
          // Still focused after a pick, so a click has to reopen it too.
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Never submit the flight form behind the list.
              e.preventDefault();
              if (matches.length === 1) pick(matches[0]);
              else commit();
            } else if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
            } else if (e.key === "Tab") {
              commit();
            }
          }}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            // The arrow opens the list with the cursor in the box, ready to type.
            if (open) setOpen(false);
            else input.current?.focus();
            setQuery("");
          }}
          aria-label={open ? "Close airline list" : "Open airline list"}
          className="shrink-0"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md bg-surface shadow-lg ring-1 ring-line">
          <ul className="max-h-48 overflow-y-auto py-1">
            {value && !typed ? (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="w-full px-2 py-1.5 text-left text-sm text-muted transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Clear
                </button>
              </li>
            ) : null}
            {matches.map((a) => (
              <li key={a}>
                <button
                  type="button"
                  onClick={() => pick(a)}
                  className={`w-full px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
                    a === value ? "font-semibold" : ""
                  }`}
                >
                  {a}
                </button>
              </li>
            ))}
            {matches.length === 0 && !typed ? (
              <li className="px-2 py-1.5 text-xs text-muted">No airlines yet — type one.</li>
            ) : null}
          </ul>
          {typed && !exact ? (
            <button
              type="button"
              onClick={() => pick(typed)}
              className="w-full border-t border-line px-2 py-2 text-left text-sm font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              Use “{typed}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
