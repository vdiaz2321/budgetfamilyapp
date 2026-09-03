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
      // This is intentional client-only hydration from sessionStorage. The
      // first render uses the server-safe initial value to avoid a mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setState(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      // sessionStorage unavailable (e.g. private mode) — falls back to `initial()`.
    }
    setHydrated(true);
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

// Same contract as useSessionCollapse, but backed by localStorage: the state
// outlives the browser session, so a panel found expanded stays expanded on
// the next login. For panels a user sets up once and expects to find as they
// left it — not for transient per-visit toggles, which should stay in
// sessionStorage so they reset on a fresh login.
export function usePersistentCollapse(
  key: string,
  initial: () => Record<string, boolean>,
): [Record<string, boolean>, Dispatch<SetStateAction<Record<string, boolean>>>] {
  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      // Client-only hydration, as above: the first render uses the
      // server-safe initial value so there is no mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setState(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      // localStorage unavailable (private mode, blocked site data) — falls
      // back to `initial()`.
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage unavailable — the state just won't persist.
    }
  }, [key, state, hydrated]);

  return [state, setState];
}
