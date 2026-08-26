"use client";

import { useSyncExternalStore } from "react";

// Never resubscribes — the value only ever flips once, when React hydrates.
const subscribe = () => () => {};

/**
 * `true` once the component is running on the client, `false` during SSR and
 * the hydration pass. Use it to gate browser-only rendering such as
 * `createPortal`, which has no server equivalent.
 *
 * Prefer this over the `useState(false)` + `useEffect(() => setMounted(true))`
 * idiom: that pattern sets state synchronously inside an effect, which forces
 * a second render pass on every mount (and trips react-hooks/set-state-in-effect).
 * `useSyncExternalStore` gets the same result from its server/client snapshot
 * pair, with no extra render.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
