// How many months a section popup shows, newest first. Columns past the first
// appear only as the popup gets wide enough for them.
export const MONTH_COLUMNS = 7;
// Column visibility, by index: month 0 always, 1-2 once the panel clears
// 560px, 3-4 once it clears 860px, 5-6 once it clears 1180px (all 7rem — a 6-figure
// amount like $127,000.00 overflows a 6rem column). Kept as literal class strings because
// Tailwind only generates the arbitrary values it can see in the source.
// Written out in full rather than built by string surgery: Tailwind only
// emits the arbitrary variants it can literally see in the source, so a class
// assembled at runtime silently never gets any CSS.
const MONTH_TIER = ["", "hidden @[560px]:contents", "hidden @[860px]:contents", "hidden @[1180px]:contents"] as const;
const MONTH_HEAD_TIER = ["", "hidden @[560px]:block", "hidden @[860px]:block", "hidden @[1180px]:block"] as const;
// Both take the column's DISTANCE FROM THE ANCHOR (the selected period), not
// its raw index. Months read newest -> oldest (Victor wants the current month
// first), so the anchor is column 0 and a narrow popup keeps the columns
// nearest it.
export const monthTier = (distance: number) =>
  distance === 0 ? MONTH_TIER[0] : distance <= 2 ? MONTH_TIER[1] : distance <= 4 ? MONTH_TIER[2] : MONTH_TIER[3];
export const monthHeadTier = (distance: number) =>
  distance === 0 ? MONTH_HEAD_TIER[0] : distance <= 2 ? MONTH_HEAD_TIER[1] : distance <= 4 ? MONTH_HEAD_TIER[2] : MONTH_HEAD_TIER[3];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-07-01" -> "Jul"
export function monthAbbr(firstOfMonth: string): string {
  return MONTH_ABBR[parseInt(firstOfMonth.slice(5, 7), 10) - 1] ?? "";
}
