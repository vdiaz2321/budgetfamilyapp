"use client";

import { useEffect, useRef } from "react";

// Every ModalShell currently on screen, oldest first. Escape closes only the
// last one: with a confirmation opened over a form, one press should dismiss
// the confirmation and leave the form standing, not clear the whole stack.
const openModals: symbol[] = [];

// Escape closes the topmost modal. Until now nothing listened for it anywhere
// in the app, so every overlay — year editor, assumptions, confirmations,
// transaction modal — could only be dismissed by finding the X or the backdrop.
function useCloseOnEscape(onClose: () => void) {
  // Read through a ref so the listener is bound once per modal rather than
  // re-bound on every render an inline arrow prop causes.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const id = Symbol("modal");
    openModals.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openModals[openModals.length - 1] !== id) return;
      event.stopPropagation();
      latest.current();
    };
    // Capture, so a keydown handled inside a field (a select, a combobox)
    // still reaches this first — and so the check above decides who closes.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = openModals.indexOf(id);
      if (at >= 0) openModals.splice(at, 1);
    };
  }, []);
}

// A generic centered modal: backdrop (click closes) + scrollable panel, styled
// to match the rest of the app's overlays (TransactionModal, item panels).
//
// The panel is `fixed`, but it is still a DOM descendant of whatever opened it
// — often a clickable row or group header. Without the stopPropagation below,
// every click inside the modal (Close, Save, even a text field) also fires that
// parent's onClick, so closing the modal would toggle the row open behind it.
export function ModalShell({
  title,
  onClose,
  children,
  className,
  mobileAlign = "bottom",
  headerExtra,
  headerActions,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  // Rendered in the header between the title and Close — stays visible while
  // the body scrolls (e.g. a running total).
  headerExtra?: React.ReactNode;
  // Buttons that act on the whole body (e.g. expand all), shown after the title.
  headerActions?: React.ReactNode;
  // Where the panel sits on phones. "bottom" (default) is right for long,
  // scroll-heavy forms the thumb works through. "top" suits short forms, which
  // otherwise end up with their action buttons pinned in the very corner of the
  // screen — awkward to reach and easily overlapped by floating UI.
  mobileAlign?: "bottom" | "top";
}) {
  const alignsTop = mobileAlign === "top";
  useCloseOnEscape(onClose);
  return (
    <div
      onClick={(event) => event.stopPropagation()}
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
      {/* A top-aligned panel on a phone sits under the status bar and notch,
          which clips exactly the row that carries the title and the Close
          button — so the header gets the safe area on top of its own padding.
          It goes on this outer, non-scrolling box so it can't scroll away with
          the content, and is dropped from `sm:` up where there is no notch. */}
      <div className={`relative z-50 flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden bg-surface shadow-lg ring-1 ring-black/5 dark:ring-white/10 sm:max-h-[85vh] sm:rounded-2xl sm:pt-0 ${alignsTop ? "rounded-2xl pt-[max(env(safe-area-inset-top),0.5rem)]" : "rounded-t-2xl"}${className ? ` ${className}` : ""}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
          <h2 className="min-w-0 truncate text-lg font-bold">{title}</h2>
          {/* Beside the title on wide screens; its own line under it on a phone. */}
          {headerActions ? (
            <div className="order-last flex basis-full flex-wrap items-center gap-2 sm:order-none sm:basis-auto">
              {headerActions}
            </div>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-negative/10 hover:text-negative"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
