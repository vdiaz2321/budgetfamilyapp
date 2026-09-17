"use client";

/**
 * A small search input with a ✕ inside its right edge that clears it — shown
 * only once something is typed.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className = "w-40",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-md bg-background py-1 pl-2 pr-6 text-xs ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute inset-y-0 right-0.5 my-auto flex h-5 w-5 items-center justify-center rounded text-muted transition hover:bg-sky-100 hover:text-foreground dark:hover:bg-sky-900/40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
