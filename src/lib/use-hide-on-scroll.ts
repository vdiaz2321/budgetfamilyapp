"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True while the page is being scrolled further down — for a sticky header that
 * should get out of the way of a long list and come back the moment you scroll
 * back toward the top.
 *
 * Two guards keep it from flickering: moves smaller than `threshold` are
 * ignored (a phone's scroll fires constantly, and momentum jitters both ways),
 * and the header never hides inside the first `revealAbove` pixels, where it
 * would be hiding the controls you just scrolled past.
 */
export function useHideOnScroll({
  threshold = 8,
  revealAbove = 80,
}: { threshold?: number; revealAbove?: number } = {}): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < threshold) return;
      lastY.current = y;
      setHidden(y > revealAbove && delta > 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, revealAbove]);

  return hidden;
}
