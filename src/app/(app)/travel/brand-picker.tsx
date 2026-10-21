"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTravelBrand, deleteTravelBrand } from "./actions";
import type { TravelBrand } from "./types";

// One picker for what used to be two free-text fields, "Booked through" and
// "Brand". The list lives in travel_brands so the by-brand chart has a fixed
// set of names to group on. It's a type-to-search box: typing narrows the
// list, the arrow keys move through it, Enter takes the highlighted row, and a
// name that isn't there yet is added from the same box. The chosen name posts
// as the stay's `brand`.
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
  // The row the arrow keys are on: an index into `options` below, -1 for none.
  const [active, setActive] = useState(-1);
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
        setActive(-1);
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
  // What the arrow keys step through: each match, then "Add …" when shown.
  const options: { kind: "pick" | "add"; name: string }[] = [
    ...matches.map((b) => ({ kind: "pick" as const, name: b.name })),
    ...(typed && !exact ? [{ kind: "add" as const, name: typed }] : []),
  ];
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-option="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
    setActive(-1);
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const last = options.length - 1;
      if (last < 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1));
      return;
    }
    if (e.key === "Enter") {
      // Enter here must never submit the stay form behind the panel.
      e.preventDefault();
      const chosen = options[active] ?? (matches.length === 1 ? options[0] : undefined);
      if (chosen?.kind === "pick") pick(chosen.name);
      else if (chosen?.kind === "add" || (typed && !exact)) add(typed);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActive(-1);
    }
  }

  return (
    <div ref={box} className="relative">
      <input type="hidden" name="brand" value={value} />
      <div className="flex items-center gap-1 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus-within:ring-2 focus-within:ring-sky-500">
        <input
          value={open ? query : value}
          placeholder={value || "Type to search"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing puts the top row under Enter.
            setActive(e.target.value.trim() ? 0 : -1);
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
        <div ref={list} className="absolute left-0 right-0 z-20 mt-1 rounded-md bg-surface shadow-lg ring-1 ring-line">
          <ul className="max-h-48 overflow-y-auto py-1">
            {value && !typed ? (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="w-full px-2 py-1.5 text-left text-sm text-muted transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  Clear
                </button>
              </li>
            ) : null}
            {matches.map((b, i) => (
              <li key={b.id} data-option={i} className={`group flex items-center ${i === active ? "bg-sky-200 dark:bg-sky-800" : ""}`}>
                <button
                  type="button"
                  onClick={() => pick(b.name)}
                  className={`flex-1 px-2 py-1.5 text-left text-sm transition hover:bg-sky-50 dark:hover:bg-sky-950/40 ${
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
              data-option={matches.length}
              disabled={pending}
              onClick={() => add(typed)}
              className={`w-full border-t border-line px-2 py-2 text-left text-sm font-semibold transition hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/40 ${
                active === matches.length ? "bg-sky-200 dark:bg-sky-800" : ""
              }`}
            >
              {pending ? "Adding…" : `Add “${typed}”`}
            </button>
          ) : null}
          {error ? <p className="px-2 pb-1.5 text-xs text-negative">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
