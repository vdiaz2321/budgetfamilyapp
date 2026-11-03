"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { KID_ACCOUNT_TYPES, kidActionsFor, kidTypeOf } from "@/lib/kids-funding";
import { transferBetweenAccounts } from "./actions";

// The Kids Funding popup's own actions. Each one refuses what kids-funding.ts
// says the law doesn't allow, so the rule holds even if the popup is out of
// date. Balances only move through the database functions, in one transaction.

type Result = { error: string | null };
type Session = Awaited<ReturnType<typeof getSessionContext>>;

// What a refused write says on screen. The database's own wording goes to the
// server log, since it names constraints and tables.
function saveFailed(error: { message: string }): Result {
  console.error("[kids funding save]", error.message);
  return { error: "Couldn't save that. Nothing changed. Please try again." };
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const orNull = (formData: FormData, key: string) => text(formData, key) || null;

function revalidateKids() {
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/invest");
  revalidatePath("/annual");
  revalidatePath("/networth");
  // The sidebar's account totals live in the shared (app) layout.
  revalidatePath("/", "layout");
}

const today = () => new Date().toISOString().slice(0, 10);

/** "2013-04" from a month field → "2013-04-01"; null if it isn't one. */
function monthFirst(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}

// One item as the rules see it: a bucket, or an account with no buckets.
async function loadItem({ supabase, household }: Session, accountId: string, bucketId: string | null) {
  const { data: account, error } = await supabase
    .from("accounts")
    .select("id, name, subtype, retirement_kind, kid_id, is_kids_account, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", household.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the account: ${error.message}`);
  if (!account?.is_kids_account) return null;

  let bucket: { name: string; subtype: string | null; retirement_kind: string | null; kid_id: string | null; balance_cents: number | null } | null = null;
  if (bucketId) {
    const { data, error: bucketError } = await supabase
      .from("buckets")
      .select("name, subtype, retirement_kind, kid_id, balance_cents")
      .eq("id", bucketId)
      .eq("account_id", accountId)
      .eq("household_id", household.id)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not read the bucket: ${bucketError.message}`);
    if (!data) return null;
    bucket = data;
  }

  const kidId = bucket ? bucket.kid_id ?? account.kid_id : account.kid_id;
  let kid: { name: string; birth_month: string; utma_handover_age: number } | null = null;
  if (kidId) {
    const { data, error: kidError } = await supabase
      .from("kids")
      .select("name, birth_month, utma_handover_age")
      .eq("id", kidId)
      .eq("household_id", household.id)
      .maybeSingle();
    if (kidError) throw new Error(`Could not read the child: ${kidError.message}`);
    kid = data;
  }

  return {
    name: bucket?.name ?? account.name,
    type: kidTypeOf(bucket?.subtype ?? account.subtype, bucket?.retirement_kind ?? account.retirement_kind),
    kidId,
    kid,
    balanceCents: (bucket ? bucket.balance_cents : account.current_balance_cents) ?? 0,
  };
}

const actionsOf = (item: NonNullable<Awaited<ReturnType<typeof loadItem>>>) =>
  kidActionsFor({
    type: item.type,
    balanceCents: item.balanceCents,
    birthMonth: item.kid?.birth_month ?? null,
    utmaAge: item.kid?.utma_handover_age ?? 21,
    today: today(),
  });

export async function saveKid(formData: FormData): Promise<Result & { id?: string }> {
  const session = await getSessionContext();
  const { supabase, household } = session;
  const id = orNull(formData, "id");
  const name = text(formData, "name");
  const birthMonth = monthFirst(text(formData, "birthMonth"));
  if (!name) return { error: "Enter a name." };
  if (!birthMonth) return { error: "Enter the month and year they were born." };

  // The UTMA age lives on the UTMA's own panel (setKidUtmaAge), so saving a
  // name or birth month never touches it.
  const row = { name, birth_month: birthMonth };
  const { data, error } = id
    ? await supabase.from("kids").update(row).eq("id", id).eq("household_id", household.id).select("id").single()
    : await supabase.from("kids").insert({ ...row, household_id: household.id }).select("id").single();
  if (error) return error.code === "23505" ? { error: `${name} is already listed.` } : saveFailed(error);
  revalidateKids();
  return { error: null, id: data.id };
}

