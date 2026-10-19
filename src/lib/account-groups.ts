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
  // "Traditional", not "Pre-tax" — the word on his TSP statement (Victor, 2026-10-17).
  pretax: "Traditional retirement",
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
  /** The return the gain was worked out at (typed for the year, else the settings'). */
  returnPct: number;
  /** The tax on withdrawals the year used (typed for the year, else the settings'). */
  taxPct: number;
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

/**
 * The accounts a group holds, for the lists under a group's name. A bucketed
 * account that sits wholly in the group reads "Crypto (Kraken, River, …)" so
 * its buckets show; one split across groups (Fidelity, TSP) names just the
 * buckets in this group ("TSP Roth", "Fidelity Roth Vic").
 */
export function groupAccountNames<T extends { accountId: string; bucketId: string | null; name: string; accountName: string }>(
  slots: T[],
  inGroup: (slot: T) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of slots) {
    if (seen.has(x.accountId)) continue;
    seen.add(x.accountId);
    const all = slots.filter((y) => y.accountId === x.accountId);
    const mine = all.filter(inGroup);
    if (mine.length === 0) continue;
    if (all.every((y) => y.bucketId == null)) {
      out.push(x.accountName);
    } else if (mine.length === all.length) {
      const prefix = `${x.accountName} · `;
      const buckets = mine.map((y) => (y.name.startsWith(prefix) ? y.name.slice(prefix.length) : y.name));
      out.push(`${x.accountName} (${buckets.join(", ")})`);
    } else {
      for (const y of mine) out.push(y.name);
    }
  }
  return out;
}

// ---- Figures typed in the year popup (networth_projection.group_overrides).

/** What one year typed for each group: add/take in cents, ret as a return
 *  percent. A missing field = not typed. Cash only ever has ret. */
export type TypedGroups = Partial<Record<GroupKind, { add?: number; take?: number; takePct?: number; ret?: number; tax?: number }>>;

/** True when a typed group entry holds nothing. */
export function isEmptyTyped(e: { add?: number; take?: number; takePct?: number; ret?: number; tax?: number }): boolean {
  return e.add == null && e.take == null && e.takePct == null && e.ret == null && e.tax == null;
}

/** The year's typed Est. Withdraw: dollars (cents) or a percent of the
 *  year's start. */
export type TypedWithdraw = { cents: number } | { pct: number };

/** One year's effective typed figures, and the year each was typed in.
 *  `withdraw` is the year's withdrawal total (see groupsYear step 2): cents
 *  already raised by inflation, or a percent of that year's start. */
export type YearOverrides = Partial<
  Record<
    GroupKind,
    {
      add?: number;
      take?: number;
      takePct?: number;
      ret?: number;
      tax?: number;
      addFrom?: number;
      takeFrom?: number;
      retFrom?: number;
      taxFrom?: number;
    }
  >
> & { withdraw?: { cents?: number; pct?: number; from: number } };

/** The year's typed Est. Withdraw, stored beside the groups in
 *  group_overrides as { withdraw } (cents) or { withdrawPct }. Null = not
 *  typed that year. */
export function parseTypedWithdraw(raw: unknown): TypedWithdraw | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { withdraw?: unknown; withdrawPct?: unknown };
  const pct = Number(r.withdrawPct);
  if (r.withdrawPct != null && Number.isFinite(pct) && pct >= 0) return { pct: clampWithdrawPct(pct) };
  const n = Number(r.withdraw);
  return r.withdraw != null && Number.isFinite(n) && n >= 0 ? { cents: Math.round(n) } : null;
}

/** Whether spending was typed in this year (stored beside the groups in
 *  group_overrides as { spendFrom: true }), so its inflation growth restarts
 *  there even when the amount matches the year before. */
export function parseSpendRestart(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { spendFrom?: unknown }).spendFrom === true;
}

