"use client";

import { useEffect } from "react";

// How many popups currently want the page frozen. Popups stack (a confirmation
// over a form, an account picker over a transaction), so the page unlocks only
// when the last one closes.
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

/**
 * Stops the page behind a popup from scrolling while `active` is true. The
 * page scrolls on the document itself, so a wheel or swipe that reaches the
 * end of a popup's own scroll area would otherwise carry on into it.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    if (locks === 0) {
      saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
      // Hiding a classic (non-overlay) scrollbar would widen the page and
      // shift everything sideways — pad by its width to hold the layout.
      const bar = window.innerWidth - root.clientWidth;
      root.style.overflow = "hidden";
      if (bar > 0) root.style.paddingRight = `${bar}px`;
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0 && saved) {
        root.style.overflow = saved.overflow;
        root.style.paddingRight = saved.paddingRight;
        saved = null;
      }
    };
  }, [active]);
}
