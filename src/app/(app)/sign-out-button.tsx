"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onClick = () =>
    start(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    });

  if (iconOnly) {
    return (
      <button
        type="button"
        title={pending ? "Signing out…" : "Sign out"}
        aria-label="Sign out"
        disabled={pending}
        onClick={onClick}
        className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:text-red-300 disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="rounded-md px-2 py-1 text-xs text-white/60 hover:text-red-300 disabled:opacity-50"
      disabled={pending}
      onClick={onClick}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
