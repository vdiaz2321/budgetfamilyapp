import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import pkg from "../../../../package.json";
import {
  changeEmail,
  changePassword,
  signOutEverywhere,
  updateDisplayName,
} from "./actions";
import { AvatarCard } from "./avatar-card";
import { DeleteAccountButton } from "./delete-account";

export const metadata = {
  title: "Account · Capitall",
};

type SearchParams = Promise<{ error?: string; saved?: string; pending?: string }>;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error, saved, pending } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, household_id, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const memberCount = profile
    ? (await supabase
        .from("profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("household_id", profile.household_id)).count ?? 1
    : 1;
  const soloOwner = memberCount <= 1;

  const savedMsg =
    saved === "name"
      ? "Display name saved."
      : saved === "password"
      ? "Password updated."
      : saved === "avatar"
      ? "Profile photo updated."
      : saved === "email"
      ? `Confirmation email sent${pending ? ` to ${pending}` : ""}. Click the link to finish switching.`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Account</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>
        </p>
      </header>

      {savedMsg ? (
        <div className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-2.5 text-sm text-positive">
          {savedMsg}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-2.5 text-sm text-negative">
          {error}
        </div>
      ) : null}

      <Card title="Profile photo" description="Shown in the sidebar chip and menu." anchor="avatar">
        <AvatarCard
          userId={user.id}
          currentUrl={profile?.avatar_url ?? null}
          displayName={profile?.display_name ?? ""}
          email={user.email ?? ""}
        />
      </Card>

      <Card title="Profile" description="How you appear across the app.">
        <form action={updateDisplayName} className="space-y-4">
          <Field
            id="displayName"
            label="Display name"
            hint="Shown in the sidebar and on shared items. Leave blank to use your email."
          >
            <input
              id="displayName"
              name="displayName"
              type="text"
              defaultValue={profile?.display_name ?? ""}
              maxLength={60}
              placeholder={user.email?.split("@")[0] ?? ""}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </Field>
          <SubmitBtn label="Save name" />
        </form>
      </Card>

      <Card
        title="Email"
        description="The address you use to sign in. Changing it sends a confirmation link to the new address."
        anchor="email"
      >
        <form action={changeEmail} className="space-y-4">
          <Field id="newEmail" label="New email">
            <input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              autoComplete="email"
              placeholder={user.email ?? ""}
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </Field>
          <Field id="emailCurrentPassword" label="Current password" hint="For your security, confirm your password before changing email.">
            <input
              id="emailCurrentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </Field>
          <SubmitBtn label="Send confirmation link" />
        </form>
      </Card>

      <Card
        title="Password"
        description="Change the password you use to sign in on every device."
        anchor="password"
      >
        <form action={changePassword} className="space-y-4">
          <Field id="currentPassword" label="Current password">
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="newPassword" label="New password">
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </Field>
            <Field id="confirmPassword" label="Confirm new password">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </Field>
          </div>
          <SubmitBtn label="Update password" />
        </form>
      </Card>

      <Card
        title="Household"
        description="Share this budget with your spouse or partner."
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{memberCount}</span>{" "}
            {memberCount === 1 ? "member" : "members"}
          </p>
          <Link
            href="/household"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-brand-soft/30"
          >
            Manage household
          </Link>
        </div>
      </Card>

      <Card
        title="Sessions"
        description="Kick every device (phones, other browsers) out. You'll need to sign in again on all of them."
      >
        <form action={signOutEverywhere}>
          <button
            type="submit"
            className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-1.5 text-sm font-medium text-negative transition hover:bg-negative/20"
          >
            Sign out of all devices
          </button>
        </form>
      </Card>

      <Card
        title="Export data"
        description="Download a full JSON snapshot of your household — accounts, transactions, budgets, savings, debts, snapshots. Handy as a backup or if you ever migrate to another tool."
      >
        <a
          href="/account/export"
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-brand-soft/30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Download JSON
        </a>
      </Card>

      <Card
        title="Danger zone"
        description={
          soloOwner
            ? "You're the only member of this household. Deleting your account permanently removes everything — no undo."
            : "Others share this household. Deleting removes only your profile and login; the shared budget and data stay for them."
        }
        anchor="danger"
      >
        <DeleteAccountButton soloOwner={soloOwner} />
      </Card>

      <p className="text-center text-xs text-muted">
        Capitall v{pkg.version}
      </p>
    </div>
  );
}

function Card({
  title,
  description,
  anchor,
  children,
}: {
  title: string;
  description?: string;
  anchor?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={anchor}
      className="rounded-2xl border border-line bg-surface p-6 shadow-sm"
    >
      <header className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function SubmitBtn({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
    >
      {label}
    </button>
  );
}
