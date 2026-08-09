"use client";

import { useEffect, useState } from "react";
import { readThemeMode, resolveTheme, type ThemeMode } from "./theme-init";

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Read the browser-only theme after hydration; the initial render is
    // intentionally deterministic for SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readThemeMode());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", resolveTheme(mode));
    try {
      localStorage.setItem("theme", mode);
    } catch {
      /* ignore private-mode storage errors */
    }
  }, [mode, mounted]);

  const next = NEXT_MODE[mode];

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={mounted ? `Theme: ${LABEL[mode]} — click for ${LABEL[next]}` : "Theme"}
      title={mounted ? `Theme: ${LABEL[mode]} — click for ${LABEL[next]}` : "Theme"}
      suppressHydrationWarning
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/20 text-slate-400 transition hover:border-white/40 hover:text-white"
    >
      {!mounted ? (
        <span className="block h-[18px] w-[18px]" aria-hidden />
      ) : mode === "light" ? (
        // Sun
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : mode === "dark" ? (
        // Moon
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Monitor (system)
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )}
    </button>
  );
}
