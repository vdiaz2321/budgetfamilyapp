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
      <div className={`mb-5 flex items-center gap-2 ${collapsed ? "justify-center px-1" : "px-5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-lg font-extrabold text-white shadow-[0_0_20px_rgba(139,92,246,0.45)]">
          C
        </span>
        {collapsed ? null : (
          <span className="text-xl font-bold tracking-tight text-white">Capitall</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`${collapsed ? "h-7 w-6" : "ml-auto h-7 w-8"} flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-white/70 bg-white/5 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none"
            className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
            aria-hidden
          >
            <rect x="3.5" y="4" width="5" height="16" rx="1" stroke="currentColor" strokeWidth="2.5" />
            <path d="M19 7 12 12l7 5V7Z" fill="currentColor" />
          </svg>
        </button>
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
