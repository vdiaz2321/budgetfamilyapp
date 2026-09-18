import type { createClient } from "@/lib/supabase/server";

// Not a "use server" file: only the save actions call this.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// `created` is true when this call made the trip. A save that fails after
// this point (the card is short of points, say) hands it to discardNewTrip so
// an empty trip isn't left behind.
export type TripResolution = { tripId: string | null; error: string | null; created?: boolean };

/**
 * A booking dated outside the trip it is filed under is refused — nearly
 * always a wrong year. Only trips with their own dates are checked; a trip
 * this save just created has none yet.
 */
export async function tripDateError(
  supabase: SupabaseClient,
  householdId: string,
  trip: TripResolution,
  dates: Array<string | null | undefined>,
  what: string,
): Promise<string | null> {
  if (!trip.tripId || trip.created) return null;
  const typed = dates.filter((d): d is string => Boolean(d));
  if (typed.length === 0) return null;
  const { data, error } = await supabase
    .from("travel_trips")
    .select("name, start_on, end_on")
    .eq("id", trip.tripId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error || !data || (!data.start_on && !data.end_on)) return null;
  const outside = typed.some((d) => (data.start_on && d < data.start_on) || (data.end_on && d > data.end_on));
  if (!outside) return null;
  return `${what} falls outside ${data.name} (${data.start_on ?? "…"} to ${data.end_on ?? "…"}) — check the year, or change the trip's dates first.`;
}

export async function discardNewTrip(supabase: SupabaseClient, householdId: string, trip: TripResolution) {
  if (!trip.created || !trip.tripId) return;
  await supabase.from("travel_trips").delete().eq("id", trip.tripId).eq("household_id", householdId);
}

/**
 * The trip a booking is being saved into. A picked trip is checked to belong
 * to this household; a typed new name creates the trip — or reuses one that
 * already has that name, so typing "Malaga" twice doesn't make two trips.
 */
export async function resolveTripId(
  supabase: SupabaseClient,
  householdId: string,
  tripId: string | null | undefined,
  newTripName: string | null | undefined,
): Promise<TripResolution> {
  // Typed as "Greece - May 2027" (the placeholder in the field); stored with
  // the middle dot every existing trip uses, so the reuse check below matches.
  const name = (newTripName ?? "").trim().replace(/\s+[-–—·]\s+/g, " · ").replace(/\s+/g, " ");
  if (name) {
    const { data: existing, error: findError } = await supabase
      .from("travel_trips")
      .select("id")
      .eq("household_id", householdId)
      // Escaped so a % or _ in a trip name matches itself, not "anything".
      .ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`))
      .maybeSingle();
    if (findError) return { tripId: null, error: `Couldn't look up that trip — ${findError.message}` };
    if (existing) return { tripId: existing.id, error: null };
    const { data, error } = await supabase
      .from("travel_trips")
      .insert({ household_id: householdId, name })
      .select("id")
      .single();
    if (error) return { tripId: null, error: `Couldn't create that trip — ${error.message}` };
    return { tripId: data.id, error: null, created: true };
  }
  const id = (tripId ?? "").trim();
  if (!id) return { tripId: null, error: null };
  const { data, error } = await supabase
    .from("travel_trips")
    .select("id")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) return { tripId: null, error: `Couldn't look up that trip — ${error.message}` };
  if (!data) return { tripId: null, error: "That trip no longer exists — pick another." };
  return { tripId: data.id, error: null };
}
