/**
 * Account groups: the plan's money split by kind, each growing at its own
 * rate, taking in its own contributions and paying out its own withdrawals.
 *
 * Brought over from Victor's old Financial Planner (2026-10-16), which kept
 * TSP, each Roth, taxable stocks, cash, crypto and gold apart. Grouped by
 * type rather than by account so it works for any household — "Pre-tax", not
 * "TSP".
 *
 * One year, in order:
 *   1. Every group earns its return on what it opened the year with.
 *   2. Planned withdrawals come out (today's dollars raised by inflation), and
 *      Pre-tax pays at least the required minimum from the RMD age. Each is
 *      taxed at the group's rate; what's left lands in Cash.
 *   3. The year's left-over (income − spending ± one-off) lands in Cash.
 *   4. Planned contributions move from Cash into their groups — cut back if
 *      Cash can't cover them, never borrowed for.
 *   5. If Cash is still below zero, the gap is drawn from the other groups in
 *      the usual low-tax order (Brokerage, Crypto, Metals, Pre-tax, Roth),
 *      each draw grossed up for its tax.
 *
 * Only the tax leaves net worth: a withdrawal moves money from one group into
 * Cash, so the groups always sum to start + gains + left-over − tax.
 *
 * Pure: no database, no aliases — the tests import it directly.
 */

export type GroupKind = "cash" | "pretax" | "roth" | "brokerage" | "crypto" | "metals";

export const GROUP_KINDS: GroupKind[] = ["cash", "pretax", "roth", "brokerage", "crypto", "metals"];

export const GROUP_LABEL: Record<GroupKind, string> = {
  cash: "Cash",
  pretax: "Pre-tax retirement",
  roth: "Roth retirement",
  brokerage: "Brokerage",
  crypto: "Crypto",
  metals: "Metals",
};

/** What each group usually holds — the line under its name. */
export const GROUP_HINT: Record<GroupKind, string> = {
  cash: "Checking and savings",
  pretax: "Traditional TSP, 401(k), 403(b), IRA",
  roth: "Roth TSP, Roth 401(k), Roth IRA",
  brokerage: "Taxable investment accounts",
  crypto: "Coins and crypto exchanges",
  metals: "Gold, silver and other assets",
};

/** Where a shortfall is drawn from, first to last. */
export const DRAW_ORDER: GroupKind[] = ["brokerage", "crypto", "metals", "pretax", "roth"];

/** Tax on what a group pays out when none is set: income tax on Pre-tax,
 *  capital gains on the taxable ones, nothing on Roth or Cash. */
export const DEFAULT_TAX_PCT: Record<GroupKind, number> = {
  cash: 0,
  pretax: 12,
  roth: 0,
  brokerage: 15,
  crypto: 15,
  metals: 15,
};

export function isGroupKind(value: unknown): value is GroupKind {
  return typeof value === "string" && (GROUP_KINDS as string[]).includes(value);
}

/**
 * The group an account or bucket falls in when none is picked. A bucket's own
 * labels win over its account's: the TSP account is tax-deferred, but its
 * "TSP Roth" bucket is Roth money.
 */
export function inferGroup(input: {
  accountKind: string;
  accountName?: string | null;
  accountTax?: string | null;
  accountRetirementKind?: string | null;
  bucketName?: string | null;
  bucketRetirementKind?: string | null;
}): GroupKind {
  if (input.accountKind !== "investment") return "cash";
  const names = `${input.bucketName ?? ""} ${input.accountName ?? ""}`.toLowerCase();
  if (/crypto|bitcoin|\bbtc\b|ethereum|coinbase|kraken|river|tangem|ledger/.test(names)) return "crypto";
  if (/gold|silver|bullion|metal/.test(names)) return "metals";
  const rk = input.bucketRetirementKind ?? input.accountRetirementKind ?? null;
  // A bucket name says more than the account's label (TSP Roth vs TSP).
  if (input.bucketName) {
    const b = input.bucketName.toLowerCase();
    if (/\broth\b/.test(b)) return "roth";
    if (/traditional|\btrad\b|401|403|\bira\b|tsp|pension/.test(b)) return "pretax";
  }
  if (rk === "roth_ira" || /\broth\b/.test(names)) return "roth";
  if (input.accountTax === "free") return "roth";
  if (rk === "traditional_ira" || rk === "elective_deferral" || input.accountTax === "deferred") return "pretax";
  return "brokerage";
}

