"use client";

// Opens a panel's body in a wide popup. Desktop only: on a phone the popup
// would be no wider than the page it came from.
export function OpenFullWidthButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden items-center gap-1.5 rounded-md border border-black/25 bg-background px-2 py-1 text-[11px] font-semibold transition hover:border-sky-400 hover:bg-sky-100 sm:inline-flex dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
    >
      Open full width
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      >
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
  );
}
