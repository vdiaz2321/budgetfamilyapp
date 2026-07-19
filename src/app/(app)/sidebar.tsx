"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignOutButton } from "./sign-out-button";
import SidebarNav from "./sidebar-nav";
import { SidebarAccounts, type SidebarGroup } from "./sidebar-accounts";

type Props = {
  groups: SidebarGroup[];
  currency: string;
  userEmail: string;
  badges?: Record<string, number>;
};

const STORAGE_KEY = "capitall-sidebar-collapsed";

export function Sidebar({ groups, currency, userEmail, badges }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <aside
      // `z-30`: `position: sticky` makes this its own stacking context, so
      // without an explicit z-index the collapsed-rail tooltip's z-50 (in
      // SidebarNav) only wins against other elements *inside* this aside —
      // main content rendered later in the DOM still paints over the whole
      // sidebar on a tie. See feedback: hover tooltip showing behind cards.
      className={`relative z-30 hidden h-screen shrink-0 flex-col bg-sidebar pt-4 pb-3 text-white transition-[width] duration-200 md:sticky md:top-0 md:flex ${
        collapsed ? "w-[4.5rem] px-3" : "w-[16.25rem] px-0"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3.5 top-9 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-zinc-300 bg-white text-zinc-700 shadow-md transition hover:border-brand hover:text-brand dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-brand dark:hover:text-brand"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>

      <div className={`mb-5 flex items-center gap-2 ${collapsed ? "justify-center" : "px-4"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/15 text-base font-bold text-white">
          C
        </span>
        {collapsed ? null : (
          <span className="text-lg font-semibold tracking-tight text-white">Capitall</span>
        )}
      </div>

      <SidebarNav collapsed={collapsed} badges={badges} />

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <SidebarAccounts groups={groups} currency={currency} />
      )}

      <div className="mx-4 mt-3 border-t border-white/[0.06] pt-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <SignOutButton iconOnly />
            <Link
              href="/household"
              title="Share"
              aria-label="Share"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
              {(userEmail[0] ?? "?").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white" title={userEmail}>
                {userEmail.split("@")[0]}
              </p>
              <p className="truncate text-[11px] text-slate-500" title={userEmail}>
                {userEmail}
              </p>
            </div>
            <Link
              href="/household"
              title="Share"
              aria-label="Share"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/[0.05] hover:text-white"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            </Link>
            <SignOutButton iconOnly />
          </div>
        )}
      </div>
    </aside>
  );
}
