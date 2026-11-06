"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearSessionUiState } from "@/lib/use-session-collapse";
import { readThemeMode, resolveTheme, type ThemeMode } from "@/app/theme-init";
import { useMobilePageActions } from "@/lib/mobile-page-actions";

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];

// The phone's settings used to sit behind a floating ⋯ button in the top-right
// corner, where it covered page content. They now live in the tab bar's More
// sheet (mobile-tab-bar.tsx): the current page's own actions at the top, the
// account settings at the bottom. Styled for the sheet's navy background.

const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 dark:text-neutral-300";

/** The current page's own actions (e.g. Move Money on Transactions). */
export function MobilePageActionItems({ onClose }: { onClose: () => void }) {
  const pageActions = useMobilePageActions();
  if (pageActions.length === 0) return null;
  return (
    <div className="border-b border-white/10 py-1">
      {pageActions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            action.onSelect();
          }}
          className={`${ROW} font-semibold text-white`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/** Theme, account settings, household & sharing, sign out. */
export function MobileSettingsItems({ userEmail, onClose }: { userEmail: string; onClose: () => void }) {
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [themeMounted, setThemeMounted] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeMode(readThemeMode());
    setThemeMounted(true);
  }, []);

  const chooseTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    document.documentElement.setAttribute("data-theme", resolveTheme(mode));
    try {
      localStorage.setItem("theme", mode);
    } catch {
      /* ignore private-mode storage errors */
    }
  };

  const signOut = () =>
    start(async () => {
      const supabase = createClient();
      // Every session-scoped panel toggle goes, so the next login starts collapsed.
      clearSessionUiState();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    });

  return (
    <div className="border-t border-white/10">
      <div className="px-4 pb-2 pt-3">
        <p className="truncate text-xs text-slate-300 dark:text-neutral-300">Signed in as</p>
        <p className="truncate text-sm font-semibold text-white">{userEmail}</p>
      </div>

      <div className="px-4 pb-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300 dark:text-neutral-300">Theme</p>
        <div className="flex gap-1">
          {THEME_ORDER.map((m) => {
            const active = themeMounted && themeMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => chooseTheme(m)}
                aria-pressed={active}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-brand text-white" : "text-white ring-1 ring-white/20 hover:bg-white/5"
                }`}
              >
                {THEME_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>

      <Link href="/account" role="menuitem" onClick={onClose} className={ROW}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        Account settings
      </Link>
      <Link href="/household" role="menuitem" onClick={onClose} className={ROW}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Household &amp; sharing
      </Link>

      <button
        type="button"
        role="menuitem"
        disabled={pending}
        onClick={signOut}
        className="flex w-full items-center gap-3 border-t border-white/10 px-4 py-3 text-left text-sm font-semibold text-red-300 transition hover:bg-white/5 disabled:opacity-50"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
