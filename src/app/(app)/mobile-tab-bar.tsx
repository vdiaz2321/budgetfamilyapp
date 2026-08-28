"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NavPending } from "./nav-pending";

const TABS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/budget",
    label: "Budget",
    icon: <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 4h18" />,
  },
  {
    href: "/transactions",
    label: "Transactions",
    icon: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: (
      <>
        <path d="M3 21h18" />
        <path d="M5 21V10l7-5 7 5v11" />
        <path d="M9 21v-6h6v6" />
      </>
    ),
  },
];

// Everything the five-slot bar can't fit. Without this these routes were
// simply unreachable on a phone — the tab bar is the only navigation there,
// since the sidebar is desktop-only and the header's 3-dot menu is account
// settings, not navigation.
const MORE_LINKS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/snowball",
    label: "Debt/Loans",
    icon: (
      <>
        <path d="M12 3v18M5 8l14 8M19 8L5 16" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
  },
  {
    href: "/savings",
    label: "Savings",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </>
    ),
  },
  {
    href: "/invest",
    label: "Investments",
    icon: (
      <>
        <path d="M3 3v18h18" />
        <path d="M7 14l3-3 3 3 5-6" />
      </>
    ),
  },
  {
    href: "/networth",
    label: "Net Worth",
    icon: <path d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6" />,
  },
  {
    href: "/insights",
    label: "Insights",
    icon: <path d="M3 3v18h18M8 15v3M13 10v8M18 6v12" />,
  },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function MobileTabBar({ badges }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const lastY = useRef(0);
  const accumulated = useRef(0);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the sheet whenever the route changes — tapping a link inside it
  // navigates (and so does the back button), and the sheet would otherwise
  // stay open over the new page. Compared during render rather than in an
  // effect, which would paint the stale open sheet for a frame first.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      lastY.current = y;
      if (y < 60) { setHidden(false); accumulated.current = 0; return; }
      // Any upward movement brings the bar straight back, and the accumulator
      // only ever builds in the direction you're currently travelling. It used
      // to keep a single running total across both directions, so a downward
      // scroll that stopped just short of the hide threshold left a positive
      // balance that a short flick upward couldn't undo — the bar stayed gone
      // and the only way back was to scroll all the way to the top.
      if (delta < 0) { accumulated.current = 0; setHidden(false); return; }
      // At the very bottom there's no room left to scroll up, so never leave
      // the bar hidden there.
      if (y + window.innerHeight >= document.documentElement.scrollHeight - 8) {
        accumulated.current = 0;
        setHidden(false);
        return;
      }
      accumulated.current += delta;
      if (accumulated.current > 60) { setHidden(true); accumulated.current = 0; }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The More button lights up when the current page lives inside its sheet,
  // and carries the sum of any badges it hides (today: the Debt/Loans count).
  const moreActive = MORE_LINKS.some(
    (l) => pathname === l.href || pathname.startsWith(`${l.href}/`),
  );
  const moreBadge = MORE_LINKS.reduce((sum, l) => sum + (badges?.[l.href] ?? 0), 0);

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 flex border-t border-white/10 bg-sidebar transition-transform duration-300 md:hidden ${
        hidden && !moreOpen ? "translate-y-full" : "translate-y-0"
      }`}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const badge = badges?.[tab.href];
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              active ? "text-[#8B80F9]" : "text-slate-400"
            }`}
          >
            <Icon>{tab.icon}</Icon>
            {tab.href === "/transactions" && badge ? (
              <span className="absolute right-6 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-200 px-1 text-[9px] font-semibold text-black">
                {badge}
              </span>
            ) : null}
            <span>{tab.label}</span>
            <NavPending className="absolute right-2 top-1.5" />
          </Link>
        );
      })}

      {/* More: the routes that don't fit as tabs. Anchored to the right end of
          the bar and opening upward, so it sits over the page rather than
          pushing the bar around. */}
      <div ref={moreRef} className="relative flex flex-1">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          aria-label="More pages"
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
            moreOpen || moreActive ? "text-[#8B80F9]" : "text-slate-400"
          }`}
        >
          <Icon>
            <>
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </>
          </Icon>
          <span>More</span>
          {moreBadge ? (
            <span className="absolute right-4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-200 px-1 text-[9px] font-semibold text-black">
              {moreBadge}
            </span>
          ) : null}
        </button>

        {moreOpen ? (
          <div
            role="menu"
            className="absolute bottom-full right-1 z-50 mb-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-sidebar shadow-xl"
          >
            {MORE_LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              const badge = badges?.[link.href];
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                    active ? "bg-white/10 text-[#8B80F9]" : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <Icon>{link.icon}</Icon>
                  <span className="flex-1">{link.label}</span>
                  {badge ? (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-200 px-1 text-[9px] font-semibold text-black">
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
