"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { hasHandOverAge, institutionLabelFor, isChildOwned, KID_ACCOUNT_TYPES, kidActionsFor, kidTypeLocked, kidTypeOf, monthAtAge, parseUtma, utmaStateName } from "@/lib/kids-funding";
import { addAccount, deleteAccount, deleteBucket, transferBetweenAccounts } from "./actions";

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
    .select("id, name, subtype, retirement_kind, kid_id, is_kids_account, current_balance_cents, institution, account_number, controlled_by, utma_state, utma_handover_age, date_closed")
    .eq("id", accountId)
    .eq("household_id", household.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the account: ${error.message}`);
  if (!account?.is_kids_account) return null;

  let bucket: { name: string; subtype: string | null; retirement_kind: string | null; kid_id: string | null; balance_cents: number | null; institution: string | null; account_number: string | null; controlled_by: string | null; utma_state: string | null; utma_handover_age: number | null; date_closed: string | null } | null = null;
  if (bucketId) {
    const { data, error: bucketError } = await supabase
      .from("buckets")
      .select("name, subtype, retirement_kind, kid_id, balance_cents, institution, account_number, controlled_by, utma_state, utma_handover_age, date_closed")
      .eq("id", bucketId)
      .eq("account_id", accountId)
      .eq("household_id", household.id)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not read the bucket: ${bucketError.message}`);
    if (!data) return null;
    bucket = data;
  }

  const kidId = bucket ? bucket.kid_id ?? account.kid_id : account.kid_id;
  let kid: { name: string; birth_month: string } | null = null;
  if (kidId) {
    const { data, error: kidError } = await supabase
      .from("kids")
      .select("name, birth_month")
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
    // A bucket's institution falls back as the popup shows it, so history reads the same.
    institution: bucket ? bucket.institution ?? account.institution ?? account.name : account.institution,
    accountNumber: bucket ? bucket.account_number : account.account_number,
    controlledBy: bucket?.controlled_by ?? account.controlled_by ?? null,
    utmaState: bucket ? bucket.utma_state : account.utma_state,
    utmaAge: bucket ? bucket.utma_handover_age : account.utma_handover_age,
    closed: (bucket ? bucket.date_closed : account.date_closed) != null,
  };
}

