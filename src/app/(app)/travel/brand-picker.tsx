"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTravelBrand, deleteTravelBrand } from "./actions";
import type { TravelBrand } from "./types";

// One picker for what used to be two free-text fields, "Booked through" and
// "Brand". The list lives in travel_brands so the by-brand chart has a fixed
// set of names to group on. It's a type-to-search box: typing narrows the
// list, Enter takes the match, and a name that isn't there yet is added from
// the same box. The chosen name posts as the stay's `brand`.
export function BrandPicker({
  brands,
  value,
  onChange,
}: {
  brands: TravelBrand[];
  value: string;
  onChange: (next: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  // A click anywhere else closes the list — this sits inside a form, so a
  // stray open panel would cover the fields under it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const typed = query.trim();
  const matches = typed
    ? brands.filter((b) => b.name.toLowerCase().includes(typed.toLowerCase()))
    : brands;
  const exact = brands.some((b) => b.name.toLowerCase() === typed.toLowerCase());

  function pick(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  function add(name: string) {
    const clean = name.trim();
    if (!clean) return;
    start(async () => {
      const result = await addTravelBrand(clean);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      // A brand is added mid-stay, so select it straight away.
      pick(clean);
      router.refresh();
    });
  }

  function remove(brand: TravelBrand) {
    start(async () => {
      const result = await deleteTravelBrand(brand.id);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      if (value === brand.name) onChange("");
      router.refresh();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Enter here must never submit the stay form behind the panel.
      e.preventDefault();
      if (matches.length === 1) pick(matches[0].name);
      else if (typed && !exact) add(typed);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={box} className="relative">
      <input type="hidden" name="brand" value={value} />
      <div className="flex items-center gap-1 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus-within:ring-2 focus-within:ring-brand">
        <input
          value={open ? query : value}
          placeholder={value || "Type to search"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
          }}
          aria-label={open ? "Close brand list" : "Open brand list"}
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
            {matches.map((b) => (
              <li key={b.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => pick(b.name)}
                  className={`flex-1 px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
                    b.name === value ? "font-semibold" : ""
                  }`}
                >
                  {b.name}
                </button>
                {/* Touch has no hover, so the x stays visible on mobile and
                    only fades in with the row on a pointer device. */}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(b)}
                  aria-label={`Delete ${b.name}`}
                  className="px-2 py-1.5 text-xs font-bold text-muted transition hover:text-negative disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-visible:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
            {matches.length === 0 && !typed ? (
              <li className="px-2 py-1.5 text-xs text-muted">No brands yet — type one below.</li>
            ) : null}
          </ul>

          {/* A name that isn't on the list yet is added from the same box. */}
          {typed && !exact ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => add(typed)}
              className="w-full border-t border-line px-2 py-2 text-left text-sm font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
            >
              {pending ? "Adding…" : `Add “${typed}”`}
            </button>
          ) : null}
          {error ? <p className="px-2 pb-1.5 text-[11px] text-negative">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
