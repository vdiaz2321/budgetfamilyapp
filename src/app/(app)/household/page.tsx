import { createClient } from "@/lib/supabase/server";
import { CopyCodeButton } from "./copy-code-button";

export const metadata = { title: "Household · Capitall" };

export default async function HouseholdPage() {
  const supabase = await createClient();
  const { data: code } = await supabase.rpc("get_or_create_invite_code");

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-foreground">Share access</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Give this code to someone you want <strong>inside your household</strong> —
        a spouse or family member who should see and edit the same budget,
        accounts, and transactions as you. When they sign up, they choose
        &quot;Join with a code&quot; and enter it.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Anyone building their <strong>own separate budget</strong> from scratch
        (friends, extended family) doesn&apos;t need a code — they just sign up
        normally and get their own private household.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Your household&apos;s invite code
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-lg bg-muted px-4 py-2 font-mono text-lg tracking-widest text-foreground">
            {code ?? "—"}
          </span>
          {code ? <CopyCodeButton code={code} /> : null}
        </div>
      </div>
    </div>
  );
}