const actionsOf = (item: NonNullable<Awaited<ReturnType<typeof loadItem>>>) =>
  kidActionsFor({
    type: item.type,
    balanceCents: item.balanceCents,
    birthMonth: item.kid?.birth_month ?? null,
    utmaAge: item.utmaAge,
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

// The details an edit can change. A change to one keeps a line in the item's
// history; filling in a blank isn't worth recording.
const DETAIL_FIELDS = [
  { field: "institution", column: "institution", label: null },
  { field: "accountNumber", column: "account_number", label: "Account #" },
] as const;

const lastFour = (n: string | null) => n?.replace(/\s/g, "").slice(-4) ?? null;

// Everything about one account, on one Save. The form sends only what changed, so
// a value inherited from the parent account is never copied down onto a bucket.
// All of it is checked first, then written in the one order that can't repeat a
// money move on a retry: details, new child, the move, then the close.
export async function saveKidItem(formData: FormData): Promise<Result & { moved?: boolean }> {
  const session = await getSessionContext();
  const { supabase, household } = session;
  const accountId = text(formData, "accountId");
  const bucketId = orNull(formData, "bucketId");
  const item = await loadItem(session, accountId, bucketId);
  if (!item) return { error: "Account not found." };
  if (item.closed) return { error: "This one is closed. Reopen it first." };
  const allowed = actionsOf(item);
  const childName = item.kid?.name ?? "the child";

  const patch: Record<string, unknown> = {};
  if (formData.has("name")) {
    const name = text(formData, "name");
    if (!name) return { error: "Enter a name." };
    patch.name = name;
  }

  if (formData.has("type")) {
    const type = KID_ACCOUNT_TYPES.find((t) => t.type === text(formData, "type"));
    if (!type) return { error: "Pick an account type." };
    const events = supabase.from("kids_account_events").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("account_id", accountId);
    const [eventCount, monthCount] = await Promise.all([
      bucketId ? events.eq("bucket_id", bucketId) : events.is("bucket_id", null),
      bucketId
        ? supabase.from("bucket_snapshots").select("month", { count: "exact", head: true }).eq("household_id", household.id).eq("bucket_id", bucketId)
        : supabase.from("account_snapshots").select("month", { count: "exact", head: true }).eq("household_id", household.id).eq("account_id", accountId),
    ]);
    if (eventCount.error || monthCount.error) return saveFailed((eventCount.error ?? monthCount.error)!);
    if (kidTypeLocked(item.type, (eventCount.count ?? 0) > 0, monthCount.count ?? 0)) {
      return { error: "An account can't change type. If it was entered wrong, delete it and add it again." };
    }
    patch.subtype = type.type;
    patch.tax_treatment = type.tax;
    patch.retirement_kind = type.retirementKind;
  }

  if (formData.has("kidId")) {
    // Who a funded account belongs to is a legal fact, or (a 529) a transfer that
    // keeps a record. Only one with nobody set yet, or a bank account, moves here.
    const bank = item.type === "Checking" || item.type === "Savings";
    if (item.kidId && !bank) {
      return { error: isChildOwned(item.type) && item.type !== "ABLE Account" ? `This legally belongs to ${childName}, so it can't move to another child.` : "Use Transfer to another child for this." };
    }
    const kidId = orNull(formData, "kidId");
    patch.kid_id = kidId;
    if (!bucketId && kidId) {
      const { data: kid, error: kidError } = await supabase.from("kids").select("name").eq("id", kidId).eq("household_id", household.id).maybeSingle();
      if (kidError) return saveFailed(kidError);
      patch.holder = kid?.name ?? null;
    }
  }

  const details: string[] = [];
  const oldDetail = { institution: item.institution, accountNumber: lastFour(item.accountNumber) };
  for (const { field, column, label } of DETAIL_FIELDS) {
    if (!formData.has(field)) continue;
    const v = orNull(formData, field);
    patch[column] = v;
    if (oldDetail[field] && oldDetail[field] !== v) details.push(`${label ?? institutionLabelFor(item.type)}: ${oldDetail[field]} to ${v ?? "not set"}`);
  }

  // Only a UTMA has a state; a UTMA or custodial Roth IRA has an age. An account
  // retyped away from them drops what it no longer has.
  const typeNow = (patch.subtype as string | undefined) ?? item.type;
  if (hasHandOverAge(typeNow)) {
    const utma = parseUtma(typeNow === "UTMA" ? text(formData, "utmaState") : "", text(formData, "utmaAge"));
    if (utma.error) return { error: utma.error };
    if (typeNow !== "UTMA" && item.utmaState) patch.utma_state = null;
    if (typeNow === "UTMA" && formData.has("utmaState")) {
      patch.utma_state = utma.state;
      if (item.utmaState && item.utmaState !== utma.state) details.push(`State: ${utmaStateName(item.utmaState)} to ${utmaStateName(utma.state) ?? "not set"}`);
    }
    if (formData.has("utmaAge")) {
      patch.utma_handover_age = utma.age;
      if (item.utmaAge != null && item.utmaAge !== utma.age) details.push(`Age to transfer: ${item.utmaAge} to ${utma.age ?? "not set"}`);
    }
  } else if (hasHandOverAge(item.type)) {
    patch.utma_state = null;
    patch.utma_handover_age = null;
  }

  const toKid = text(formData, "toKidId");
  const transferring = toKid !== "";
  const part = transferring && text(formData, "howMuch") === "part";
  const tracking = text(formData, "tracking");
  const stopping = tracking === "closed";
  const handingOver = tracking === "handed_over";
  const date = text(formData, "date") || today();
  const note = orNull(formData, "note");
  const endNote = orNull(formData, "endNote");
  const newKidName = text(formData, "newKidName");
  const amountCents = part ? displayToCents(text(formData, "amount")) : 0;
  // The whole account leaves, so there's nothing of it to keep tracking here.
  const wholeGone = transferring && !part && stopping;

  if ((transferring || stopping || handingOver) && date > today()) return { error: "Pick a date that isn't in the future." };
  if (transferring) {
    if (!allowed.changeBeneficiary) return { error: "Only a 529, Coverdell ESA or ABLE account can change beneficiary." };
    if (part && item.type !== "529") return { error: "Only a 529 can move part of its money. This changes beneficiary as a whole." };
    if (toKid === item.kidId) return { error: `It's already for ${childName}.` };
    if (toKid === "__new" && !newKidName) return { error: "Enter their name." };
    // No longer tracked, so they don't need a strip of their own here.
    if (toKid === "__new" && !wholeGone && !monthFirst(text(formData, "newKidBorn"))) return { error: "Enter the month and year they were born." };
    // 530(d)(6): a Coverdell keeps its tax status only for a new beneficiary under 30.
    if (item.type === "Coverdell ESA") {
      let born = toKid === "__new" ? monthFirst(text(formData, "newKidBorn")) : null;
      if (toKid !== "__new") {
        const { data: to, error: toError } = await supabase.from("kids").select("birth_month").eq("id", toKid).eq("household_id", household.id).maybeSingle();
        if (toError) return saveFailed(toError);
        born = to?.birth_month ?? null;
      }
      if (!born) return { error: "Enter the month and year they were born. A Coverdell can only go to someone under 30." };
      if (monthAtAge(born, 30) <= date) return { error: "A Coverdell can only go to someone under 30, or it's taxed." };
    }
    if (part && amountCents <= 0) return { error: "Enter an amount." };
    if (part && amountCents > item.balanceCents) return { error: "That's more than this 529 holds." };
  }
  if (stopping && !allowed.close) {
    return { error: isChildOwned(item.type) ? `This is ${childName}'s money, so it can only stop at $0.` : "This account can't be closed." };
  }
  if (handingOver && (!allowed.handOver || transferring)) return { error: "It can't be transferred yet." };
  if (stopping && !wholeGone && item.balanceCents - amountCents > 0 && !endNote) {
    return { error: part ? "Say where the rest went." : "Say where the money went." };
  }

  let toName = newKidName;
  if (transferring && toKid !== "__new") {
    const { data: kid, error } = await supabase.from("kids").select("name").eq("id", toKid).eq("household_id", household.id).maybeSingle();
    if (error) return saveFailed(error);
    if (!kid) return { error: "Pick who it's for now." };
    toName = kid.name;
  }

  // Everything checks out, so now it's written.
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error } = bucketId
      ? await supabase.from("buckets").update(patch).eq("id", bucketId).eq("account_id", accountId).eq("household_id", household.id)
      : await supabase.from("accounts").update(patch).eq("id", accountId).eq("household_id", household.id);
    if (error) return error.code === "23505" ? { error: `You already have one named "${String(patch.name ?? item.name)}".` } : saveFailed(error);
    if (details.length > 0) {
      const { error: historyError } = await supabase.from("kids_account_events").insert(
        details.map((detail) => ({ household_id: household.id, event: "details_changed", account_id: accountId, bucket_id: bucketId, detail, occurred_on: today() })),
      );
      if (historyError) console.error("[kids funding history]", historyError.message);
    }
  }

  let moved = false;
  let warning: string | null = null;
  if (transferring && !wholeGone) {
    let toKidId = toKid;
    // Someone not listed yet: a grandchild, a niece, a newborn.
    if (toKid === "__new") {
      const person = new FormData();
      person.set("name", newKidName);
      person.set("birthMonth", text(formData, "newKidBorn"));
      const created = await saveKid(person);
      if (created.error === `${newKidName} is already listed.`) return { error: `${newKidName} is already listed. Pick them from the list.` };
      if (created.error || !created.id) return { error: created.error ?? "Couldn't add them." };
      toKidId = created.id;
    }

    if (part) {
      let target = text(formData, "to");
      // They have no 529 yet, so this starts one, as Add account would.
      if (!target) {
        const preset = KID_ACCOUNT_TYPES.find((t) => t.type === "529")!;
        const opened = new FormData();
        opened.set("kidsAccount", "on");
        opened.set("kind", preset.kind);
        opened.set("subtype", preset.type);
        opened.set("taxTreatment", preset.tax);
        opened.set("retirementKind", "");
        opened.set("holder", toName);
        opened.set("kidId", toKidId);
        opened.set("name", `529 ${toName}`);
        opened.set("institution", text(formData, "newInstitution"));
        opened.set("accountNumber", text(formData, "newLast4"));
        opened.set("controlledBy", String(patch.controlled_by ?? item.controlledBy ?? ""));
        opened.set("balance", "0");
        const added = await addAccount(opened);
        if (!added.id) return { error: added.error ?? `Couldn't start a 529 for ${toName}.` };
        // The account is there even if its Budget item isn't, so the money still moves.
        warning = added.error;
        target = `${added.id}:`;
      }
      const transfer = new FormData();
      transfer.set("fromAccountId", accountId);
      transfer.set("fromBucketId", bucketId ?? "");
      transfer.set("to", target);
      transfer.set("amount", text(formData, "amount"));
      transfer.set("date", date);
      if (note) transfer.set("note", note);
      const result = await moveBetween529s(transfer);
      if (!result.moved) {
        revalidateKids();
        return { error: result.error ?? "Couldn't move the money." };
      }
      moved = true;
    } else {
      const { error } = await supabase.rpc("kids_change_beneficiary", {
        p_account_id: accountId,
        p_bucket_id: bucketId,
        p_to_kid_id: toKidId,
        p_on: date,
        p_note: note,
      });
      if (error) return { error: error.code === "23505" ? "Another account already has that name. Rename this one first." : error.message };
    }
  }

  if (stopping || handingOver) {
    const { error } = await supabase.rpc("kids_end_item", {
      p_account_id: accountId,
      p_bucket_id: bucketId,
      p_reason: tracking,
      p_on: date,
      p_note: wholeGone ? `Transferred to ${toName}${note ? `. ${note}` : ""}` : endNote,
    });
    if (error) {
      revalidateKids();
      return moved
        ? { error: `The money moved to ${toName}, but this one couldn't stop tracking: ${error.message}`, moved: true }
        : { error: error.message };
    }
    await captureSnapshots(supabase, household.id, { force: true });
  }

  revalidateKids();
  return { error: warning, moved };
}

