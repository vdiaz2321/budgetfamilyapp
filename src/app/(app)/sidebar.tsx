"use client";

import { useEffect, useState } from "react";
import SidebarNav from "./sidebar-nav";
import { SidebarAccounts, type SidebarGroup } from "./sidebar-accounts";
import { ProfileMenu } from "./profile-menu";

type Props = {
  groups: SidebarGroup[];
  userEmail: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  badges?: Record<string, number>;
};

const STORAGE_KEY = "capitall-sidebar-collapsed";

export function Sidebar({ groups, userEmail, displayName, avatarUrl, badges }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Browser-only preference hydration; the initial state is SSR-safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

      <div className={`mb-5 flex items-center gap-3 ${collapsed ? "justify-center" : "px-5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-lg font-extrabold text-white shadow-[0_0_20px_rgba(139,92,246,0.45)]">
          C
        </span>
        {collapsed ? null : (
          <span className="text-xl font-bold tracking-tight text-white">Capitall</span>
        )}
      </div>

      <SidebarNav collapsed={collapsed} badges={badges} />

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <SidebarAccounts groups={groups} />
      )}

      <div className="mx-4 mt-3 border-t border-white/[0.06] pt-3">
        <ProfileMenu userEmail={userEmail} displayName={displayName} avatarUrl={avatarUrl} compact={collapsed} />
      </div>
    </aside>
  );
}
