"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { readThemeMode, resolveTheme, type ThemeMode } from "@/app/theme-init";

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];

// 3-dot menu that lives in the mobile top bar, mirroring the desktop
// ProfileMenu: theme, account settings, household & sharing, sign out.
export function MobileHeaderMenu({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [themeMounted, setThemeMounted] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeMode(readThemeMode());
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    if (!themeMounted) return;
    document.documentElement.setAttribute("data-theme", resolveTheme(themeMode));
    try {
      localStorage.setItem("theme", themeMode);
    } catch {
      /* ignore private-mode storage errors */
    }
  }, [themeMode, themeMounted]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = () =>
    start(async () => {
      const supabase = createClient();
      window.sessionStorage.removeItem("debt-payments-open");
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    });

  return (
    <div ref={rootRef} className="relative ml-auto md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white transition hover:bg-white/10"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface text-foreground shadow-lg ring-1 ring-black/10 dark:ring-white/10"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-xs text-muted">Signed in as</p>
            <p className="truncate text-sm font-semibold">{userEmail}</p>
          </div>

          <div className="border-b border-line px-3 py-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Theme</p>
            <div className="flex gap-1">
              {THEME_ORDER.map((m) => {
                const active = themeMounted && themeMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setThemeMode(m)}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-brand text-white"
                        : "bg-background text-foreground ring-1 ring-line hover:bg-brand-soft/40"
                    }`}
                  >
                    {THEME_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>

          <MenuLink href="/account" onClick={() => setOpen(false)} icon="user">
            Account settings
          </MenuLink>
          <MenuLink href="/household" onClick={() => setOpen(false)} icon="share">
            Household &amp; sharing
          </MenuLink>

          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-3 text-left text-sm font-medium text-negative transition hover:bg-negative/10 disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  icon,
  children,
}: {
  href: string;
  onClick: () => void;
  icon: "user" | "share";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-3 text-sm text-foreground transition hover:bg-brand-soft/30"
    >
      <span className="text-muted">
        {icon === "user" ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
        )}
      </span>
      {children}
    </Link>
  );
}
