import type { TripChoice } from "./trip-picker";

/**
 * A booking form shown as one section of the Add Travel Log popup instead of
 * its own popup: the trip comes from the popup's shared picker, and the popup's
 * single save button drives each section through this handle.
 */
export type SectionHandle = {
  /** Nothing typed yet — the save skips it. */
  isEmpty: () => boolean;
  save: () => Promise<{ error: string | null }>;
};

export type Embed = {
  trip: TripChoice;
  /** Called after every render with the section's current handle. */
  register: (handle: SectionHandle) => void;
};
