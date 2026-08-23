"use client";

// A generic centered modal: backdrop (click closes) + scrollable panel, styled
// to match the rest of the app's overlays (TransactionModal, item panels).
export function ModalShell({
  title,
  onClose,
  children,
  className,
  mobileAlign = "bottom",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  // Where the panel sits on phones. "bottom" (default) is right for long,
  // scroll-heavy forms the thumb works through. "top" suits short forms, which
  // otherwise end up with their action buttons pinned in the very corner of the
  // screen — awkward to reach and easily overlapped by floating UI.
  mobileAlign?: "bottom" | "top";
}) {
  const alignsTop = mobileAlign === "top";
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center sm:items-center sm:p-4 ${
        alignsTop ? "items-start p-3" : "items-end"
      }`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div className={`relative z-50 flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-lg ring-1 ring-black/5 dark:ring-white/10 sm:max-h-[85vh] sm:rounded-2xl ${alignsTop ? "rounded-2xl" : "rounded-t-2xl"}${className ? ` ${className}` : ""}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition hover:text-foreground"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
