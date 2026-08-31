"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavPending } from "./nav-pending";

const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/budget",
    label: "Budget",
    icon: (
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 4h18" />
    ),
  },
  {
    href: "/transactions",
    label: "Transactions",
    icon: (
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    ),
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: (
      <path d="M3 21h18M4 10h16M5 10V7l7-4 7 4v3M8 10v8M12 10v8M16 10v8" />
    ),
  },
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
    href: "/invest",
    label: "Invest / Savings",
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
    href: "/annual",
    label: "Annual Overview",
    icon: (
      <path d="M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: <path d="M3 3v18h18M8 15v3M13 10v8M18 6v12" />,
  },
];

export default function SidebarNav({
  collapsed = false,
  badges,
}: {
  collapsed?: boolean;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active =
          pathname === n.href || pathname.startsWith(`${n.href}/`);
        const badge = badges?.[n.href];
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3.5 rounded-2xl py-3 text-sm font-medium transition ${
              collapsed ? "justify-center px-0" : "mx-3 px-4"
            } ${
              active
                ? "bg-[#1E1F42] text-[#8B80F9] font-semibold border border-[#2F3061]/50 shadow-sm"
                : "text-slate-400 hover:bg-[#141A2E] hover:text-slate-100"
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-hidden
            >
              {n.icon}
            </svg>
            {collapsed ? null : (
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
            )}
            <NavPending className={collapsed ? "" : "ml-auto"} />
            {collapsed || !badge ? null : n.href === "/snowball" ? (
              <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-400 text-[11px] font-bold text-white">
                {badge}
              </span>
            ) : (
              // The sidebar is dark in both themes, so the pill lifts off it
              // with a white overlay rather than a fixed hex — the old
              // #1A2238 was within a couple of steps of the dark-mode
              // sidebar (#1a1d36) and read as no pill at all.
              <span className="ml-auto shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">
                {badge}
              </span>
            )}
            {collapsed ? (
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity delay-150 duration-100 group-hover:opacity-100"
              >
                {n.label}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
