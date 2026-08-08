"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/app/theme-toggle";

type Props = {
  userEmail: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  compact?: boolean;
};

export function ProfileMenu({ userEmail, displayName, avatarUrl, compact = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

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

  const shownName = displayName?.trim() || userEmail.split("@")[0] || "You";
  const initial = (displayName?.trim()?.[0] ?? userEmail[0] ?? "?").toUpperCase();
  const avatar = (size: "sm" | "md") => {
    const cls = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
    if (avatarUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className={`${cls} shrink-0 rounded-full object-cover`}
        />
      );
    }
    return (
      <span
        className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white`}
      >
        {initial}
      </span>
    );
  };

  const signOut = () =>
    start(async () => {
      const supabase = createClient();
      window.sessionStorage.removeItem("debt-payments-open");
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={userEmail}
        className={
          compact
            ? "flex items-center justify-center rounded-full transition hover:opacity-90"
            : "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05]"
        }
      >
        {avatar(compact ? "md" : "sm")}
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{shownName}</span>
              <span className="block truncate text-[11px] text-slate-500">{userEmail}</span>
            </span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className={`absolute z-50 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lg ring-1 ring-black/5 dark:ring-white/10 ${
            compact ? "bottom-full left-0 mb-2" : "bottom-full left-0 mb-2 w-full min-w-[15rem]"
          }`}
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-foreground">{shownName}</p>
            <p className="truncate text-xs text-muted">{userEmail}</p>
          </div>
          <MenuLink href="/account" onClick={() => setOpen(false)} icon="user">
            Account settings
          </MenuLink>
          <MenuLink href="/household" onClick={() => setOpen(false)} icon="share">
            Household &amp; sharing
          </MenuLink>
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="text-sm text-foreground">Theme</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm font-medium text-negative transition hover:bg-negative/10 disabled:opacity-50"
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
      className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition hover:bg-brand-soft/30"
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
