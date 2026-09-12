"use client";

import { useEffect, useSyncExternalStore } from "react";

// Page-level actions shown at the top of the mobile ⋯ menu (MobileHeaderMenu).
// A page registers them while it's mounted, so on a phone its buttons don't
// need a header row of their own above the content. Desktop keeps the buttons
// in the page header; the ⋯ menu is md:hidden.

export type MobilePageAction = { label: string; onSelect: () => void };

let actions: MobilePageAction[] = [];
const listeners = new Set<() => void>();
const EMPTY: MobilePageAction[] = [];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: MobilePageAction[]) {
  actions = next;
  listeners.forEach((l) => l());
}

export function useMobilePageActions(): MobilePageAction[] {
  return useSyncExternalStore(subscribe, () => actions, () => EMPTY);
}

// Pass stable callbacks (state setters wrapped once) — the list is registered
// on mount and cleared on unmount, not re-registered each render.
export function useRegisterMobilePageActions(next: MobilePageAction[]) {
  useEffect(() => {
    set(next);
    return () => set(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