// Only someone with nothing under them: removing a child would orphan accounts.
export async function deleteKid(formData: FormData): Promise<Result> {
  const { supabase, household } = await getSessionContext();
  const id = text(formData, "id");
  const [accounts, buckets] = await Promise.all([
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("kid_id", id),
    supabase.from("buckets").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("kid_id", id),
  ]);
  if (accounts.error || buckets.error) return { error: (accounts.error ?? buckets.error)!.message };
  if ((accounts.count ?? 0) + (buckets.count ?? 0) > 0) return { error: "Move their accounts first." };
  const { error } = await supabase.from("kids").delete().eq("id", id).eq("household_id", household.id);
  if (error) return { error: error.message };
  revalidateKids();
  return { error: null };
}

// The age a child's UTMA hands over at. Set by the state and the account, so
// it's asked on the UTMA itself, beside the date it decides.
export async function setKidUtmaAge(kidId: string, age: number): Promise<Result> {
  const { supabase, household } = await getSessionContext();
  if (!Number.isInteger(age) || age < 18 || age > 25) return { error: "The UTMA age must be 18 to 25." };
  const { error } = await supabase
    .from("kids")
    .update({ utma_handover_age: age })
    .eq("id", kidId)
    .eq("household_id", household.id);
  if (error) return saveFailed(error);
  revalidateKids();
  return { error: null };
}

const INLINE_COLUMNS: Record<string, string> = {
  institution: "institution",
  accountNumber: "account_number",
  controlledBy: "controlled_by",
  successorOwner: "successor_owner",
  kidId: "kid_id",
};

// One value edited right in its cell on an item's panel. Only that field is
// written, like the Estate guide's fields.
export async function saveKidItemField(accountId: string, bucketId: string | null, field: string, value: string): Promise<Result> {
  const session = await getSessionContext();
  const { supabase, household } = session;
  const column = INLINE_COLUMNS[field];
  if (!column) return { error: "That can't be edited here." };
  const item = await loadItem(session, accountId, bucketId);
  if (!item) return { error: "Account not found." };

  const v = value.trim() || null;
  const patch: Record<string, unknown> = { [column]: v, updated_at: new Date().toISOString() };
  if (field === "kidId") {
    // A 529's child changes through Change beneficiary, which keeps a record.
    if (item.type === "529" && item.kidId) return { error: "Use Change beneficiary for a 529." };
    if (!bucketId && v) {
      const { data: kid, error: kidError } = await supabase
        .from("kids")
        .select("name")
        .eq("id", v)
        .eq("household_id", household.id)
        .maybeSingle();
      if (kidError) return saveFailed(kidError);
      patch.holder = kid?.name ?? null;
    }
  }

  const { error } = bucketId
    ? await supabase.from("buckets").update(patch).eq("id", bucketId).eq("account_id", accountId).eq("household_id", household.id)
    : await supabase.from("accounts").update(patch).eq("id", accountId).eq("household_id", household.id);
  if (error) return saveFailed(error);
  revalidateKids();
  return { error: null };
}

// The rare edits: its name and its type. Everything else saves in its own cell.
export async function updateKidItem(formData: FormData): Promise<Result> {
  const { supabase, household } = await getSessionContext();
  const accountId = text(formData, "accountId");
  const bucketId = orNull(formData, "bucketId");
  const name = text(formData, "name");
  if (!accountId || !name) return { error: "Enter a name." };

  const patch: Record<string, unknown> = { name, updated_at: new Date().toISOString() };
  const type = KID_ACCOUNT_TYPES.find((t) => t.type === text(formData, "type"));
  if (type) {
    patch.subtype = type.type;
    patch.tax_treatment = type.tax;
    patch.retirement_kind = type.retirementKind;
  }

  const { error } = bucketId
    ? await supabase.from("buckets").update(patch).eq("id", bucketId).eq("account_id", accountId).eq("household_id", household.id)
    : await supabase.from("accounts").update(patch).eq("id", accountId).eq("household_id", household.id);
  if (error) return error.code === "23505" ? { error: `You already have one named "${name}".` } : saveFailed(error);
  revalidateKids();
  return { error: null };
}

export async function endKidItem(formData: FormData): Promise<Result> {
  const session = await getSessionContext();
  const accountId = text(formData, "accountId");
  const bucketId = orNull(formData, "bucketId");
  const reason = text(formData, "reason");
  const item = await loadItem(session, accountId, bucketId);
  if (!item) return { error: "Account not found." };

  const allowed = actionsOf(item);
  if (reason === "closed" && !allowed.close) {
    return { error: item.type === "UTMA" ? `This UTMA is ${item.kid?.name ?? "the child"}'s money, so it can only close at $0.` : "This account can't be closed." };
  }
  if (reason === "handed_over" && !allowed.handOver) return { error: "It can't be handed over yet." };

  const { error } = await session.supabase.rpc("kids_end_item", {
    p_account_id: accountId,
    p_bucket_id: bucketId,
    p_reason: reason,
    p_on: text(formData, "date") || today(),
    p_note: orNull(formData, "note"),
  });
  if (error) return { error: error.message };
  await captureSnapshots(session.supabase, session.household.id, { force: true });
  revalidateKids();
  return { error: null };
}

