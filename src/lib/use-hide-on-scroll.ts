"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * True while the page is being scrolled further down — for a sticky header that
 * should get out of the way of a long list and come back the moment you scroll
 * back toward the top.
 *
 * Two guards keep it from flickering: moves smaller than `threshold` are
 * ignored (a phone's scroll fires constantly, and momentum jitters both ways),
 * and the header never hides inside the first `revealAbove` pixels, where it
 * would be hiding the controls you just scrolled past.
 *
 * `inner` is for a list that scrolls inside its own box rather than moving the
 * page — a table with a frozen header, say. The window barely scrolls there, so
 * watching only `window` would leave the header pinned forever. Both sources
 * are watched and tracked separately; whichever one the user actually moves
 * decides. Passing no ref keeps the plain page-scroll behaviour.
 */
export function useHideOnScroll({
  threshold = 8,
  revealAbove = 80,
  inner,
}: {
  threshold?: number;
  revealAbove?: number;
  inner?: RefObject<HTMLElement | null>;
} = {}): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const lastInnerY = useRef(0);

  useEffect(() => {
    const innerEl = inner?.current ?? null;

    const track = (y: number, last: { current: number }) => {
      const delta = y - last.current;
      if (Math.abs(delta) < threshold) return;
      last.current = y;
      setHidden(y > revealAbove && delta > 0);
    };

    lastY.current = window.scrollY;
    const onScroll = () => track(window.scrollY, lastY);
    window.addEventListener("scroll", onScroll, { passive: true });

    let onInner: (() => void) | undefined;
    if (innerEl) {
      lastInnerY.current = innerEl.scrollTop;
      onInner = () => track(innerEl.scrollTop, lastInnerY);
      innerEl.addEventListener("scroll", onInner, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (innerEl && onInner) innerEl.removeEventListener("scroll", onInner);
    };
  }, [threshold, revealAbove, inner]);

  return hidden;
}
