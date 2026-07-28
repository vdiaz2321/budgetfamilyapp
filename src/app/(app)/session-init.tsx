"use client";

import { useEffect } from "react";

// On every mount, compare the current user's ID to what's stored in
// sessionStorage. If they differ (new login, or first load), wipe all
// sessionStorage so every collapsible section resets to its default
// (collapsed). Navigation within the same session leaves the stored ID
// untouched, so collapse state is preserved between pages.
export function SessionInit({ userId }: { userId: string }) {
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem("capitall_uid");
      if (stored !== userId) {
        window.sessionStorage.clear();
        window.sessionStorage.setItem("capitall_uid", userId);
      }
    } catch {
      // sessionStorage unavailable — no-op.
    }
  }, [userId]);

  return null;
}