// The Budget items made for an account, split by whether they can go with it.
// One with anything logged or set up against it stays: erasing it would take that
// with it or leave it pointing at nothing. Its planned amounts go with it.
async function budgetItemsOf({ supabase, household }: Session, accountId: string, bucketId: string | null) {
  const linked = supabase.from("subcategories").select("id, name").eq("household_id", household.id);
  const { data, error } = await (bucketId ? linked.eq("linked_bucket_id", bucketId) : linked.eq("linked_account_id", accountId).is("linked_bucket_id", null));
  if (error) throw new Error(`Could not read the Budget items: ${error.message}`);
  const erase: { id: string; name: string }[] = [];
  const keep: { id: string; name: string }[] = [];
  for (const sub of data ?? []) {
    const uses = await Promise.all(
      (["transactions", "subscriptions", "irregular_bills", "savings_goals", "debts"] as const).map((table) =>
        supabase.from(table).select("subcategory_id", { count: "exact", head: true }).eq("household_id", household.id).eq("subcategory_id", sub.id),
      ),
    );
    const failed = uses.find((u) => u.error);
    if (failed?.error) throw new Error(`Could not read what uses the Budget item: ${failed.error.message}`);
    (uses.some((u) => (u.count ?? 0) > 0) ? keep : erase).push(sub);
  }
  return { erase, keep };
}

