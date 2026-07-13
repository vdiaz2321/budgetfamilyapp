import { createClient } from "@/lib/supabase/server";
import { CopyCodeButton } from "./copy-code-button";

export const metadata = { title: "Household · Capitall" };

export default async function HouseholdPage() {
  const supabase = await createClient();
  const { data: code } = await supabase.rpc("get_or_create_invite_code");

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-foreground">Household</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Share this code with your spouse. When they create an account and
        choose &quot;Join with a code&quot; on sign-up, they&apos;ll land in
        this same household — same budget, accounts, and transactions.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Invite code
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
