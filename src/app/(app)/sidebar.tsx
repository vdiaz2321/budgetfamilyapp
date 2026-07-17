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
};

const STORAGE_KEY = "capitall-sidebar-collapsed";

export function Sidebar({ groups, currency, userEmail }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <aside
      className={`relative hidden h-screen shrink-0 flex-col bg-sidebar px-3 py-5 text-white transition-[width] duration-200 md:sticky md:top-0 md:flex ${
        collapsed ? "w-[4.5rem]" : "w-64"
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

      <div className={`mb-5 flex items-center gap-2 ${collapsed ? "justify-center" : "px-1"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-base font-bold text-white">
          C
        </span>
        {collapsed ? null : (
          <span className="text-lg font-semibold tracking-tight text-white">Capitall</span>
        )}
      </div>

      <SidebarNav collapsed={collapsed} />

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <SidebarAccounts groups={groups} currency={currency} />
      )}

      <div className="mt-4 border-t border-white/15 pt-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <SignOutButton iconOnly />
            <Link
              href="/household"
              title="Share"
              aria-label="Share"
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:text-white"
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
          <>
            <p className="truncate px-2 text-xs text-white/50" title={userEmail}>
              {userEmail}
            </p>
            <div className="mt-1 flex items-center justify-between px-1">
              <SignOutButton />
              <Link
                href="/household"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/60 hover:text-white"
              >
                <svg
                  width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                </svg>
                Share
              </Link>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
