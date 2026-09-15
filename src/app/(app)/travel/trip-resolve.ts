import type { createClient } from "@/lib/supabase/server";

// Not a "use server" file: only the save actions call this.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

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
): Promise<{ tripId: string | null; error: string | null }> {
  const name = (newTripName ?? "").trim();
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
    return { tripId: data.id, error: null };
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