// ---- Required minimum distributions (Pre-tax only; Roth has none, Roth TSP
// and Roth 401(k) included since 2024).

/** SECURE 2.0: 73 for anyone born 1951–1959, 75 from 1960. */
export function rmdStartAge(birthYear: number | null): number | null {
  if (birthYear == null) return null;
  if (birthYear <= 1950) return 72;
  return birthYear <= 1959 ? 73 : 75;
}

/** IRS Uniform Lifetime Table (2022 onward): the divisor at each age. */
const RMD_DIVISOR: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4,
  88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2,
  104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
  112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3,
  120: 2.0,
};

/** The least that must come out of `balanceCents` at `age`; 0 before the RMD age. */
export function rmdCents(balanceCents: number, age: number | null, birthYear: number | null): number {
  const from = rmdStartAge(birthYear);
  if (age == null || from == null || age < from || balanceCents <= 0) return 0;
  const divisor = RMD_DIVISOR[Math.min(120, age)] ?? 2.0;
  return Math.round(balanceCents / divisor);
}

// ---- Settings and one year of the plan.

/** A group's settings with the plan's defaults already filled in. */
export type GroupSettings = {
  kind: GroupKind;
  returnPct: number;
  /** Added a year, flat. */
  addCents: number;
  addStartYear: number | null;
  /** Last year added; null = always. A blank stored end is resolved to the
   *  year before you stop working (see resolveGroupSettings). */
  addEndYear: number | null;
  /** Paid out a year in today's dollars. */
  takeCents: number;
  takeStartYear: number | null;
  takeEndYear: number | null;
  taxPct: number;
};

export type GroupYear = {
  kind: GroupKind;
  startCents: number;
  gainCents: number;
  addCents: number;
  /** Planned withdrawal, the required minimum included. */
  takeCents: number;
  /** Of `takeCents`, the part only there because of the RMD. */
  rmdExtraCents: number;
  /** Drawn to cover a shortfall. */
  autoCents: number;
  taxCents: number;
  endCents: number;
};

export type GroupsYearResult = {
  groups: GroupYear[];
  gainCents: number;
  addCents: number;
  /** Planned + required + shortfall withdrawals, before tax. */
  withdrawnCents: number;
  taxCents: number;
  /** Cash below zero after every group was drawn: the plan has run out. */
  shortCents: number;
  balances: Record<GroupKind, number>;
};

const inYears = (year: number, start: number | null, end: number | null) =>
  (start == null || year >= start) && (end == null || year <= end);

export function emptyBalances(): Record<GroupKind, number> {
  return { cash: 0, pretax: 0, roth: 0, brokerage: 0, crypto: 0, metals: 0 };
}

/**
 * Today's group balances resized to the plan's own starting figure, keeping
 * their mix. The plan opens on its projected net worth (debts netted off,
 * the rest of this year's saving included), which never equals the accounts
 * to the dollar; spreading the difference across the groups keeps both the
 * total and the mix. Nothing in any group: it all starts as Cash.
 */
export function scaleBalances(live: Record<GroupKind, number>, totalCents: number): Record<GroupKind, number> {
  const out = emptyBalances();
  const sum = GROUP_KINDS.reduce((t, k) => t + Math.max(0, live[k]), 0);
  if (sum <= 0) {
    out.cash = totalCents;
    return out;
  }
  let given = 0;
  for (const k of GROUP_KINDS) {
    out[k] = Math.round((Math.max(0, live[k]) * totalCents) / sum);
    given += out[k];
  }
  // Rounding pennies go to Cash so the total is exact.
  out.cash += totalCents - given;
  return out;
}

