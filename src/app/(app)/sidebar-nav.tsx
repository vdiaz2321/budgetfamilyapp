"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    href: "/snowball",
    label: "Debt Snowball",
    icon: (
      <>
        <path d="M12 3v18M5 8l14 8M19 8L5 16" />
        <circle cx="12" cy="12" r="9" />
      </>
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
    href: "/invest",
    label: "Invest",
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
            className={`group relative flex items-center gap-3 rounded-lg py-[9px] text-sm font-medium transition ${
              collapsed ? "justify-center px-0" : "mx-3 px-3"
            } ${
              active
                ? "bg-white/[0.08] text-white"
                : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {active && !collapsed ? (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-blue-500" aria-hidden />
            ) : null}
            <svg
              width="18"
              height="18"
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
            {collapsed || !badge ? null : (
              <span className="ml-auto shrink-0 rounded-[4px] bg-red-400/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
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
