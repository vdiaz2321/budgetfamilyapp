// Past this many days a hand-entered figure (holdings, monthly performance,
// account balances) is flagged as due for an update. Victor picked 45.
const STALE_AFTER_DAYS = 45;

/** "Aug 7 · 57 days ago", plus whether that is past STALE_AFTER_DAYS. */
export function describeUpdate(iso: string): { label: string; stale: boolean } {
  const then = new Date(iso);
  const now = new Date();
  // Calendar days, not elapsed 24-hour spans: something saved last night reads
  // "yesterday" this morning, matching the date printed beside it. Both sides
  // are taken at local midnight so the count agrees with that date.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000));
  const sameYear = then.getFullYear() === now.getFullYear();
  const date = then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const ago = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return { label: `${date} · ${ago}`, stale: days > STALE_AFTER_DAYS };
}