export function groupsYear(
  opening: Record<GroupKind, number>,
  settings: Record<GroupKind, GroupSettings>,
  ctx: {
    year: number;
    thisYear: number;
    inflationPct: number;
    /** Income − spending (before withdrawal tax) + one-off − cash spent on a property. */
    flowCents: number;
    age: number | null;
    birthYear: number | null;
  },
): GroupsYearResult {
  const rows = new Map<GroupKind, GroupYear>();
  for (const kind of GROUP_KINDS) {
    const start = opening[kind];
    const gain = start > 0 ? Math.round((start * settings[kind].returnPct) / 100) : 0;
    rows.set(kind, { kind, startCents: start, gainCents: gain, addCents: 0, takeCents: 0, rmdExtraCents: 0, autoCents: 0, taxCents: 0, endCents: start + gain });
  }
  const cash = rows.get("cash")!;
  const grow = Math.pow(1 + ctx.inflationPct / 100, Math.max(0, ctx.year - ctx.thisYear));

  // 2. Planned withdrawals and the required minimum.
  for (const kind of GROUP_KINDS) {
    if (kind === "cash") continue;
    const s = settings[kind];
    const r = rows.get(kind)!;
    const available = Math.max(0, r.endCents);
    let take = s.takeCents > 0 && inYears(ctx.year, s.takeStartYear, s.takeEndYear) ? Math.round(s.takeCents * grow) : 0;
    if (kind === "pretax") {
      const rmd = rmdCents(r.startCents, ctx.age, ctx.birthYear);
      if (rmd > take) {
        r.rmdExtraCents = rmd - take;
        take = rmd;
      }
    }
    take = Math.min(take, available);
    if (r.rmdExtraCents > take) r.rmdExtraCents = take;
    if (take <= 0) continue;
    const tax = Math.round((take * s.taxPct) / 100);
    r.takeCents = take;
    r.taxCents = tax;
    r.endCents -= take;
    cash.endCents += take - tax;
  }

  // 3. The year's left-over.
  cash.endCents += ctx.flowCents;

  // 4. Contributions, out of Cash and never more than it holds.
  const planned = GROUP_KINDS.filter((k) => k !== "cash").map((kind) => {
    const s = settings[kind];
    const add = s.addCents > 0 && inYears(ctx.year, s.addStartYear, s.addEndYear) ? s.addCents : 0;
    return { kind, add };
  });
  const wanted = planned.reduce((t, p) => t + p.add, 0);
  if (wanted > 0) {
    const room = Math.max(0, cash.endCents);
    const share = wanted <= room ? 1 : room / wanted;
    let moved = 0;
    for (const p of planned) {
      if (p.add <= 0) continue;
      const add = Math.round(p.add * share);
      const r = rows.get(p.kind)!;
      r.addCents = add;
      r.endCents += add;
      moved += add;
    }
    cash.endCents -= moved;
  }

  // 5. A shortfall comes out of the other groups, grossed up for tax.
  for (const kind of DRAW_ORDER) {
    if (cash.endCents >= 0) break;
    const r = rows.get(kind)!;
    const available = Math.max(0, r.endCents);
    if (available <= 0) continue;
    const keep = 1 - settings[kind].taxPct / 100;
    const need = -cash.endCents;
    const gross = Math.min(available, keep > 0 ? Math.ceil(need / keep) : available);
    const tax = Math.round((gross * settings[kind].taxPct) / 100);
    r.autoCents += gross;
    r.taxCents += tax;
    r.endCents -= gross;
    cash.endCents += gross - tax;
  }

  const groups = GROUP_KINDS.map((k) => rows.get(k)!);
  const balances = emptyBalances();
  for (const g of groups) balances[g.kind] = g.endCents;
  return {
    groups,
    gainCents: groups.reduce((t, g) => t + g.gainCents, 0),
    addCents: groups.reduce((t, g) => t + g.addCents, 0),
    withdrawnCents: groups.reduce((t, g) => t + g.takeCents + g.autoCents, 0),
    taxCents: groups.reduce((t, g) => t + g.taxCents, 0),
    shortCents: Math.max(0, -cash.endCents),
    balances,
  };
}

