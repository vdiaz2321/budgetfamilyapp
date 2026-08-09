"use client";

import { useLayoutEffect } from "react";

// Modes the user can pick: "light", "dark", or "system" (follow OS). Legacy
// values fall back to "system" (the new default).
export type ThemeMode = "light" | "dark" | "system";

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem("theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode / disabled storage */
  }
  return "system";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
}

export function ThemeInit() {
  useLayoutEffect(() => {
    const apply = () => {
      const mode = readThemeMode();
      document.documentElement.setAttribute("data-theme", resolveTheme(mode));
    };
    apply();

    // Follow OS-level theme changes while the user is on "system" mode.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => {
      if (readThemeMode() === "system") apply();
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return null;
}
