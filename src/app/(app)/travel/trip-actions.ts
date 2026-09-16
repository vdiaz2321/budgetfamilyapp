"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { deleteTravelStay } from "./actions";
import { deleteTravelCar } from "./car-actions";
import { deleteTravelFlight } from "./flight-actions";

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

// Deletes the trip and everything in it: its stays, flights and rentals go
// through their own deletes (so points they took come back to the card), and
// its spending rows go with the trip (ON DELETE CASCADE).
export async function deleteTrip(id: string) {
  const { supabase, household } = await getSessionContext();
  const householdId = household.id;
  const [stays, flights, cars] = await Promise.all([
    supabase.from("travel_stays").select("id").eq("trip_id", id).eq("household_id", householdId),
    supabase.from("travel_flights").select("id").eq("trip_id", id).eq("household_id", householdId),
    supabase.from("travel_cars").select("id").eq("trip_id", id).eq("household_id", householdId),
  ]);
  const lookupError = stays.error ?? flights.error ?? cars.error;
  if (lookupError) return { error: `Couldn't load that trip's bookings — ${lookupError.message}` };

  for (const s of stays.data ?? []) {
    const fd = new FormData();
    fd.set("id", s.id);
    const result = await deleteTravelStay(fd);
    if (result?.error) return { error: result.error };
  }
  for (const f of flights.data ?? []) {
    const result = await deleteTravelFlight(f.id);
    if (result?.error) return { error: result.error };
  }
  for (const c of cars.data ?? []) {
    const result = await deleteTravelCar(c.id);
    if (result?.error) return { error: result.error };
  }

  const { error } = await supabase.from("travel_trips").delete().eq("id", id).eq("household_id", householdId);
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