// ---- Stored settings → the engine's, defaults filled in.

/**
 * A blank "Add to": adding stops the year before you stop working, or the
 * year before this group starts paying out, whichever comes first. Neither
 * set: it never stops.
 */
export function defaultAddEnd(stopWorkYear: number | null, takeCents: number, takeStartYear: number | null): number | null {
  const ends = [
    stopWorkYear != null ? stopWorkYear - 1 : null,
    takeCents > 0 && takeStartYear != null ? takeStartYear - 1 : null,
  ].filter((y): y is number => y != null);
  return ends.length > 0 ? Math.min(...ends) : null;
}

/** A `retirement_account_groups` row as stored (numerics arrive as strings). */
export type GroupRow = {
  kind: string;
  return_pct: number | string | null;
  add_annual_cents: number | null;
  add_start_year: number | null;
  add_end_year: number | null;
  take_annual_cents: number | null;
  take_start_year: number | null;
  take_end_year: number | null;
  tax_pct: number | string | null;
};

export function resolveGroupSettings(
  rows: GroupRow[],
  defaults: {
    investReturnPct: number;
    cashReturnPct: number;
    /** What each group took in over the last twelve months, a year's worth. */
    measuredAddCents: Record<GroupKind, number>;
    /** The year you stop working (the plan's "Withdrawals start"); a blank
     *  "Add to" adds through the year before it. Null = no such year. */
    stopWorkYear?: number | null;
  },
): Record<GroupKind, GroupSettings> {
  const byKind = new Map(rows.filter((r) => isGroupKind(r.kind)).map((r) => [r.kind as GroupKind, r]));
  const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
  const out = {} as Record<GroupKind, GroupSettings>;
  for (const kind of GROUP_KINDS) {
    const r = byKind.get(kind);
    const takeCents = kind === "cash" ? 0 : r?.take_annual_cents ?? 0;
    const takeStartYear = r?.take_start_year ?? null;
    out[kind] = {
      kind,
      returnPct: num(r?.return_pct) ?? (kind === "cash" ? defaults.cashReturnPct : defaults.investReturnPct),
      addCents: kind === "cash" ? 0 : r?.add_annual_cents ?? Math.max(0, defaults.measuredAddCents[kind]),
      addStartYear: r?.add_start_year ?? null,
      addEndYear: r?.add_end_year ?? defaultAddEnd(defaults.stopWorkYear ?? null, takeCents, takeStartYear),
      takeCents,
      takeStartYear,
      takeEndYear: r?.take_end_year ?? null,
      taxPct: num(r?.tax_pct) ?? DEFAULT_TAX_PCT[kind],
    };
  }
  return out;
}

/** Per-group detail stored on a projection row, for the year popup. */
export type StoredGroupYear = {
  kind: GroupKind;
  start: number;
  gain: number;
  add: number;
  take: number;
  rmd: number;
  auto: number;
  tax: number;
  end: number;
};

export function toStoredGroups(groups: GroupYear[]): StoredGroupYear[] {
  return groups
    .filter((g) => g.startCents !== 0 || g.endCents !== 0 || g.addCents !== 0 || g.takeCents !== 0 || g.autoCents !== 0)
    .map((g) => ({
      kind: g.kind,
      start: g.startCents,
      gain: g.gainCents,
      add: g.addCents,
      take: g.takeCents,
      rmd: g.rmdExtraCents,
      auto: g.autoCents,
      tax: g.taxCents,
      end: g.endCents,
    }));
}

export function parseStoredGroups(raw: unknown): StoredGroupYear[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is StoredGroupYear => !!g && typeof g === "object" && isGroupKind((g as { kind?: unknown }).kind))
    .map((g) => ({
      kind: g.kind,
      start: Number(g.start) || 0,
      gain: Number(g.gain) || 0,
      add: Number(g.add) || 0,
      take: Number(g.take) || 0,
      rmd: Number(g.rmd) || 0,
      auto: Number(g.auto) || 0,
      tax: Number(g.tax) || 0,
      end: Number(g.end) || 0,
    }));
}
