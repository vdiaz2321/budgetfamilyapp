"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateDisplayName(formData: FormData) {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName || null })
    .eq("user_id", user.id);

  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect("/account?saved=name");
}

export async function changePassword(formData: FormData) {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    redirect("/account?error=Fill+in+both+password+fields#password");
  }
  if (newPassword.length < 6) {
    redirect("/account?error=New+password+must+be+at+least+6+characters#password");
  }
  if (newPassword !== confirm) {
    redirect("/account?error=New+passwords+do+not+match#password");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  // Re-authenticate first — Supabase's updateUser doesn't verify the current
  // password on its own, so a stolen session could otherwise change it.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    redirect("/account?error=Current+password+is+incorrect#password");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}#password`);
  }
  redirect("/account?saved=password#password");
}

export async function changeEmail(formData: FormData) {
  const newEmail = String(formData.get("newEmail") ?? "").trim().toLowerCase();
  const currentPassword = String(formData.get("currentPassword") ?? "");

  if (!newEmail || !currentPassword) {
    redirect("/account?error=Enter+the+new+email+and+your+current+password#email");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  if (newEmail === user.email.toLowerCase()) {
    redirect("/account?error=That%27s+already+your+email#email");
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    redirect("/account?error=Current+password+is+incorrect#email");
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${origin}/auth/callback?next=/account` },
  );
  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}#email`);
  }
  redirect(`/account?saved=email&pending=${encodeURIComponent(newEmail)}#email`);
}

export async function updateAvatarUrl(formData: FormData) {
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim() || null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("user_id", user.id);
  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}#avatar`);
  }
  revalidatePath("/", "layout");
  redirect("/account?saved=avatar#avatar");
}

export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?error=Signed+out+of+all+devices");
}

export async function deleteMyAccount(formData: FormData) {
  const confirm = String(formData.get("confirm") ?? "").trim();
  const currentPassword = String(formData.get("currentPassword") ?? "");

  if (confirm !== "DELETE") {
    redirect("/account?error=Type+DELETE+to+confirm#danger");
  }
  if (!currentPassword) {
    redirect("/account?error=Enter+your+password+to+confirm#danger");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    redirect("/account?error=Password+is+incorrect#danger");
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}#danger`);
  }

  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?error=Your+account+has+been+deleted.");
}