/** What the investments hold: every group but Cash. A withdrawal % is of this. */
export function investmentsCents(balances: Record<GroupKind, number>): number {
  return GROUP_KINDS.reduce((t, k) => (k === "cash" ? t : t + Math.max(0, balances[k])), 0);
}

/**
 * The 4% rule over the years: a percent typed in one year is that share of
 * the investments that year; every later year it carries to takes the same
 * dollars raised by inflation. Call once per year in order; it remembers the
 * typed year's dollars. Returns the overrides with `cents` filled in.
 */
export function pctWithdrawCarrier(inflationPct: number) {
  let base: { from: number; cents: number } | null = null;
  return (year: number, opening: Record<GroupKind, number>, overrides: YearOverrides | undefined): YearOverrides | undefined => {
    const w = overrides?.withdraw;
    if (!overrides || !w || w.pct == null) return overrides;
    if (!base || base.from !== w.from) {
      base = { from: w.from, cents: Math.round((investmentsCents(opening) * w.pct) / 100) };
    }
    const cents = Math.round(base.cents * Math.pow(1 + inflationPct / 100, year - base.from));
    return { ...overrides, withdraw: { ...w, cents } };
  };
}

/** A typed withdrawal percent: 0–100, two decimals. */
export function clampWithdrawPct(pct: number): number {
  return Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
}

export function parseTypedGroups(raw: unknown): TypedGroups {
  const out: TypedGroups = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [kind, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isGroupKind(kind) || !v || typeof v !== "object") continue;
    const add = Number((v as { add?: unknown }).add);
    const take = Number((v as { take?: unknown }).take);
    const ret = Number((v as { ret?: unknown }).ret);
    const takePct = Number((v as { takePct?: unknown }).takePct);
    const tax = Number((v as { tax?: unknown }).tax);
    const entry: { add?: number; take?: number; takePct?: number; ret?: number; tax?: number } = {};
    if (kind !== "cash" && (v as { add?: unknown }).add != null && Number.isFinite(add) && add >= 0) entry.add = Math.round(add);
    if (kind !== "cash" && (v as { take?: unknown }).take != null && Number.isFinite(take) && take >= 0) entry.take = Math.round(take);
    if ((v as { ret?: unknown }).ret != null && Number.isFinite(ret)) entry.ret = clampReturnPct(ret);
    if (kind !== "cash" && (v as { takePct?: unknown }).takePct != null && Number.isFinite(takePct)) entry.takePct = clampWithdrawPct(takePct);
    if (kind !== "cash" && (v as { tax?: unknown }).tax != null && Number.isFinite(tax)) entry.tax = clampTaxPct(tax);
    if (!isEmptyTyped(entry)) out[kind] = entry;
  }
  return out;
}

/** A typed tax on withdrawals, held to the range the plan's save allows. */
export function clampTaxPct(pct: number): number {
  return Math.round(Math.min(60, Math.max(0, pct)) * 100) / 100;
}

/** A typed return, held to the same range the group settings allow. */
export function clampReturnPct(pct: number): number {
  return Math.round(Math.min(30, Math.max(-20, pct)) * 100) / 100;
}

/**
 * Each year's typed figures carried forward: a figure typed in one year holds
 * for every later year until another year types a new one. A contribution
 * stays flat; a withdrawal grows with inflation from the year it was typed,
 * the way typed spending does; a return % stays as typed. Returns year →
 * that year's overrides.
 */
