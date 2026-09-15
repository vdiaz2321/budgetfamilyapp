"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";

export async function renameTrip(id: string, name: string) {
  const { supabase, household } = await getSessionContext();
  const clean = name.trim();
  if (!clean) return { error: "Type a trip name." };
  const { error } = await supabase
    .from("travel_trips")
    .update({ name: clean })
    .eq("id", id)
    .eq("household_id", household.id);
  if (error) {
    if (error.code === "23505") return { error: `There's already a trip called ${clean}.` };
    return { error: `Couldn't rename that trip — ${error.message}` };
  }
  revalidatePath("/travel");
  return { error: null };
}

// Deletes the trip only. Its flights, stays and cars stay in their logs, just
// no longer grouped (the foreign keys are ON DELETE SET NULL).
export async function deleteTrip(id: string) {
  const { supabase, household } = await getSessionContext();
  const { error } = await supabase.from("travel_trips").delete().eq("id", id).eq("household_id", household.id);
  if (error) return { error: `Couldn't delete that trip — ${error.message}` };
  revalidatePath("/travel");
  return { error: null };
}

// A trip's own details: its name, the dates it spans, and a note.
export async function updateTrip(id: string, fields: { name: string; startOn: string; endOn: string; notes: string }) {
  const { supabase, household } = await getSessionContext();
  const name = fields.name.trim();
  const startOn = fields.startOn.trim() || null;
  const endOn = fields.endOn.trim() || null;
  if (!name) return { error: "Type a trip name." };
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if ((startOn && !isDate(startOn)) || (endOn && !isDate(endOn))) return { error: "Enter valid trip dates." };
  if (startOn && endOn && endOn < startOn) return { error: "The trip ends before it starts — check the year." };
  const { error } = await supabase
    .from("travel_trips")
    .update({ name, start_on: startOn, end_on: endOn, notes: fields.notes.trim() || null })
    .eq("id", id)
    .eq("household_id", household.id);
  if (error) {
    if (error.code === "23505") return { error: `There's already a trip called ${name}.` };
    return { error: `Couldn't save that trip — ${error.message}` };
  }
  revalidatePath("/travel");
  return { error: null };
}
