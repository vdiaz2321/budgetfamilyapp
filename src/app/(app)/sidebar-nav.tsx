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
    href: "/networth",
    label: "Networth",
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
    href: "/goals",
    label: "Goals",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: <path d="M3 3v18h18M8 15v3M13 10v8M18 6v12" />,
  },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active =
          pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand-soft text-brand"
                : "text-muted hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
            }`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-hidden
            >
              {n.icon}
            </svg>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
