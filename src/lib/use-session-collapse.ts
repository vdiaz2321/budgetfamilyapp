"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// Collapse state that resets to `initial` on a fresh login (new browser
// session) but survives navigating around the app within that session.
// The first render always uses `initial()` — matching the server — so there's
// no hydration mismatch; the saved value (if any) is applied right after
// mount, once we're client-only.
export function useSessionCollapse(
  key: string,
  initial: () => Record<string, boolean>,
): [Record<string, boolean>, Dispatch<SetStateAction<Record<string, boolean>>>] {
  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(key);
      if (saved) setState(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      // sessionStorage unavailable (e.g. private mode) — falls back to `initial()`.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // sessionStorage unavailable — collapse state just won't persist.
    }
  }, [key, state, hydrated]);

  return [state, setState];
}