// What Delete would do to the Budget, so its warning can say so before it happens.
export async function kidItemBudgetItems(accountId: string, bucketId: string | null): Promise<Result & { erase: string[]; keep: string[] }> {
  const session = await getSessionContext();
  const none = { erase: [], keep: [] };
  if (!(await loadItem(session, accountId, bucketId))) return { error: "Account not found.", ...none };
  try {
    const { erase, keep } = await budgetItemsOf(session, accountId, bucketId);
    return { error: null, erase: erase.map((s) => s.name), keep: keep.map((s) => s.name) };
  } catch (e) {
    return { ...saveFailed(e as Error), ...none };
  }
}

// For a row entered by mistake: the account, its past months and the Budget item
// made with it. The Budget item goes first, since once the account is gone nothing
// links the two, and a failure there leaves everything as it was.
export async function deleteKidItem(formData: FormData): Promise<Result> {
  const session = await getSessionContext();
  const { supabase, household } = session;
  const accountId = text(formData, "accountId");
  const bucketId = orNull(formData, "bucketId");
  if (!(await loadItem(session, accountId, bucketId))) return { error: "Account not found." };

  const { erase } = await budgetItemsOf(session, accountId, bucketId);
  if (erase.length > 0) {
    const { error } = await supabase.from("subcategories").delete().eq("household_id", household.id).in("id", erase.map((s) => s.id));
    if (error) return saveFailed(error);
  }

  const target = new FormData();
  target.set("id", bucketId ?? accountId);
  await (bucketId ? deleteBucket(target) : deleteAccount(target));
  if (await loadItem(session, accountId, bucketId)) return { error: "Couldn't delete the account. Please try again." };
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

// Part of one 529 into another. It goes through the same transfer every other
// move uses, so it's listed in Transfer Activity and deleting it there undoes it.
async function moveBetween529s(formData: FormData): Promise<Result & { moved?: boolean }> {
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
  // Only marking it cleared can fail after the money has moved.
  if (result.error) return { error: result.error, moved: result.error.startsWith("Transfer saved") };

  const { supabase, household } = session;
  const { error } = await supabase.from("kids_account_events").insert([
    { household_id: household.id, event: "moved_529", account_id: fromAccountId, bucket_id: fromBucketId, from_kid_id: from.kidId, to_kid_id: to.kidId, amount_cents: amountCents, detail: `To ${to.name}`, note, occurred_on: date },
    { household_id: household.id, event: "moved_529", account_id: toAccountId, bucket_id: toBucketId || null, from_kid_id: from.kidId, to_kid_id: to.kidId, amount_cents: amountCents, detail: `From ${from.name}`, note, occurred_on: date },
  ]);
  revalidateKids();
  // The money has moved by here, so a failure says so rather than inviting a
  // second try that would move it twice.
  return { error: error ? "Moved, but it couldn't be added to the history." : null, moved: true };
}
