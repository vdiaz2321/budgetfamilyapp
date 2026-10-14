"use client";

import { useSyncExternalStore } from "react";

// ---- A credit card drawn in its brand's look, for the Accounts tiles.
//
// No card images: Victor didn't want to upload 13 pictures, so each card is
// drawn from its name — Platinum silver, Gold gold, Brilliant black, and so on
// (2026-10-14). The last four digits sit on the face, so the tile's name drops
// them. Brand colours on a card face are a picture of the card, not data, so
// the gold here doesn't break the no-amber rule for charts and figures.

type Face = { bg: string; ink: string; chip: string };

const FACES = {
  platinum: { bg: "linear-gradient(135deg,#eef0f3 0%,#c9cdd3 45%,#a9aeb6 100%)", ink: "#1f2937", chip: "#8b9099" },
  gold: { bg: "linear-gradient(135deg,#f1e2b0 0%,#d6bb72 50%,#b8984c 100%)", ink: "#3d2c06", chip: "#a8864a" },
  graphite: { bg: "linear-gradient(135deg,#4b515a 0%,#2b2f36 55%,#16191d 100%)", ink: "#f1f5f9", chip: "#c3c7cd" },
  black: { bg: "linear-gradient(135deg,#3a3a3f 0%,#1c1c1f 50%,#0a0a0b 100%)", ink: "#f4f4f5", chip: "#b9b9be" },
  navy: { bg: "linear-gradient(135deg,#2d4f8f 0%,#1c3366 55%,#0f1f45 100%)", ink: "#e6f1fb", chip: "#c7cdd6" },
  sapphire: { bg: "linear-gradient(135deg,#2a5aa8 0%,#183d7a 55%,#0c2552 100%)", ink: "#e6f1fb", chip: "#c7cdd6" },
  teal: { bg: "linear-gradient(135deg,#1f6f86 0%,#124c60 55%,#0a2f3d 100%)", ink: "#e1f5f8", chip: "#c3d3d8" },
  slate: { bg: "linear-gradient(135deg,#3f5269 0%,#26344a 55%,#141d2b 100%)", ink: "#e6edf5", chip: "#c3c9d1" },
  sky: { bg: "linear-gradient(135deg,#f0f8ff 0%,#cfe7f8 50%,#a9d2ef 100%)", ink: "#0c3352", chip: "#8fb2cc" },
  amex: { bg: "linear-gradient(135deg,#7cc4ea 0%,#3b8fc4 55%,#1f6a9c 100%)", ink: "#f0f9ff", chip: "#d6e6f1" },
} satisfies Record<string, Face>;

/** Which face a card gets, from its name first and its bank second. */
function faceFor(name: string, bank: string | null): Face {
  const n = name.toLowerCase();
  if (n.includes("brilliant") || n.includes("brillant")) return FACES.black;
  if (n.includes("plat")) return FACES.platinum;
  if (n.includes("reserve") && n.includes("delta")) return FACES.graphite;
  // "1003 Delta Amex" is the Delta SkyMiles Gold card.
  if (n.includes("gold") || n.includes("delta")) return FACES.gold;
  if (n.includes("bonvoy") || n.includes("marriott")) return FACES.sky;
  if (n.includes("hilton") || n.includes("aspire")) return FACES.navy;
  if (n.includes("sapphire")) return FACES.sapphire;
  if (n.includes("hyatt")) return FACES.teal;
  if (n.includes("venture") || n.includes("ihg")) return FACES.slate;
  const b = (bank ?? "").toLowerCase();
  if (b.includes("amex") || b.includes("american")) return FACES.amex;
  if (b.includes("chase")) return FACES.sapphire;
  return FACES.slate;
}

/** The four digits a card's name starts with ("1175 Sapphire V"), if any. */
export function cardLastFour(name: string): string | null {
  return name.match(/^\s*(\d{4})\b/)?.[1] ?? null;
}

/** The name without its leading four digits — the face already shows them. */
export function cardShortName(name: string): string {
  return name.replace(/^\s*\d{4}\s+/, "") || name;
}

export function CardFace({ name, bank, muted = false }: { name: string; bank: string | null; muted?: boolean }) {
  const face = faceFor(name, bank);
  const last4 = cardLastFour(name);
  return (
    <span
      aria-hidden
      className={`relative block h-[2.9rem] w-[4.6rem] shrink-0 overflow-hidden rounded-md shadow-sm ring-1 ring-black/10 ${muted ? "opacity-50" : ""}`}
      style={{ background: face.bg }}
    >
      {/* The EMV chip */}
      <span className="absolute left-2 top-[1.05rem] h-[0.6rem] w-[0.8rem] rounded-[2px]" style={{ background: face.chip }} />
      {last4 ? (
        <span className="absolute bottom-1 right-1.5 text-[11px] font-semibold tabular-nums tracking-wide" style={{ color: face.ink }}>
          {last4}
        </span>
      ) : null}
    </span>
  );
}

// ---- Payment due dates

/** Today in the browser's own time zone ("YYYY-MM-DD"); null while rendering
 *  on the server, so the server (UTC) and Victor's clock (Germany) never
 *  disagree about which day it is. */
export function useLocalToday(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => null,
  );
}

/** The next time a card's due day comes round, today counting — clamped to
 *  the month's last day (a "31" card is due on 30 Apr). */
export function nextDueDate(dueDay: number, todayIso: string): { iso: string; daysLeft: number } {
  const [y, m, d] = todayIso.split("-").map(Number);
  const clamp = (year: number, month: number) => Math.min(dueDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  let year = y;
  let month = m;
  if (d > clamp(year, month)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const day = clamp(year, month);
  const due = Date.UTC(year, month - 1, day);
  const today = Date.UTC(y, m - 1, d);
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    daysLeft: Math.round((due - today) / 86_400_000),
  };
}

/** A due date within this many days reads red. */
export const DUE_SOON_DAYS = 7;

export function formatDueDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}
