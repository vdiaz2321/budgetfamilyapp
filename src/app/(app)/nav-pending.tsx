"use client";

import { useLinkStatus } from "next/link";

/**
 * Renders a small spinner overlay when the enclosing `<Link>` is mid-navigation.
 * Must be a child of a Next.js `<Link>` — that's the only place `useLinkStatus`
 * returns a real pending state.
 */
export function NavPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 ${className}`}
    />
  );
}