export function resolveOverrides(
  rows: { year: number; typed: TypedGroups; withdraw?: TypedWithdraw | null }[],
  inflationPct: number,
): Map<number, YearOverrides> {
  const out = new Map<number, YearOverrides>();
  let lastWithdraw: { typed: TypedWithdraw; year: number } | null = null;
  const lastAdd = new Map<GroupKind, { cents: number; year: number }>();
  const lastTake = new Map<GroupKind, { cents: number; year: number }>();
  const lastRet = new Map<GroupKind, { pct: number; year: number }>();
  const lastTakePct = new Map<GroupKind, { pct: number; year: number }>();
  const lastTax = new Map<GroupKind, { pct: number; year: number }>();
  for (const r of [...rows].sort((a, b) => a.year - b.year)) {
    const year: YearOverrides = {};
    // A dollar total grows with inflation from the year it was typed, as a
    // typed withdrawal always has; a percent stays the percent, taken of
    // each later year's own start.
    if (r.withdraw != null) lastWithdraw = { typed: r.withdraw, year: r.year };
    if (lastWithdraw) {
      const t = lastWithdraw.typed;
      year.withdraw =
        "pct" in t
          ? { pct: t.pct, from: lastWithdraw.year }
          : {
              cents: Math.round(t.cents * Math.pow(1 + inflationPct / 100, r.year - lastWithdraw.year)),
              from: lastWithdraw.year,
            };
    }
    for (const kind of GROUP_KINDS) {
      const t = r.typed[kind];
      if (t?.add != null) lastAdd.set(kind, { cents: t.add, year: r.year });
      // A withdrawal is either dollars or a percent; the newer one wins. A
      // percent carries into later years like the rest (Victor, 2026-10-17),
      // each later year showing it with "from 2027".
      if (t?.take != null) {
        lastTake.set(kind, { cents: t.take, year: r.year });
        lastTakePct.delete(kind);
      }
      if (t?.takePct != null) {
        lastTakePct.set(kind, { pct: t.takePct, year: r.year });
        lastTake.delete(kind);
      }
      if (t?.ret != null) lastRet.set(kind, { pct: t.ret, year: r.year });
      if (t?.tax != null) lastTax.set(kind, { pct: t.tax, year: r.year });
      const a = lastAdd.get(kind);
      const w = lastTake.get(kind);
      const p = lastRet.get(kind);
      const wp = lastTakePct.get(kind);
      const tx = lastTax.get(kind);
      if (!a && !w && !p && !wp && !tx) continue;
      year[kind] = {
        ...(tx ? { tax: tx.pct, taxFrom: tx.year } : {}),
        ...(wp ? { takePct: wp.pct, takeFrom: wp.year } : {}),
        ...(p ? { ret: p.pct, retFrom: p.year } : {}),
        ...(a ? { add: a.cents, addFrom: a.year } : {}),
        ...(w
          ? { take: Math.round(w.cents * Math.pow(1 + inflationPct / 100, r.year - w.year)), takeFrom: w.year }
          : {}),
      };
    }
    out.set(r.year, year);
  }
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
    /** Figures typed in the year popup, already carried to this year
     *  (see resolveOverrides). They replace the settings' figure; the
     *  return, the RMD floor and the Cash cap still apply. */
    overrides?: YearOverrides;
  },
): GroupsYearResult {
  const rows = new Map<GroupKind, GroupYear>();
  for (const kind of GROUP_KINDS) {
    const start = opening[kind];
    const returnPct = ctx.overrides?.[kind]?.ret ?? settings[kind].returnPct;
    const taxPct = kind === "cash" ? 0 : ctx.overrides?.[kind]?.tax ?? settings[kind].taxPct;
    const gain = start > 0 ? Math.round((start * returnPct) / 100) : 0;
    rows.set(kind, { kind, startCents: start, returnPct, taxPct, gainCents: gain, addCents: 0, takeCents: 0, rmdExtraCents: 0, autoCents: 0, taxCents: 0, endCents: start + gain });
  }
  const cash = rows.get("cash")!;
  const grow = Math.pow(1 + ctx.inflationPct / 100, Math.max(0, ctx.year - ctx.thisYear));

  // 2. Planned withdrawals and the required minimum. A typed yearly total
  // (Est. Withdraw Invested) replaces every group's own figure and is spread
  // across the investment groups by balance.
  // A percent is of the investments (every group but Cash) at the start of
  // the year it was typed — the 4% rule. Later years get those dollars plus
  // inflation, worked out by the caller as `cents`.
  const w = ctx.overrides?.withdraw;
  const typedTotal =
    w?.cents ?? (w?.pct != null ? Math.max(0, Math.round((investmentsCents(opening) * w.pct) / 100)) : undefined);
  // Spread across the investment groups by what each holds, so none is
  // drained first (Victor, 2026-10-17 — the low-tax order took it all from
  // Brokerage). Rounding pennies go to the biggest group.
  const fromTotal = new Map<GroupKind, number>();
  if (typedTotal != null && typedTotal > 0) {
    const held = GROUP_KINDS.filter((k) => k !== "cash").map((k) => ({ kind: k, has: Math.max(0, rows.get(k)!.endCents) }));
    const total = held.reduce((t, h) => t + h.has, 0);
    const want = Math.min(typedTotal, total);
    if (total > 0) {
      let given = 0;
      for (const h of held) {
        const part = Math.floor((want * h.has) / total);
        if (part > 0) fromTotal.set(h.kind, part);
        given += part;
      }
      const biggest = held.reduce((a, b) => (b.has > a.has ? b : a));
      fromTotal.set(biggest.kind, (fromTotal.get(biggest.kind) ?? 0) + want - given);
    }
  }
  for (const kind of GROUP_KINDS) {
    if (kind === "cash") continue;
    const s = settings[kind];
    const r = rows.get(kind)!;
    const available = Math.max(0, r.endCents);
    const typedTake = ctx.overrides?.[kind]?.take;
    // A typed percent is of the group's start this year, like its return.
    const typedPct = ctx.overrides?.[kind]?.takePct;
    let take =
      typedTotal != null
        ? fromTotal.get(kind) ?? 0
        : typedTake != null
          ? typedTake
          : typedPct != null
            ? Math.max(0, Math.round((Math.max(0, r.startCents) * typedPct) / 100))
          : s.takeCents > 0 && inYears(ctx.year, s.takeStartYear, s.takeEndYear)
            ? Math.round(s.takeCents * grow)
            : 0;
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
    const tax = Math.round((take * r.taxPct) / 100);
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
    const typedAdd = ctx.overrides?.[kind]?.add;
    const add =
      typedAdd != null ? typedAdd : s.addCents > 0 && inYears(ctx.year, s.addStartYear, s.addEndYear) ? s.addCents : 0;
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
    const keep = 1 - r.taxPct / 100;
    const need = -cash.endCents;
    const gross = Math.min(available, keep > 0 ? Math.ceil(need / keep) : available);
    const tax = Math.round((gross * r.taxPct) / 100);
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
  /** Return % behind `gain`; missing on rows saved before it was stored. */
  rate?: number | null;
  /** Tax % on its withdrawals; missing on rows saved before it was stored. */
  taxRate?: number | null;
  gain: number;
  add: number;
  take: number;
  rmd: number;
  auto: number;
  tax: number;
  end: number;
  /** Real contributions / withdrawals that year from the register — only on
   *  the year in progress (and any year the page measured). */
  actualAdd?: number | null;
  actualTake?: number | null;
};

export function toStoredGroups(groups: GroupYear[]): StoredGroupYear[] {
  return groups
    .filter((g) => g.startCents !== 0 || g.endCents !== 0 || g.addCents !== 0 || g.takeCents !== 0 || g.autoCents !== 0)
    .map((g) => ({
      kind: g.kind,
      start: g.startCents,
      rate: g.returnPct,
      taxRate: g.taxPct,
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
      rate: g.rate == null || !Number.isFinite(Number(g.rate)) ? null : Number(g.rate),
      taxRate: g.taxRate == null || !Number.isFinite(Number(g.taxRate)) ? null : Number(g.taxRate),
      gain: Number(g.gain) || 0,
      add: Number(g.add) || 0,
      take: Number(g.take) || 0,
      rmd: Number(g.rmd) || 0,
      auto: Number(g.auto) || 0,
      tax: Number(g.tax) || 0,
      end: Number(g.end) || 0,
    }));
}