export async function reopenKidItem(formData: FormData): Promise<Result> {
  const { supabase, household } = await getSessionContext();
  const { error } = await supabase.rpc("kids_reopen_item", {
    p_account_id: text(formData, "accountId"),
    p_bucket_id: orNull(formData, "bucketId"),
  });
  if (error) return { error: error.message };
  await captureSnapshots(supabase, household.id, { force: true });
  revalidateKids();
  return { error: null };
}

export async function changeKidBeneficiary(formData: FormData): Promise<Result> {
  const session = await getSessionContext();
  const accountId = text(formData, "accountId");
  const bucketId = orNull(formData, "bucketId");
  const item = await loadItem(session, accountId, bucketId);
  if (!item) return { error: "Account not found." };
  if (!actionsOf(item).changeBeneficiary) return { error: "Only a 529 can change beneficiary." };

  let toKidId = text(formData, "toKidId");
  // Someone not listed yet: a grandchild, a niece.
  if (toKidId === "__new") {
    const created = await saveKid(formData);
    if (created.error || !created.id) return { error: created.error ?? "Couldn't add them." };
    toKidId = created.id;
  }
  if (!toKidId) return { error: "Pick who it's for now." };

  const { error } = await session.supabase.rpc("kids_change_beneficiary", {
    p_account_id: accountId,
    p_bucket_id: bucketId,
    p_to_kid_id: toKidId,
    p_on: text(formData, "date") || today(),
    p_note: orNull(formData, "note"),
  });
  if (error) return { error: error.code === "23505" ? "Another account already has that name. Rename this one first." : error.message };
  revalidateKids();
  return { error: null };
}

// Part of one 529 into another. It goes through the same transfer every other
// move uses, so it's listed in Transfer Activity and deleting it there undoes it.
export async function moveBetween529s(formData: FormData): Promise<Result> {
  const session = await getSessionContext();
  const fromAccountId = text(formData, "fromAccountId");
  const fromBucketId = orNull(formData, "fromBucketId");
  const [toAccountId, toBucketId = ""] = text(formData, "to").split(":");
  const from = await loadItem(session, fromAccountId, fromBucketId);
  const to = await loadItem(session, toAccountId, toBucketId || null);
  if (!from || !to) return { error: "Pick both 529s." };
  if (from.type !== "529" || to.type !== "529") return { error: "This only moves money between 529s." };

  const amountCents = displayToCents(text(formData, "amount"));
  if (amountCents <= 0) return { error: "Enter an amount." };
  if (amountCents > from.balanceCents) return { error: "That's more than this 529 holds." };

  const date = text(formData, "date") || today();
  const note = orNull(formData, "note");
  const transfer = new FormData();
  transfer.set("fromAccountId", fromAccountId);
  transfer.set("fromBucketId", fromBucketId ?? "");
  transfer.set("toAccountId", toAccountId);
  transfer.set("toBucketId", toBucketId);
  transfer.set("amount", text(formData, "amount"));
  transfer.set("date", date);
  transfer.set("memo", note ?? `${from.name} to ${to.name}`);
  transfer.set("cleared", "on");
  const result = await transferBetweenAccounts(transfer);
  if (result.error) return { error: result.error };

  const { supabase, household } = session;
  const { error } = await supabase.from("kids_account_events").insert([
    { household_id: household.id, event: "moved_529", account_id: fromAccountId, bucket_id: fromBucketId, from_kid_id: from.kidId, to_kid_id: to.kidId, amount_cents: amountCents, detail: `To ${to.name}`, note, occurred_on: date },
    { household_id: household.id, event: "moved_529", account_id: toAccountId, bucket_id: toBucketId || null, from_kid_id: from.kidId, to_kid_id: to.kidId, amount_cents: amountCents, detail: `From ${from.name}`, note, occurred_on: date },
  ]);
  revalidateKids();
  // The money has moved by here, so a failure says so rather than inviting a
  // second try that would move it twice.
  return { error: error ? "Moved, but it couldn't be added to the history." : null };
}
