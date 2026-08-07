"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    label: "Debt",
    icon: (
      <>
        <path d="M12 3v18M5 8l14 8M19 8L5 16" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-white/10 bg-sidebar md:hidden">
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
            <span>{tab.label}</span>
            <NavPending className="absolute right-2 top-1.5" />
            {badge ? (
              <span className="absolute right-[calc(50%-16px)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
