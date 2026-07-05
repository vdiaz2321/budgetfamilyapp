"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className="text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const supabase = createClient();
          await supabase.auth.signOut();
          router.replace("/login");
          router.refresh();
        })
      }
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
